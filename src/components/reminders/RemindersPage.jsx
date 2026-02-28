import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { ArrowRight, CalendarClock, CalendarDays, List, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import ReminderFormModal from './ReminderFormModal';
import ReminderCalendarView from './ReminderCalendarView';
import ReminderDateModal from './ReminderDateModal';
import {
  buildCompletedReminderOccurrenceSet,
  evaluateReminderStatusForDate,
  expandReminderOccurrencesInWindow,
  formatReminderDateRange,
  getMonthGridDateRange,
  getLocalDateKey,
  getReminderOccurrenceLookupKey,
  getReminderEndDateKey,
  getReminderStartDateKey,
  groupRemindersByDate,
  isDateKeyWithinRange,
  isReminderOccurrenceCompleted,
  isReminderRecurring,
  shiftDateKeyByDays,
  sortRemindersForDate,
} from './reminderCalendarUtils';
import { getReminderCategoryUi, normalizeReminderCategory, REMINDER_CATEGORY_FILTER_OPTIONS } from './reminderCategoryConfig';
import { normalizeReminderRecurrence, normalizeReminderRecurrenceInterval } from './reminderRecurrenceConfig';

const STATUS_FILTER_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'completed', label: 'Completed' },
  { key: 'overdue', label: 'Overdue' },
];
const VIEW_MODE_STORAGE_KEY = 'rarebits_reminders_view_mode';

const resolvePriorityUi = (priority) => {
  const normalized = String(priority || 'normal').toLowerCase();
  if (normalized === 'high') {
    return { label: 'High', className: 'border-red-200 bg-red-100 text-red-700' };
  }
  if (normalized === 'low') {
    return { label: 'Low', className: 'border-slate-200 bg-slate-100 text-slate-700' };
  }
  return { label: 'Normal', className: 'border-indigo-200 bg-indigo-100 text-indigo-700' };
};

const resolveReminderStatus = (reminder, todayKey, completedOccurrenceSet) => {
  if (reminder?.is_completed) {
    return {
      key: 'completed',
      label: 'Completed',
      badgeClass: 'border-slate-200 bg-slate-100 text-slate-700',
      cardClass: 'opacity-80',
    };
  }

  const statusSnapshot = evaluateReminderStatusForDate(reminder, todayKey, 30, completedOccurrenceSet);
  if (statusSnapshot.key === 'overdue') {
    return {
      key: 'overdue',
      label: `Lewat ${statusSnapshot.overdueDays} hari`,
      badgeClass: 'border-red-200 bg-red-100 text-red-700',
      cardClass: 'border-red-200/80 bg-red-50/40',
    };
  }

  if (statusSnapshot.key === 'today') {
    return {
      key: 'today',
      label: 'Hari Ini',
      badgeClass: 'border-amber-200 bg-amber-100 text-amber-700',
      cardClass: 'border-amber-200/80 bg-amber-50/35',
    };
  }

  return {
    key: 'pending',
    label: 'Pending',
    badgeClass: 'border-emerald-200 bg-emerald-100 text-emerald-700',
    cardClass: '',
  };
};

const resolveReminderRowTone = (reminder) => {
  if (reminder?.is_completed) {
    return {
      barClass: 'bg-slate-400',
    };
  }

  if (reminder?.uiStatus?.key === 'overdue') {
    return {
      barClass: 'bg-red-500',
    };
  }

  if (reminder?.uiStatus?.key === 'today') {
    return {
      barClass: 'bg-amber-500',
    };
  }

  const priority = String(reminder?.priority || 'normal').toLowerCase();
  if (priority === 'high') {
    return {
      barClass: 'bg-rose-500',
    };
  }

  if (priority === 'low') {
    return {
      barClass: 'bg-slate-500',
    };
  }

  return {
    barClass: 'bg-blue-500',
  };
};

const fetchReminders = async (userId) => {
  const { data, error } = await supabase
    .from('reminders')
    .select('*')
    .eq('user_id', userId)
    .order('is_completed', { ascending: true })
    .order('start_date', { ascending: true })
    .order('due_date', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
};

const fetchReminderOccurrences = async (userId) => {
  const { data, error } = await supabase
    .from('reminder_occurrences')
    .select('id, reminder_id, occurrence_date, status, created_at')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .order('occurrence_date', { ascending: false });

  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') return [];
    throw error;
  }
  return data || [];
};

