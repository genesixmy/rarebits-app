import React, { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  WEEKDAY_LABELS_MON,
  buildMonthCalendarCells,
  formatMonthTitle,
  getReminderEndDateKey,
  getReminderStartDateKey,
} from './reminderCalendarUtils';

const getReminderEventTone = (reminder) => {
  if (reminder?.is_completed) {
    return {
      surfaceClass: 'border-slate-200 bg-slate-100/90',
      lineClass: 'bg-slate-400',
      titleClass: 'text-slate-500 line-through',
      metaClass: 'text-slate-500',
    };
  }
  if (reminder?.uiStatus?.key === 'overdue') {
    return {
      surfaceClass: 'border-red-200 bg-red-50/95',
      lineClass: 'bg-red-500',
      titleClass: 'text-red-900',
      metaClass: 'text-red-700',
    };
  }

  const priority = String(reminder?.priority || 'normal').toLowerCase();
  if (priority === 'high') {
    return {
      surfaceClass: 'border-rose-200 bg-rose-50/95',
      lineClass: 'bg-rose-500',
      titleClass: 'text-rose-900',
      metaClass: 'text-rose-700',
    };
  }
  if (priority === 'low') {
    return {
      surfaceClass: 'border-slate-200 bg-slate-50/95',
      lineClass: 'bg-slate-400',
      titleClass: 'text-slate-700',
      metaClass: 'text-slate-500',
    };
  }

  return {
    surfaceClass: 'border-indigo-200 bg-indigo-50/95',
    lineClass: 'bg-indigo-500',
    titleClass: 'text-indigo-900',
    metaClass: 'text-indigo-700',
  };
};

const MAX_VISIBLE_REMINDERS = 3;

