import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select } from '@/components/ui/select';
import { Loader2, Save, X } from 'lucide-react';
import { REMINDER_CATEGORY_OPTIONS, normalizeReminderCategory } from './reminderCategoryConfig';
import { getReminderEndDateKey, getReminderStartDateKey } from './reminderCalendarUtils';
import {
  formatRecurrenceExampleText,
  normalizeReminderRecurrence,
  normalizeReminderRecurrenceInterval,
  REMINDER_RECURRENCE_OPTIONS,
} from './reminderRecurrenceConfig';

const getTodayDateKey = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const toFormState = (reminder, defaultStartDate) => {
  const startDate = getReminderStartDateKey(reminder) || defaultStartDate || getTodayDateKey();
  const endDate = getReminderEndDateKey(reminder);
  const hasRange = Boolean(endDate && endDate !== startDate);
  const recurrence = normalizeReminderRecurrence(reminder?.recurrence);
  const recurrenceInterval = normalizeReminderRecurrenceInterval(reminder?.recurrence_interval);

  return {
    id: reminder?.id || null,
    title: reminder?.title || '',
    description: reminder?.description || '',
    date_mode: hasRange ? 'range' : 'single',
    start_date: startDate,
    end_date: hasRange ? endDate : '',
    priority: reminder?.priority || 'normal',
    category: normalizeReminderCategory(reminder?.category),
    recurrence,
    recurrence_interval: recurrenceInterval,
    recurrence_until: reminder?.recurrence_until || '',
    is_completed: Boolean(reminder?.is_completed),
  };
};