const resolveReminderSourceId = (reminder) => (
  reminder?.source_reminder_id || reminder?.reminder_id || reminder?.id || null
);

const RemindersPage = ({ user }) => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activeFilter, setActiveFilter] = useState('all');
  const [activeCategoryFilter, setActiveCategoryFilter] = useState('all');
  const [viewMode, setViewMode] = useState(() => {
    if (typeof window === 'undefined') return 'list';
    const saved = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    return saved === 'calendar' ? 'calendar' : 'list';
  });
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [editingReminder, setEditingReminder] = useState(null);
  const [deletingReminder, setDeletingReminder] = useState(null);
  const [formDefaultStartDate, setFormDefaultStartDate] = useState('');
  const [selectedDateKey, setSelectedDateKey] = useState('');
  const [isDateModalOpen, setIsDateModalOpen] = useState(false);
  const [calendarMonthDate, setCalendarMonthDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const todayKey = useMemo(() => getLocalDateKey(), []);
  const calendarDateRange = useMemo(
    () => getMonthGridDateRange(calendarMonthDate),
    [calendarMonthDate]
  );
  const remindersQueryKey = ['reminders', user?.id];
  const reminderOccurrencesQueryKey = ['reminder-occurrences', user?.id];
  const dashboardReminderQueryKey = ['dashboard-reminders-today', user?.id];
  const dashboardReminderOccurrenceQueryKey = ['dashboard-reminder-occurrences', user?.id];

  useEffect(() => {
    if (!selectedDateKey) {
      setSelectedDateKey(todayKey);
    }
  }, [selectedDateKey, todayKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
  }, [viewMode]);

  const invalidateReminderQueries = () => {
    queryClient.invalidateQueries({ queryKey: remindersQueryKey });
    queryClient.invalidateQueries({ queryKey: reminderOccurrencesQueryKey });
    queryClient.invalidateQueries({ queryKey: dashboardReminderQueryKey });
    queryClient.invalidateQueries({ queryKey: dashboardReminderOccurrenceQueryKey });
  };

  const { data: reminders = [], isLoading } = useQuery({
    queryKey: remindersQueryKey,
    queryFn: () => fetchReminders(user.id),
    enabled: Boolean(user?.id),
  });

  const { data: reminderOccurrenceRows = [] } = useQuery({
    queryKey: reminderOccurrencesQueryKey,
    queryFn: () => fetchReminderOccurrences(user.id),
    enabled: Boolean(user?.id),
  });

  const completedOccurrenceSet = useMemo(
    () => buildCompletedReminderOccurrenceSet(reminderOccurrenceRows),
    [reminderOccurrenceRows]
  );

  const saveReminderMutation = useMutation({
    mutationFn: async (formData) => {
      if (!user?.id) throw new Error('Sesi pengguna tidak sah.');

      const payload = {
        user_id: user.id,
        title: formData.title,
        description: formData.description || null,
        start_date: formData.start_date,
        end_date: formData.end_date || null,
        due_date: formData.end_date || formData.start_date,
        recurrence: normalizeReminderRecurrence(formData.recurrence),
        recurrence_interval: normalizeReminderRecurrenceInterval(formData.recurrence_interval),
        recurrence_until: normalizeReminderRecurrence(formData.recurrence) === 'none'
          ? null
          : (formData.recurrence_until || null),
        priority: formData.priority || 'normal',
        category: normalizeReminderCategory(formData.category),
        is_completed: Boolean(formData.is_completed),
        updated_at: new Date().toISOString(),
      };

      if (formData.id) {
        payload.id = formData.id;
      }

      const { data, error } = await supabase
        .from('reminders')
        .upsert([payload], { onConflict: 'id' })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, values) => {
      invalidateReminderQueries();
      setShowReminderModal(false);
      setEditingReminder(null);
      setFormDefaultStartDate('');
      toast({
        title: values?.id ? 'Reminder dikemas kini' : 'Reminder ditambah',
        description: 'Perubahan reminder telah disimpan.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Gagal simpan reminder',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const toggleCompletedMutation = useMutation({
    mutationFn: async ({ reminder, nextCompleted, occurrenceDateKey }) => {
      const reminderId = resolveReminderSourceId(reminder);
      if (!reminderId) throw new Error('Reminder tidak sah.');

      const isRecurringToggle = isReminderRecurring(reminder) && Boolean(occurrenceDateKey);
      if (isRecurringToggle) {
        if (nextCompleted) {
          const { error } = await supabase
            .from('reminder_occurrences')
            .upsert([{
              user_id: user.id,
              reminder_id: reminderId,
              occurrence_date: occurrenceDateKey,
              status: 'completed',
            }], { onConflict: 'user_id,reminder_id,occurrence_date' });

          if (error) throw error;
        } else {
          const { error } = await supabase
            .from('reminder_occurrences')
            .delete()
            .eq('user_id', user.id)
            .eq('reminder_id', reminderId)
            .eq('occurrence_date', occurrenceDateKey);

          if (error) throw error;
        }

        return;
      }

      const { error } = await supabase
        .from('reminders')
        .update({ is_completed: nextCompleted, updated_at: new Date().toISOString() })
        .eq('id', reminderId)
        .eq('user_id', user.id);

      if (error) throw error;
    },
    onMutate: async ({ reminder, nextCompleted, occurrenceDateKey }) => {
      const reminderId = resolveReminderSourceId(reminder);
      const isRecurringToggle = isReminderRecurring(reminder) && Boolean(occurrenceDateKey);

      await queryClient.cancelQueries({ queryKey: remindersQueryKey });
      await queryClient.cancelQueries({ queryKey: reminderOccurrencesQueryKey });

      const previousReminders = queryClient.getQueryData(remindersQueryKey);
      const previousOccurrences = queryClient.getQueryData(reminderOccurrencesQueryKey);

      if (isRecurringToggle && reminderId) {
        queryClient.setQueryData(reminderOccurrencesQueryKey, (currentRows) => {
          const rows = Array.isArray(currentRows) ? [...currentRows] : [];
          const existingIndex = rows.findIndex((row) => (
            String(row?.reminder_id) === String(reminderId)
            && String(row?.occurrence_date) === String(occurrenceDateKey)
            && String(row?.status || '').toLowerCase() === 'completed'
          ));

          if (nextCompleted) {
            if (existingIndex === -1) {
              rows.unshift({
                id: `optimistic-${reminderId}-${occurrenceDateKey}`,
                reminder_id: reminderId,
                occurrence_date: occurrenceDateKey,
                status: 'completed',
                created_at: new Date().toISOString(),
              });
            }
            return rows;
          }

          if (existingIndex >= 0) {
            rows.splice(existingIndex, 1);
          }
          return rows;
        });
      } else if (reminderId) {
        queryClient.setQueryData(remindersQueryKey, (currentRows) => {
          if (!Array.isArray(currentRows)) return [];
          return currentRows.map((row) => (
            row.id === reminderId
              ? { ...row, is_completed: nextCompleted, updated_at: new Date().toISOString() }
              : row
          ));
        });
      }

      return { previousReminders, previousOccurrences };
    },
    onError: (error, _vars, context) => {
      if (context?.previousReminders) {
        queryClient.setQueryData(remindersQueryKey, context.previousReminders);
      }
      if (context?.previousOccurrences) {
        queryClient.setQueryData(reminderOccurrencesQueryKey, context.previousOccurrences);
      }
      toast({
        title: 'Gagal kemas kini reminder',
        description: error.message,
        variant: 'destructive',
      });
    },
    onSettled: () => {
      invalidateReminderQueries();
    },
  });

  const deleteReminderMutation = useMutation({
    mutationFn: async (reminderId) => {
      const { error } = await supabase
        .from('reminders')
        .delete()
        .eq('id', reminderId)
        .eq('user_id', user.id);

      if (error) throw error;
    },
    onSuccess: () => {
      invalidateReminderQueries();
      setDeletingReminder(null);
      toast({
        title: 'Reminder dipadam',
        description: 'Reminder telah dikeluarkan.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Gagal padam reminder',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const reminderStatusLookbackStartKey = useMemo(
    () => shiftDateKeyByDays(todayKey, -30),
    [todayKey]
  );

  const remindersWithStatus = useMemo(() => (
    reminders.map((reminder) => {
      const startDateKey = getReminderStartDateKey(reminder);
      const endDateKey = getReminderEndDateKey(reminder);
      const normalizedEndDate = endDateKey && endDateKey !== startDateKey ? endDateKey : null;

      const normalizedReminder = {
        ...reminder,
        start_date: startDateKey,
        end_date: normalizedEndDate,
        due_date: reminder?.due_date || normalizedEndDate || startDateKey,
        recurrence: normalizeReminderRecurrence(reminder?.recurrence),
        recurrence_interval: normalizeReminderRecurrenceInterval(reminder?.recurrence_interval),
        recurrence_until: reminder?.recurrence_until || null,
        category: normalizeReminderCategory(reminder.category),
      };

      let completionTargetDateKey = null;
      if (isReminderRecurring(normalizedReminder)) {
        const recentOccurrences = expandReminderOccurrencesInWindow(normalizedReminder, {
          windowStartKey: reminderStatusLookbackStartKey,
          windowEndKey: todayKey,
          maxOccurrences: 600,
        }).filter((occurrence) => !isReminderOccurrenceCompleted(occurrence, completedOccurrenceSet));

        const todayOccurrence = recentOccurrences.find((occurrence) => (
          isDateKeyWithinRange(
            todayKey,
            occurrence.occurrence_start_date,
            occurrence.occurrence_end_date
          )
        ));

        if (todayOccurrence) {
          completionTargetDateKey = todayOccurrence.occurrence_start_date;
        } else {
          const latestOverdueOccurrence = recentOccurrences
            .filter((occurrence) => occurrence.occurrence_end_date < todayKey)
            .sort((left, right) => right.occurrence_end_date.localeCompare(left.occurrence_end_date))[0];
          completionTargetDateKey = latestOverdueOccurrence?.occurrence_start_date || null;
        }
      }

      const completionLookupKey = completionTargetDateKey
        ? getReminderOccurrenceLookupKey(normalizedReminder.id, completionTargetDateKey)
        : '';

      return {
        ...normalizedReminder,
        dateRangeLabel: formatReminderDateRange(startDateKey, normalizedEndDate || startDateKey),
        categoryUi: getReminderCategoryUi(normalizedReminder.category),
        uiStatus: resolveReminderStatus(normalizedReminder, todayKey, completedOccurrenceSet),
        priorityUi: resolvePriorityUi(normalizedReminder.priority),
        isRecurring: isReminderRecurring(normalizedReminder),
        completion_target_date: completionTargetDateKey,
        completion_checked: completionLookupKey ? completedOccurrenceSet.has(completionLookupKey) : Boolean(normalizedReminder.is_completed),
      };
    })
  ), [completedOccurrenceSet, reminderStatusLookbackStartKey, reminders, todayKey]);

  const categoryFilteredReminders = useMemo(() => {
    if (activeCategoryFilter === 'all') return remindersWithStatus;
    return remindersWithStatus.filter((reminder) => reminder.category === activeCategoryFilter);
  }, [activeCategoryFilter, remindersWithStatus]);

  const filteredReminders = useMemo(() => {
    if (activeFilter === 'all') return categoryFilteredReminders;

    return categoryFilteredReminders.filter((reminder) => {
      if (activeFilter === 'completed') return reminder.is_completed;
      if (activeFilter === 'overdue') return reminder.uiStatus.key === 'overdue';
      if (activeFilter === 'pending') return !reminder.is_completed && reminder.uiStatus.key !== 'overdue';
      return true;
    });
  }, [activeFilter, categoryFilteredReminders]);

  const remindersByDate = useMemo(
    () => groupRemindersByDate(categoryFilteredReminders, {
      windowStartKey: calendarDateRange.startDateKey,
      windowEndKey: calendarDateRange.endDateKey,
      completedOccurrenceSet,
    }),
    [categoryFilteredReminders, calendarDateRange.endDateKey, calendarDateRange.startDateKey, completedOccurrenceSet]
  );

  const selectedDateReminders = useMemo(
    () => sortRemindersForDate(remindersByDate[selectedDateKey] || []),
    [remindersByDate, selectedDateKey]
  );

  const baseReminderById = useMemo(
    () => remindersWithStatus.reduce((acc, reminder) => {
      if (reminder?.id) acc.set(reminder.id, reminder);
      return acc;
    }, new Map()),
    [remindersWithStatus]
  );

  const closeReminderFormModal = () => {
    if (saveReminderMutation.isPending) return;
    setShowReminderModal(false);
    setEditingReminder(null);
    setFormDefaultStartDate('');
  };

  const handleOpenCreate = (startDate = '') => {
    setEditingReminder(null);
    setFormDefaultStartDate(startDate || todayKey);
    setShowReminderModal(true);
  };

  const handleOpenEdit = (reminder) => {
    setEditingReminder(reminder);
    setFormDefaultStartDate('');
    setShowReminderModal(true);
  };

  const handleSaveReminder = async (values) => {
    await saveReminderMutation.mutateAsync(values);
  };

  const handleSelectCalendarDate = (dateKey) => {
    setSelectedDateKey(dateKey);
    setIsDateModalOpen(true);
  };

  const handleCalendarPrevMonth = () => {
    setCalendarMonthDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const handleCalendarNextMonth = () => {
    setCalendarMonthDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  const handleCalendarGoToday = () => {
    const now = new Date();
    setCalendarMonthDate(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelectedDateKey(todayKey);
  };

  const handleAddReminderFromDateModal = () => {
    setIsDateModalOpen(false);
    handleOpenCreate(selectedDateKey || todayKey);
  };

  const handleEditReminderFromDateModal = (reminder) => {
    setIsDateModalOpen(false);
    const baseReminder = baseReminderById.get(reminder?.id) || reminder;
    handleOpenEdit(baseReminder);
  };

  const handleToggleCompleted = (reminder, nextCompleted) => {
    const isRecurringToggle = isReminderRecurring(reminder);
    const fallbackOccurrenceDateKey = reminder?.occurrence_start_date
      || reminder?.completion_target_date
      || null;

    if (isRecurringToggle && !fallbackOccurrenceDateKey) {
      return;
    }

    toggleCompletedMutation.mutate({
      reminder,
      nextCompleted,
      occurrenceDateKey: fallbackOccurrenceDateKey,
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="page-title">Reminder</h1>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <div className="inline-flex h-9 rounded-lg border bg-slate-50 p-1">
            <Button
              type="button"
              variant={viewMode === 'list' ? 'default' : 'ghost'}
              size="sm"
              className="h-7 gap-1.5 rounded-md px-2.5 text-xs sm:text-sm"
              onClick={() => setViewMode('list')}
            >
              <List className="h-3.5 w-3.5" />
              Senarai
            </Button>
            <Button
              type="button"
              variant={viewMode === 'calendar' ? 'default' : 'ghost'}
              size="sm"
              className="h-7 gap-1.5 rounded-md px-2.5 text-xs sm:text-sm"
              onClick={() => setViewMode('calendar')}
            >
              <CalendarDays className="h-3.5 w-3.5" />
              Kalendar
            </Button>
          </div>
          <Button onClick={() => handleOpenCreate()} className="brand-gradient brand-gradient-hover w-full gap-2 text-white sm:w-auto">
            <Plus className="h-4 w-4" />
            Tambah Reminder
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">Filter</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {viewMode === 'list' ? (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Status</p>
              <Select
                value={activeFilter}
                onChange={(event) => setActiveFilter(event.target.value)}
                className="h-9 bg-white"
              >
                {STATUS_FILTER_OPTIONS.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Kategori</p>
            <Select
              value={activeCategoryFilter}
              onChange={(event) => setActiveCategoryFilter(event.target.value)}
              className="h-9 bg-white"
            >
              {REMINDER_CATEGORY_FILTER_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
        </CardContent>
      </Card>

      {viewMode === 'calendar' ? (
        <ReminderCalendarView
          monthDate={calendarMonthDate}
          selectedDateKey={selectedDateKey}
          todayKey={todayKey}
          remindersByDate={remindersByDate}
          onSelectDate={handleSelectCalendarDate}
          onPrevMonth={handleCalendarPrevMonth}
          onNextMonth={handleCalendarNextMonth}
          onGoToday={handleCalendarGoToday}
        />
      ) : (
        <div className="space-y-3">
          {isLoading ? (
            <Card>
              <CardContent className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </CardContent>
            </Card>
          ) : filteredReminders.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Tiada reminder untuk filter ini.
              </CardContent>
            </Card>
          ) : (
            filteredReminders.map((reminder) => {
              const rowTone = resolveReminderRowTone(reminder);

              return (
                <Card
                  key={reminder.id}
                  className={cn(
                    'overflow-hidden border-slate-200/80 bg-white shadow-sm transition hover:shadow-md',
                    reminder.is_completed ? 'opacity-80' : ''
                  )}
                >
                  <CardContent className="relative bg-white p-0">
                    <span className={cn('absolute inset-y-0 left-0 w-1', rowTone.barClass)} />

                    <div className="grid grid-cols-1 gap-3 px-4 py-3 sm:gap-4 sm:px-5 md:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)_auto] md:items-center">
                      <div className="min-w-0">
                        <h3 className={cn('truncate text-base font-semibold text-slate-900', reminder.is_completed ? 'text-slate-500 line-through' : '')}>
                          {reminder.title}
                        </h3>

                        {reminder.description ? (
                          <p className={cn('mt-1 truncate text-sm text-slate-600', reminder.is_completed ? 'text-slate-500 line-through' : '')}>
                            {reminder.description}
                          </p>
                        ) : null}

                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium', reminder.uiStatus.badgeClass)}>
                            {reminder.uiStatus.label}
                          </span>
                          <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium', reminder.priorityUi.className)}>
                            {reminder.priorityUi.label}
                          </span>
                          <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium', reminder.categoryUi.badgeClass)}>
                            {reminder.categoryUi.label}
                          </span>
                          {reminder.isRecurring ? (
                            <span className="inline-flex rounded-full border border-violet-200 bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-700">
                              Ulang
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex min-w-0 flex-col gap-1.5 border-slate-200/70 md:border-l md:pl-4">
                        <p className="inline-flex items-center gap-1.5 text-sm text-slate-700">
                          <CalendarClock className="h-3.5 w-3.5 text-blue-500" />
                          {reminder.dateRangeLabel}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 border-slate-200/70 md:justify-end md:border-l md:pl-4">
                        <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600">
                          <Checkbox
                            checked={Boolean(reminder.completion_checked)}
                            onCheckedChange={(checked) => handleToggleCompleted(reminder, checked === true)}
                            disabled={toggleCompletedMutation.isPending || (reminder.isRecurring && !reminder.completion_target_date)}
                          />
                          Selesai
                        </label>

                        <Button type="button" variant="outline" size="icon" onClick={() => handleOpenEdit(reminder)} className="h-8 w-8">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>

                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => setDeletingReminder(reminder)}
                          className="h-8 w-8 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>

                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenEdit(reminder)}
                          className="h-8 w-8 text-blue-600 hover:bg-blue-50 hover:text-blue-700"
                        >
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      )}

      {showReminderModal ? (
        <ReminderFormModal
          reminder={editingReminder}
          onSave={handleSaveReminder}
          onCancel={closeReminderFormModal}
          isSaving={saveReminderMutation.isPending}
          defaultStartDate={formDefaultStartDate}
        />
      ) : null}

      <ReminderDateModal
        open={isDateModalOpen}
        dateKey={selectedDateKey}
        reminders={selectedDateReminders}
        isToggling={toggleCompletedMutation.isPending}
        onClose={() => setIsDateModalOpen(false)}
        onToggleCompleted={handleToggleCompleted}
        onEditReminder={handleEditReminderFromDateModal}
        onAddReminder={handleAddReminderFromDateModal}
      />

      <AlertDialog open={Boolean(deletingReminder)} onOpenChange={() => setDeletingReminder(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Padam reminder ini?</AlertDialogTitle>
            <AlertDialogDescription>
              Tindakan ini tidak boleh diubah semula.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingReminder && deleteReminderMutation.mutate(deletingReminder.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteReminderMutation.isPending}
            >
              {deleteReminderMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Padam'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default RemindersPage;
