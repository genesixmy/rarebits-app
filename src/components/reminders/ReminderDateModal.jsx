import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Pencil, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDueDate } from './reminderCalendarUtils';

const ReminderDateModal = ({
  open,
  dateKey,
  reminders,
  isToggling = false,
  onClose,
  onToggleCompleted,
  onEditReminder,
  onAddReminder,
}) => {
  useEffect(() => {
    if (!open) return undefined;

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[58] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        className="w-full max-w-xl"
      >
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base font-semibold">
              Reminder - {formatDueDate(dateKey)}
            </CardTitle>
            <Button type="button" variant="ghost" size="icon" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
          </CardHeader>

          <CardContent className="space-y-3">
            <div className="max-h-[52vh] space-y-2 overflow-y-auto pr-1">
              {reminders.length === 0 ? (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  Tiada reminder untuk tarikh ini.
                </div>
              ) : (
                reminders.map((reminder) => (
                  <div
                    key={reminder.occurrence_key || reminder.id}
                    className={cn(
                      'rounded-lg border border-border/80 bg-card p-3',
                      reminder.is_completed && 'opacity-80'
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        <p className={cn('text-sm font-semibold text-foreground', reminder.is_completed && 'line-through text-muted-foreground')}>
                          {reminder.title}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium', reminder.priorityUi.className)}>
                            {reminder.priorityUi.label}
                          </span>
                          <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium', reminder.categoryUi.badgeClass)}>
                            {reminder.categoryUi.label}
                          </span>
                          {String(reminder?.recurrence || 'none').toLowerCase() !== 'none' ? (
                            <span className="inline-flex rounded-full border border-violet-200 bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-700">
                              Ulang
                            </span>
                          ) : null}
                          <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium', reminder.uiStatus.badgeClass)}>
                            {reminder.uiStatus.label}
                          </span>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        <label className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-1 text-[11px] text-muted-foreground">
                          <Checkbox
                            checked={Boolean(reminder.is_completed)}
                            onCheckedChange={(checked) => onToggleCompleted(reminder, checked === true)}
                            disabled={isToggling}
                          />
                          Selesai
                        </label>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => onEditReminder(reminder)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="flex flex-col-reverse gap-2 border-t pt-3 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={onClose}>
                Tutup
              </Button>
              <Button type="button" className="gap-1.5 text-white brand-gradient brand-gradient-hover" onClick={onAddReminder}>
                <Plus className="h-3.5 w-3.5" />
                Tambah Reminder
              </Button>
            </div>
            {isToggling ? (
              <div className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Mengemas kini status...
              </div>
            ) : null}
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
};

export default ReminderDateModal;
