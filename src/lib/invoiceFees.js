const toNonNegativeNumber = (value, fallback = 0) => {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(parsed, 0);
};

export const getInvoiceFeeEffectiveAmount = (feeRow) => {
  const overrideAmount = Number.parseFloat(feeRow?.amount_override);
  if (Number.isFinite(overrideAmount) && overrideAmount >= 0) {
    return overrideAmount;
  }

  return toNonNegativeNumber(feeRow?.amount, 0);
};

export const getInvoicePlatformFeeTotal = (invoiceLike) => {
  const feeRows = Array.isArray(invoiceLike?.invoice_fees) ? invoiceLike.invoice_fees : [];
  if (feeRows.length > 0) {
    return feeRows.reduce((sum, feeRow) => sum + getInvoiceFeeEffectiveAmount(feeRow), 0);
  }

  return toNonNegativeNumber(invoiceLike?.channel_fee_amount, 0);
};