const ReminderFormModal = ({ reminder, onSave, onCancel, isSaving = false, defaultStartDate = '' }) => {
  const [formData, setFormData] = useState(toFormState(reminder, defaultStartDate));
  const [formError, setFormError] = useState('');

  useEffect(() => {
    setFormData(toFormState(reminder, defaultStartDate));
    setFormError('');
  }, [reminder, defaultStartDate]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const normalizedTitle = formData.title.trim();
    if (!normalizedTitle) {
      setFormError('Tajuk reminder diperlukan.');
      return;
    }
    if (!formData.start_date) {
      setFormError('Tarikh mula diperlukan.');
      return;
    }

    const isRange = formData.date_mode === 'range';
    const normalizedEndDate = isRange ? String(formData.end_date || '').trim() : '';

    if (isRange && !normalizedEndDate) {
      setFormError('Tarikh akhir diperlukan untuk jangka masa.');
      return;
    }
    if (isRange && normalizedEndDate < formData.start_date) {
      setFormError('Tarikh akhir mesti sama atau selepas tarikh mula.');
      return;
    }

    const normalizedRecurrence = normalizeReminderRecurrence(formData.recurrence);
    const normalizedRecurrenceInterval = normalizeReminderRecurrenceInterval(formData.recurrence_interval);
    const normalizedRecurrenceUntil = normalizedRecurrence === 'none'
      ? ''
      : String(formData.recurrence_until || '').trim();

    if (normalizedRecurrence !== 'none' && normalizedRecurrenceUntil && normalizedRecurrenceUntil < formData.start_date) {
      setFormError('Tarikh ulang sehingga mesti sama atau selepas tarikh mula.');
      return;
    }

    setFormError('');
    await onSave({
      ...formData,
      title: normalizedTitle,
      description: formData.description.trim(),
      start_date: formData.start_date,
      end_date: isRange ? normalizedEndDate : null,
      category: normalizeReminderCategory(formData.category),
      priority: formData.priority || 'normal',
      recurrence: normalizedRecurrence,
      recurrence_interval: normalizedRecurrence === 'none' ? 1 : normalizedRecurrenceInterval,
      recurrence_until: normalizedRecurrence === 'none' ? null : (normalizedRecurrenceUntil || null),
    });
  };

  const isRecurringEnabled = formData.recurrence !== 'none';
  const recurrenceExampleText = formatRecurrenceExampleText({
    recurrence: formData.recurrence,
    interval: formData.recurrence_interval,
    untilDateKey: formData.recurrence_until,
  });

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-xl"
      >
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="gradient-text">
              {reminder ? 'Edit Reminder' : 'Tambah Reminder'}
            </CardTitle>
            <Button type="button" variant="ghost" size="icon" onClick={onCancel} disabled={isSaving}>
              <X className="h-5 w-5" />
            </Button>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div>
                <label className="mb-2 block text-sm font-medium text-muted-foreground">Title *</label>
                <Input
                  value={formData.title}
                  onChange={(event) => setFormData((prev) => ({ ...prev, title: event.target.value }))}
                  placeholder="Contoh: Follow-up pelanggan A"
                  required
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-muted-foreground">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(event) => setFormData((prev) => ({ ...prev, description: event.target.value }))}
                  placeholder="Nota ringkas (optional)"
                  rows={3}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-muted-foreground">Jenis Tarikh</label>
                  <Select
                    value={formData.date_mode}
                    onChange={(event) => setFormData((prev) => ({
                      ...prev,
                      date_mode: event.target.value,
                      end_date: event.target.value === 'single' ? '' : prev.end_date,
                    }))}
                  >
                    <option value="single">Satu Hari</option>
                    <option value="range">Jangka Masa (Event)</option>
                  </Select>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-muted-foreground">Priority</label>
                  <Select
                    value={formData.priority}
                    onChange={(event) => setFormData((prev) => ({ ...prev, priority: event.target.value }))}
                  >
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                  </Select>
                </div>
              </div>

              <div className={formData.date_mode === 'range' ? 'grid grid-cols-1 gap-4 md:grid-cols-2' : ''}>
                <div>
                  <label className="mb-2 block text-sm font-medium text-muted-foreground">Tarikh Mula *</label>
                  <Input
                    type="date"
                    value={formData.start_date}
                    onChange={(event) => setFormData((prev) => ({ ...prev, start_date: event.target.value }))}
                    required
                  />
                </div>

                {formData.date_mode === 'range' ? (
                  <div>
                    <label className="mb-2 block text-sm font-medium text-muted-foreground">Tarikh Akhir *</label>
                    <Input
                      type="date"
                      value={formData.end_date}
                      onChange={(event) => setFormData((prev) => ({ ...prev, end_date: event.target.value }))}
                      min={formData.start_date || undefined}
                      required
                    />
                  </div>
                ) : null}
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-muted-foreground">Category</label>
                <Select
                  value={formData.category}
                  onChange={(event) => setFormData((prev) => ({ ...prev, category: event.target.value }))}
                >
                  {REMINDER_CATEGORY_OPTIONS.map((category) => (
                    <option key={category.key} value={category.key}>
                      {category.label}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-sm font-medium text-slate-700">Ulang reminder</label>
                  <Checkbox
                    checked={isRecurringEnabled}
                    onCheckedChange={(checked) => setFormData((prev) => ({
                      ...prev,
                      recurrence: checked === true ? (prev.recurrence === 'none' ? 'weekly' : prev.recurrence) : 'none',
                      recurrence_interval: normalizeReminderRecurrenceInterval(prev.recurrence_interval),
                      recurrence_until: checked === true ? prev.recurrence_until : '',
                    }))}
                  />
                </div>

                {isRecurringEnabled ? (
                  <>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      <div className="md:col-span-1">
                        <label className="mb-1 block text-xs font-medium text-slate-500">Kekerapan</label>
                        <Select
                          value={formData.recurrence}
                          onChange={(event) => setFormData((prev) => ({ ...prev, recurrence: event.target.value }))}
                        >
                          {REMINDER_RECURRENCE_OPTIONS.filter((option) => option.key !== 'none').map((option) => (
                            <option key={option.key} value={option.key}>
                              {option.label}
                            </option>
                          ))}
                        </Select>
                      </div>

                      <div className="md:col-span-1">
                        <label className="mb-1 block text-xs font-medium text-slate-500">Setiap</label>
                        <Input
                          type="number"
                          min="1"
                          max="365"
                          value={formData.recurrence_interval}
                          onChange={(event) => setFormData((prev) => ({
                            ...prev,
                            recurrence_interval: normalizeReminderRecurrenceInterval(event.target.value),
                          }))}
                        />
                      </div>

                      <div className="md:col-span-1">
                        <label className="mb-1 block text-xs font-medium text-slate-500">Sehingga (Opsyenal)</label>
                        <Input
                          type="date"
                          value={formData.recurrence_until}
                          min={formData.start_date || undefined}
                          onChange={(event) => setFormData((prev) => ({ ...prev, recurrence_until: event.target.value }))}
                        />
                      </div>
                    </div>

                    <p className="text-xs text-slate-600">
                      Contoh: {recurrenceExampleText || 'Mingguan setiap 1 minggu sehingga 30 Jun.'}
                    </p>
                  </>
                ) : null}
              </div>

              {formError ? (
                <p className="text-sm font-medium text-destructive">{formError}</p>
              ) : null}

              <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={onCancel} disabled={isSaving}>
                  Batal
                </Button>
                <Button type="submit" className="brand-gradient brand-gradient-hover text-white" disabled={isSaving}>
                  {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Simpan
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
};

export default ReminderFormModal;
