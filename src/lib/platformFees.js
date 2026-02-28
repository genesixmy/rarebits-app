export const PLATFORM_FEE_TYPES = Object.freeze({
  PERCENTAGE: 'percentage',
  FLAT: 'flat',
});

export const PLATFORM_FEE_APPLIES_TO = Object.freeze({
  ITEM_SUBTOTAL: 'item_subtotal',
  SHIPPING_CHARGED: 'shipping_charged',
  TOTAL_COLLECTED: 'total_collected',
});

const toNonNegativeNumber = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(parsed, 0);
};

const roundCurrency = (value) => Math.round(toNonNegativeNumber(value) * 100) / 100;

export const normalizePlatformFeeType = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === PLATFORM_FEE_TYPES.PERCENTAGE) return PLATFORM_FEE_TYPES.PERCENTAGE;
  return PLATFORM_FEE_TYPES.FLAT;
};

export const normalizePlatformFeeAppliesTo = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === PLATFORM_FEE_APPLIES_TO.SHIPPING_CHARGED) return PLATFORM_FEE_APPLIES_TO.SHIPPING_CHARGED;
  if (normalized === PLATFORM_FEE_APPLIES_TO.TOTAL_COLLECTED) return PLATFORM_FEE_APPLIES_TO.TOTAL_COLLECTED;
  return PLATFORM_FEE_APPLIES_TO.ITEM_SUBTOTAL;
};

export const getPlatformFeeBaseAmount = (appliesTo, bases = {}) => {
  const normalizedAppliesTo = normalizePlatformFeeAppliesTo(appliesTo);
  if (normalizedAppliesTo === PLATFORM_FEE_APPLIES_TO.SHIPPING_CHARGED) {
    return roundCurrency(bases.shipping_charged);
  }
  if (normalizedAppliesTo === PLATFORM_FEE_APPLIES_TO.TOTAL_COLLECTED) {
    return roundCurrency(bases.total_collected);
  }
  return roundCurrency(bases.item_subtotal);
};

export const calculatePlatformFeeAmount = (baseAmount, rule) => {
  const safeBase = toNonNegativeNumber(baseAmount);
  const feeType = normalizePlatformFeeType(rule?.fee_type);
  const feeValue = toNonNegativeNumber(rule?.fee_value);

  if (safeBase <= 0) return 0;

  if (feeType === PLATFORM_FEE_TYPES.PERCENTAGE) {
    return roundCurrency((safeBase * feeValue) / 100);
  }

  return roundCurrency(feeValue);
};

export const buildInvoiceFeeSnapshots = (selectedRules, baseAmounts = {}) => {
  return (selectedRules || []).map((rule) => {
    const feeType = normalizePlatformFeeType(rule?.fee_type);
    const appliesTo = normalizePlatformFeeAppliesTo(rule?.applies_to);
    const safeBase = getPlatformFeeBaseAmount(appliesTo, baseAmounts);
    const feeValue = roundCurrency(rule?.fee_value);
    const amount = calculatePlatformFeeAmount(safeBase, {
      fee_type: feeType,
      fee_value: feeValue,
    });

    return {
      fee_rule_id: rule?.id || null,
      name: String(rule?.name || '').trim() || 'Platform Fee',
      fee_type: feeType,
      applies_to: appliesTo,
      fee_value: feeValue,
      base_amount: safeBase,
      amount,
    };
  });
};

export const getInvoiceFeeTotal = (feeSnapshots) => {
  return roundCurrency(
    (feeSnapshots || []).reduce((sum, snapshot) => sum + toNonNegativeNumber(snapshot?.amount), 0)
  );
};

export const formatPlatformFeeRuleLabel = (rule) => {
  const feeType = normalizePlatformFeeType(rule?.fee_type);
  const feeValue = roundCurrency(rule?.fee_value);
  if (feeType === PLATFORM_FEE_TYPES.PERCENTAGE) {
    return `${feeValue}%`;
  }
  return `RM ${feeValue.toFixed(2)}`;
};

export const getPlatformFeeAppliesToLabel = (appliesTo) => {
  const normalized = normalizePlatformFeeAppliesTo(appliesTo);
  if (normalized === PLATFORM_FEE_APPLIES_TO.SHIPPING_CHARGED) return 'Caj pos pelanggan';
  if (normalized === PLATFORM_FEE_APPLIES_TO.TOTAL_COLLECTED) return 'Jumlah kutipan';
  return 'Harga barang';
};
