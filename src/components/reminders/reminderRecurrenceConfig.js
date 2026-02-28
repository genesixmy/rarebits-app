export const REMINDER_RECURRENCE_OPTIONS = [
  { key: 'none', label: 'Tiada' },
  { key: 'daily', label: 'Harian' },
  { key: 'weekly', label: 'Mingguan' },
  { key: 'monthly', label: 'Bulanan' },
];

const RECURRENCE_LABEL_MAP = REMINDER_RECURRENCE_OPTIONS.reduce((acc, option) => {
  acc[option.key] = option.label;
  return acc;
}, {});

export const normalizeReminderRecurrence = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return RECURRENCE_LABEL_MAP[normalized] ? normalized : 'none';
};

export const normalizeReminderRecurrenceInterval = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(parsed, 365);
};

export const getReminderRecurrenceLabel = (value) => (
  RECURRENCE_LABEL_MAP[normalizeReminderRecurrence(value)] || RECURRENCE_LABEL_MAP.none
);

export const formatRecurrenceExampleText = ({ recurrence, interval, untilDateKey }) => {
  const normalizedRecurrence = normalizeReminderRecurrence(recurrence);
  if (normalizedRecurrence === 'none') return '';

  const normalizedInterval = normalizeReminderRecurrenceInterval(interval);
  const frequencyText = normalizedRecurrence === 'daily'
    ? `Harian setiap ${normalizedInterval} hari`
    : normalizedRecurrence === 'weekly'
      ? `Mingguan setiap ${normalizedInterval} minggu`
      : `Bulanan setiap ${normalizedInterval} bulan`;

  if (!untilDateKey) return `${frequencyText}.`;

  const untilDate = new Date(untilDateKey);
  const untilText = Number.isNaN(untilDate.getTime())
    ? untilDateKey
    : untilDate.toLocaleDateString('ms-MY', { day: 'numeric', month: 'short' });

  return `${frequencyText} sehingga ${untilText}.`;
};
