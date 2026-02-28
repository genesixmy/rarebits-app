export const REMINDER_CATEGORY_OPTIONS = [
  {
    key: 'general',
    label: 'Umum',
    badgeClass: 'border-slate-200 bg-slate-100 text-slate-700',
  },
  {
    key: 'event',
    label: 'Event',
    badgeClass: 'border-sky-200 bg-sky-100 text-sky-700',
  },
  {
    key: 'payment',
    label: 'Bayaran',
    badgeClass: 'border-amber-200 bg-amber-100 text-amber-700',
  },
  {
    key: 'restock',
    label: 'Restock',
    badgeClass: 'border-emerald-200 bg-emerald-100 text-emerald-700',
  },
  {
    key: 'customer',
    label: 'Pelanggan',
    badgeClass: 'border-violet-200 bg-violet-100 text-violet-700',
  },
  {
    key: 'ops',
    label: 'Operasi',
    badgeClass: 'border-indigo-200 bg-indigo-100 text-indigo-700',
  },
];

const REMINDER_CATEGORY_MAP = REMINDER_CATEGORY_OPTIONS.reduce((acc, category) => {
  acc[category.key] = category;
  return acc;
}, {});

export const REMINDER_CATEGORY_FILTER_OPTIONS = [
  { key: 'all', label: 'All' },
  ...REMINDER_CATEGORY_OPTIONS.map(({ key, label }) => ({ key, label })),
];

export const normalizeReminderCategory = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return REMINDER_CATEGORY_MAP[normalized] ? normalized : 'general';
};

export const getReminderCategoryUi = (value) => (
  REMINDER_CATEGORY_MAP[normalizeReminderCategory(value)] || REMINDER_CATEGORY_MAP.general
);
