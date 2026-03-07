export const REGISTRATION_STATUS = Object.freeze({
  REGISTERED: 'registered',
  DROPPED: 'dropped',
});

export const PAYMENT_STATUS = Object.freeze({
  UNPAID: 'unpaid',
  PAID: 'paid',
});

export const CHECK_IN_STATUS = Object.freeze({
  NOT_CHECKED_IN: 'not_checked_in',
  CHECKED_IN: 'checked_in',
});

export const REGISTRATION_STATUS_OPTIONS = [
  { value: REGISTRATION_STATUS.REGISTERED, label: 'Registered' },
  { value: REGISTRATION_STATUS.DROPPED, label: 'Dropped' },
];

export const PAYMENT_STATUS_OPTIONS = [
  { value: PAYMENT_STATUS.UNPAID, label: 'Unpaid' },
  { value: PAYMENT_STATUS.PAID, label: 'Paid' },
];

export const CHECK_IN_STATUS_OPTIONS = [
  { value: CHECK_IN_STATUS.NOT_CHECKED_IN, label: 'Not Checked In' },
  { value: CHECK_IN_STATUS.CHECKED_IN, label: 'Checked In' },
];

export const statusBadgeClass = {
  registration_status: {
    [REGISTRATION_STATUS.REGISTERED]: 'border-cyan-300 bg-cyan-50 text-cyan-700',
    [REGISTRATION_STATUS.DROPPED]: 'border-slate-300 bg-slate-100 text-slate-700',
  },
  payment_status: {
    [PAYMENT_STATUS.PAID]: 'border-emerald-300 bg-emerald-50 text-emerald-700',
    [PAYMENT_STATUS.UNPAID]: 'border-amber-300 bg-amber-50 text-amber-700',
  },
  check_in_status: {
    [CHECK_IN_STATUS.CHECKED_IN]: 'border-violet-300 bg-violet-50 text-violet-700',
    [CHECK_IN_STATUS.NOT_CHECKED_IN]: 'border-rose-300 bg-rose-50 text-rose-700',
  },
};

export const getStatusLabel = (statusType, value) => {
  const map = {
    registration_status: REGISTRATION_STATUS_OPTIONS,
    payment_status: PAYMENT_STATUS_OPTIONS,
    check_in_status: CHECK_IN_STATUS_OPTIONS,
  }[statusType] || [];

  return map.find((option) => option.value === value)?.label || value || '-';
};

