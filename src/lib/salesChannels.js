export const SALES_CHANNEL_FEE_TYPES = Object.freeze({
  NONE: 'none',
  PERCENTAGE: 'percentage',
  FIXED: 'fixed',
});

const toNonNegativeNumber = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(parsed, 0);
};

const roundCurrency = (value) => Math.round(toNonNegativeNumber(value) * 100) / 100;

export const normalizeSalesChannelFeeType = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === SALES_CHANNEL_FEE_TYPES.PERCENTAGE) return SALES_CHANNEL_FEE_TYPES.PERCENTAGE;
  if (normalized === SALES_CHANNEL_FEE_TYPES.FIXED) return SALES_CHANNEL_FEE_TYPES.FIXED;
  return SALES_CHANNEL_FEE_TYPES.NONE;
};

export const calculateSalesChannelFee = (subtotal, channel) => {
  const safeSubtotal = toNonNegativeNumber(subtotal);
  const feeType = normalizeSalesChannelFeeType(channel?.fee_type);
  const feeValue = toNonNegativeNumber(channel?.fee_value);

  if (feeType === SALES_CHANNEL_FEE_TYPES.PERCENTAGE) {
    return roundCurrency((safeSubtotal * feeValue) / 100);
  }

  if (feeType === SALES_CHANNEL_FEE_TYPES.FIXED) {
    return roundCurrency(feeValue);
  }

  return 0;
};

export const formatSalesChannelFeeLabel = (channel) => {
  if (!channel) return 'Tiada caj platform';

  const feeType = normalizeSalesChannelFeeType(channel.fee_type);
  const feeValue = toNonNegativeNumber(channel.fee_value);

  if (feeType === SALES_CHANNEL_FEE_TYPES.PERCENTAGE) {
    return `${feeValue}% daripada subtotal`;
  }

  if (feeType === SALES_CHANNEL_FEE_TYPES.FIXED) {
    return `RM ${roundCurrency(feeValue).toFixed(2)} tetap`;
  }

  return 'Tiada caj platform';
};