const ReminderCalendarView = ({
  monthDate,
  selectedDateKey,
  todayKey,
  remindersByDate,
  onSelectDate,
  onPrevMonth,
  onNextMonth,
  onGoToday,
}) => {
  const calendarCells = useMemo(
    () => buildMonthCalendarCells(monthDate, selectedDateKey, todayKey, remindersByDate),
    [monthDate, selectedDateKey, todayKey, remindersByDate]
  );

  return (
    <Card className="overflow-hidden border-slate-200/80 bg-white shadow-sm">
      <CardHeader className="border-b border-slate-100 bg-gradient-to-r from-slate-50 via-white to-indigo-50/70 pb-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              <CalendarDays className="h-3.5 w-3.5" />
              Planner
            </div>
            <CardTitle className="text-xl font-semibold capitalize text-slate-900 sm:text-2xl">
              {formatMonthTitle(monthDate)}
            </CardTitle>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="icon" className="h-9 w-9 border-slate-200 bg-white" onClick={onPrevMonth}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button type="button" variant="outline" size="icon" className="h-9 w-9 border-slate-200 bg-white" onClick={onNextMonth}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button type="button" className="brand-gradient brand-gradient-hover h-9 rounded-lg px-4 text-white" onClick={onGoToday}>
              Hari Ini
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-3 sm:p-4">
        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            <div className="grid grid-cols-7 gap-2 rounded-xl border border-slate-100 bg-slate-50/80 p-2">
              {WEEKDAY_LABELS_MON.map((label) => (
                <div key={label} className="py-1 text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  {label}
                </div>
              ))}
            </div>

            <div className="mt-2 grid grid-cols-7 gap-2">
              {calendarCells.map((cell, cellIndex) => {
                const visibleReminders = cell.reminders.slice(0, MAX_VISIBLE_REMINDERS);
                const hiddenCount = Math.max(0, cell.reminderCount - visibleReminders.length);
                const prevCell = cellIndex > 0 ? calendarCells[cellIndex - 1] : null;
                const nextCell = cellIndex < calendarCells.length - 1 ? calendarCells[cellIndex + 1] : null;
                const sameRowAsPrev = Math.floor((cellIndex - 1) / 7) === Math.floor(cellIndex / 7);
                const sameRowAsNext = Math.floor((cellIndex + 1) / 7) === Math.floor(cellIndex / 7);
                const prevVisibleReminders = (prevCell?.reminders || []).slice(0, MAX_VISIBLE_REMINDERS);
                const nextVisibleReminders = (nextCell?.reminders || []).slice(0, MAX_VISIBLE_REMINDERS);

                return (
                  <button
                    key={cell.dateKey}
                    type="button"
                    onClick={() => onSelectDate(cell.dateKey)}
                    className={cn(
                      'group relative min-h-[146px] rounded-xl border p-2 text-left transition',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300',
                      cell.isCurrentMonth
                        ? 'border-slate-200/80 bg-white hover:border-indigo-200 hover:shadow-sm'
                        : 'border-slate-100 bg-slate-50 text-slate-400 hover:border-slate-200',
                      cell.isToday && 'ring-1 ring-indigo-300',
                      cell.isSelected && 'border-indigo-300 bg-indigo-50/80 shadow-sm'
                    )}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <span
                        className={cn(
                          'inline-flex h-7 min-w-[1.75rem] items-center justify-center rounded-full px-1.5 text-sm font-semibold',
                          cell.isSelected ? 'bg-indigo-600 text-white' : 'text-slate-800',
                          !cell.isCurrentMonth && 'text-slate-400'
                        )}
                      >
                        {cell.dayNumber}
                      </span>

                      {cell.reminderCount > 0 ? (
                        <span className="inline-flex h-5 min-w-[1.4rem] items-center justify-center rounded-full bg-violet-100 px-1.5 text-[11px] font-semibold text-violet-700">
                          {cell.reminderCount}
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-2 flex h-[calc(100%-2rem)] flex-col gap-1">
                      {visibleReminders.map((reminder, reminderIndex) => {
                        const tone = getReminderEventTone(reminder);
                        const reminderKey = reminder.occurrence_key || reminder.id;
                        const reminderStartDateKey = getReminderStartDateKey(reminder);
                        const reminderEndDateKey = getReminderEndDateKey(reminder);
                        const prevSameLaneReminder = prevVisibleReminders[reminderIndex];
                        const nextSameLaneReminder = nextVisibleReminders[reminderIndex];
                        const prevSameLaneKey = prevSameLaneReminder?.occurrence_key || prevSameLaneReminder?.id;
                        const nextSameLaneKey = nextSameLaneReminder?.occurrence_key || nextSameLaneReminder?.id;
                        const isConnectedFromPrev = Boolean(
                          prevCell
                          && sameRowAsPrev
                          && prevSameLaneKey === reminderKey
                          && reminderStartDateKey
                          && reminderEndDateKey
                          && reminderStartDateKey <= prevCell.dateKey
                          && prevCell.dateKey <= reminderEndDateKey
                        );
                        const isConnectedToNext = Boolean(
                          nextCell
                          && sameRowAsNext
                          && nextSameLaneKey === reminderKey
                          && reminderStartDateKey
                          && reminderEndDateKey
                          && reminderStartDateKey <= nextCell.dateKey
                          && nextCell.dateKey <= reminderEndDateKey
                        );
                        // Show text on first visible segment (not strictly first date),
                        // so label does not disappear when true start date is hidden in "+N lagi".
                        const showReminderLabel = !(
                          prevCell
                          && sameRowAsPrev
                          && prevSameLaneKey === reminderKey
                        );
                        return (
                          <div
                            key={reminder.occurrence_key || reminder.id}
                            className={cn(
                              'relative z-[2] h-[36px] w-full overflow-visible border px-2 py-1 pl-3',
                              tone.surfaceClass,
                              !isConnectedFromPrev && !isConnectedToNext && 'rounded-md',
                              isConnectedFromPrev && !isConnectedToNext && '-ml-6 w-[calc(100%+1.5rem)] rounded-r-md rounded-l-none border-l-0',
                              !isConnectedFromPrev && isConnectedToNext && 'w-[calc(100%+1.5rem)] rounded-l-md rounded-r-none border-r-0',
                              isConnectedFromPrev && isConnectedToNext && '-ml-6 w-[calc(100%+3rem)] rounded-none border-l-0 border-r-0'
                            )}
                          >
                            {!isConnectedFromPrev ? (
                              <span className={cn('absolute inset-y-0 left-0 w-1', tone.lineClass)} />
                            ) : null}
                            {showReminderLabel ? (
                              <span className={cn('block truncate text-xs font-semibold leading-tight', tone.titleClass)}>
                                {reminder.title}
                              </span>
                            ) : null}
                          </div>
                        );
                      })}

                      {hiddenCount > 0 ? (
                        <span className="mt-1 block text-[11px] font-medium text-slate-500">
                          +{hiddenCount} lagi
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default ReminderCalendarView;
