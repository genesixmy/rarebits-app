export const TRANSACTION_CLASSIFICATIONS = {
  SALE: 'sale',
  EXPENSE: 'expense',
  TOPUP: 'topup',
  TRANSFER_IN: 'transfer_in',
  TRANSFER_OUT: 'transfer_out',
  ADJUSTMENT: 'adjustment',
};

const VALID_CLASSIFICATIONS = new Set(Object.values(TRANSACTION_CLASSIFICATIONS));

const LEGACY_TYPE_MAP = {
  sale: TRANSACTION_CLASSIFICATIONS.SALE,
  jualan: TRANSACTION_CLASSIFICATIONS.SALE,
  pembayaran_invois: TRANSACTION_CLASSIFICATIONS.SALE,
  item_manual: TRANSACTION_CLASSIFICATIONS.SALE,
  expense: TRANSACTION_CLASSIFICATIONS.EXPENSE,
  perbelanjaan: TRANSACTION_CLASSIFICATIONS.EXPENSE,
  refund: TRANSACTION_CLASSIFICATIONS.ADJUSTMENT,
  refund_adjustment: TRANSACTION_CLASSIFICATIONS.ADJUSTMENT,
  goodwill_adjustment: TRANSACTION_CLASSIFICATIONS.ADJUSTMENT,
  sales_return: TRANSACTION_CLASSIFICATIONS.ADJUSTMENT,
  topup: TRANSACTION_CLASSIFICATIONS.TOPUP,
  pendapatan: TRANSACTION_CLASSIFICATIONS.TOPUP,
  transfer_in: TRANSACTION_CLASSIFICATIONS.TRANSFER_IN,
  pemindahan_masuk: TRANSACTION_CLASSIFICATIONS.TRANSFER_IN,
  transfer_out: TRANSACTION_CLASSIFICATIONS.TRANSFER_OUT,
  pemindahan_keluar: TRANSACTION_CLASSIFICATIONS.TRANSFER_OUT,
  adjustment: TRANSACTION_CLASSIFICATIONS.ADJUSTMENT,
  pelarasan_manual_tambah: TRANSACTION_CLASSIFICATIONS.ADJUSTMENT,
  pelarasan_manual_kurang: TRANSACTION_CLASSIFICATIONS.ADJUSTMENT,
};

export const normalizeTransactionClassification = ({
  transactionType,
  legacyType,
  amount,
  category,
  invoiceId,
}) => {
  const normalizedTransactionType = (transactionType || '').toLowerCase().trim();
  if (VALID_CLASSIFICATIONS.has(normalizedTransactionType)) {
    return normalizedTransactionType;
  }

  const normalizedLegacyType = (legacyType || '').toLowerCase().trim();
  const mappedFromLegacy = LEGACY_TYPE_MAP[normalizedLegacyType];
  if (mappedFromLegacy) {
    if (mappedFromLegacy === TRANSACTION_CLASSIFICATIONS.TOPUP) {
      const normalizedCategory = (category || '').toLowerCase().trim();
      if (normalizedCategory.includes('pelarasan')) {
        return TRANSACTION_CLASSIFICATIONS.ADJUSTMENT;
      }
    }
    return mappedFromLegacy;
  }

  if (invoiceId) {
    return TRANSACTION_CLASSIFICATIONS.SALE;
  }

  if (Number.isFinite(Number(amount)) && Number(amount) < 0) {
    return TRANSACTION_CLASSIFICATIONS.EXPENSE;
  }

  return TRANSACTION_CLASSIFICATIONS.ADJUSTMENT;
};

export const resolveTransactionClassification = (tx) => normalizeTransactionClassification({
  transactionType: tx?.transaction_type,
  legacyType: tx?.type,
  amount: tx?.amount,
  category: tx?.category,
  invoiceId: tx?.invoice_id,
});

export const getTransactionDirection = (tx) => {
  const classification = resolveTransactionClassification(tx);
  if (classification === TRANSACTION_CLASSIFICATIONS.EXPENSE || classification === TRANSACTION_CLASSIFICATIONS.TRANSFER_OUT) {
    return -1;
  }
  if (classification === TRANSACTION_CLASSIFICATIONS.SALE || classification === TRANSACTION_CLASSIFICATIONS.TOPUP || classification === TRANSACTION_CLASSIFICATIONS.TRANSFER_IN) {
    return 1;
  }

  const legacyType = (tx?.type || '').toLowerCase();
  if (legacyType === 'pelarasan_manual_kurang') {
    return -1;
  }
  if (legacyType === 'pelarasan_manual_tambah') {
    return 1;
  }
  if (legacyType === 'goodwill_adjustment' || legacyType === 'refund_adjustment' || legacyType === 'refund' || legacyType === 'sales_return') {
    return -1;
  }

  const parsedAmount = Number(tx?.amount);
  return Number.isFinite(parsedAmount) && parsedAmount < 0 ? -1 : 1;
};

export const isTransferLegacyType = (type) => {
  const normalized = normalizeTransactionClassification({ legacyType: type });
  return normalized === TRANSACTION_CLASSIFICATIONS.TRANSFER_IN || normalized === TRANSACTION_CLASSIFICATIONS.TRANSFER_OUT;
};

export const isTransferOutLegacyType = (type) =>
  normalizeTransactionClassification({ legacyType: type }) === TRANSACTION_CLASSIFICATIONS.TRANSFER_OUT;

export const classificationLabel = (classification) => {
  switch (classification) {
    case TRANSACTION_CLASSIFICATIONS.SALE:
      return 'Sale';
    case TRANSACTION_CLASSIFICATIONS.EXPENSE:
      return 'Expense';
    case TRANSACTION_CLASSIFICATIONS.TOPUP:
      return 'Top Up';
    case TRANSACTION_CLASSIFICATIONS.TRANSFER_IN:
    case TRANSACTION_CLASSIFICATIONS.TRANSFER_OUT:
      return 'Transfer';
    case TRANSACTION_CLASSIFICATIONS.ADJUSTMENT:
    default:
      return 'Adjustment';
  }
};

export const classificationBadgeClass = (classification) => {
  switch (classification) {
    case TRANSACTION_CLASSIFICATIONS.SALE:
      return 'bg-emerald-100 text-emerald-700';
    case TRANSACTION_CLASSIFICATIONS.EXPENSE:
      return 'bg-red-100 text-red-700';
    case TRANSACTION_CLASSIFICATIONS.TOPUP:
      return 'bg-teal-100 text-teal-700';
    case TRANSACTION_CLASSIFICATIONS.TRANSFER_IN:
    case TRANSACTION_CLASSIFICATIONS.TRANSFER_OUT:
      return 'bg-blue-100 text-blue-700';
    case TRANSACTION_CLASSIFICATIONS.ADJUSTMENT:
    default:
      return 'bg-slate-100 text-slate-700';
  }
};

export const manualTypeToLegacyType = (manualType, adjustmentDirection = 'increase') => {
  if (manualType === TRANSACTION_CLASSIFICATIONS.EXPENSE) {
    return 'perbelanjaan';
  }
  if (manualType === TRANSACTION_CLASSIFICATIONS.TOPUP) {
    return 'pendapatan';
  }
  if (manualType === TRANSACTION_CLASSIFICATIONS.ADJUSTMENT) {
    return adjustmentDirection === 'decrease' ? 'perbelanjaan' : 'pendapatan';
  }
  return 'perbelanjaan';
};
