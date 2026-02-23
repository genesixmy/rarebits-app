const DAY_MS = 24 * 60 * 60 * 1000;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const parseNonNegativeNumber = (value, fallback = 0) => {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(parsed, 0);
};

const parseNonNegativeInteger = (value, fallback = 0) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(parsed, 0);
};

export const getItemReservedQuantity = (item) => {
  const reservations = Array.isArray(item?.inventory_reservations) ? item.inventory_reservations : [];
  if (reservations.length > 0) {
    return reservations.reduce((sum, reservation) => {
      const qty = parseNonNegativeInteger(reservation?.quantity_reserved, 0);
      return sum + qty;
    }, 0);
  }
  return parseNonNegativeInteger(item?.quantity_reserved, 0);
};

export const getItemAvailableQuantity = (item) => {
  const totalQuantity = parseNonNegativeInteger(item?.quantity, 1);
  const reservedQuantity = getItemReservedQuantity(item);
  return Math.max(totalQuantity - reservedQuantity, 0);
};

export const getItemAgingDays = (createdAt, nowDate = new Date()) => {
  if (!createdAt) return null;
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return null;

  const createdUtc = Date.UTC(
    created.getUTCFullYear(),
    created.getUTCMonth(),
    created.getUTCDate()
  );
  const nowUtc = Date.UTC(
    nowDate.getUTCFullYear(),
    nowDate.getUTCMonth(),
    nowDate.getUTCDate()
  );
  return Math.max(Math.floor((nowUtc - createdUtc) / DAY_MS), 0);
};

const resolveHealthLabel = (score) => {
  if (score <= 39) return 'Critical';
  if (score <= 59) return 'Weak';
  if (score <= 79) return 'Stable';
  return 'Strong';
};

const getCashBufferPoints = (cashBufferDays) => {
  if (cashBufferDays >= 30) return 30;
  if (cashBufferDays >= 14) return 20;
  if (cashBufferDays >= 7) return 10;
  return 0;
};

const getStuckCapitalDeduction = (stuckRatio) => {
  if (stuckRatio >= 0.5) return 30;
  if (stuckRatio >= 0.3) return 20;
  if (stuckRatio >= 0.15) return 10;
  return 0;
};

const getSellThroughPoints = (sellThrough30d) => {
  if (sellThrough30d >= 0.3) return 25;
  if (sellThrough30d >= 0.15) return 15;
  if (sellThrough30d >= 0.05) return 7;
  return 0;
};

const getUnderperformDeduction = (underperformingCategoriesCount) => {
  if (underperformingCategoriesCount >= 5) return 15;
  if (underperformingCategoriesCount >= 3) return 10;
  if (underperformingCategoriesCount >= 1) return 5;
  return 0;
};

export const calculateBusinessHealth = ({
  items = [],
  walletBalance = 0,
  expensesTotal30d = 0,
  soldQty30d = 0,
  categorySales30d = {},
  underperformThresholdValue = 200,
  nowDate = new Date(),
}) => {
  const now = nowDate instanceof Date ? nowDate : new Date(nowDate);

  const activeItemRows = (Array.isArray(items) ? items : []).map((item) => {
    const availableQty = getItemAvailableQuantity(item);
    const status = String(item?.status || '').trim().toLowerCase();
    const agingDays = getItemAgingDays(item?.created_at, now);
    const costPrice = parseNonNegativeNumber(item?.cost_price, 0);
    const categoryName = (item?.category || 'Lain-lain').trim() || 'Lain-lain';
    const stockCostValue = costPrice * availableQty;

    return {
      availableQty,
      status,
      agingDays,
      costPrice,
      categoryName,
      stockCostValue,
    };
  }).filter((row) => row.availableQty > 0 && row.status !== 'terjual');

  const activeStockQty = activeItemRows.reduce((sum, row) => sum + row.availableQty, 0);
  const totalStockCostValue = activeItemRows.reduce((sum, row) => sum + row.stockCostValue, 0);
  const stuckCapital60d = activeItemRows.reduce((sum, row) => (
    sum + ((row.agingDays !== null && row.agingDays >= 60) ? row.stockCostValue : 0)
  ), 0);

  const categoryStockValueMap = activeItemRows.reduce((acc, row) => {
    acc[row.categoryName] = (acc[row.categoryName] || 0) + row.stockCostValue;
    return acc;
  }, {});

  const normalizedCategorySalesMap = Object.entries(categorySales30d || {}).reduce((acc, [category, value]) => {
    acc[category] = parseNonNegativeNumber(value, 0);
    return acc;
  }, {});

  const underperformingCategories = Object.entries(categoryStockValueMap)
    .filter(([category, stockValue]) => (
      stockValue >= underperformThresholdValue
      && parseNonNegativeNumber(normalizedCategorySalesMap[category], 0) === 0
    ))
    .map(([category]) => category);

  const underperformingCategoriesCount = underperformingCategories.length;
  const avgDailyExpenses30d = Math.max(1, parseNonNegativeNumber(expensesTotal30d, 0) / 30);
  const cashBufferDays = parseNonNegativeNumber(walletBalance, 0) / avgDailyExpenses30d;
  const sellThrough30d = parseNonNegativeNumber(soldQty30d, 0) / Math.max(1, activeStockQty);
  const ratioStuck = stuckCapital60d / Math.max(1, totalStockCostValue);

  const cashBufferPoints = getCashBufferPoints(cashBufferDays);
  const sellThroughPoints = getSellThroughPoints(sellThrough30d);
  const stuckCapitalDeduction = getStuckCapitalDeduction(ratioStuck);
  const underperformDeduction = getUnderperformDeduction(underperformingCategoriesCount);

  const cashBufferPenalty = 30 - cashBufferPoints;
  const sellThroughPenalty = 25 - sellThroughPoints;

  const finalScore = clamp(
    Math.round(100 - cashBufferPenalty - stuckCapitalDeduction - sellThroughPenalty - underperformDeduction),
    0,
    100
  );

  const reasons = [
    (stuckCapital60d > 0)
      ? { key: 'stuck_capital', impact: stuckCapitalDeduction, value: stuckCapital60d }
      : null,
    (underperformingCategoriesCount > 0)
      ? { key: 'underperform_categories', impact: underperformDeduction, value: underperformingCategoriesCount }
      : null,
    (cashBufferPenalty > 0 && cashBufferDays < 7)
      ? { key: 'cash_buffer_low', impact: cashBufferPenalty, value: cashBufferDays }
      : null,
    (sellThroughPenalty > 0 && sellThrough30d < 0.15)
      ? { key: 'sell_through_low', impact: sellThroughPenalty, value: sellThrough30d }
      : null,
  ].filter(Boolean).sort((a, b) => b.impact - a.impact);

  return {
    score: finalScore,
    label: resolveHealthLabel(finalScore),
    metrics: {
      cashBufferDays,
      avgDailyExpenses30d,
      stuckCapital60d,
      totalStockCostValue,
      ratioStuck,
      sellThrough30d,
      soldQty30d: parseNonNegativeNumber(soldQty30d, 0),
      activeStockQty,
      underperformingCategoriesCount,
      underperformingCategories,
      expensesTotal30d: parseNonNegativeNumber(expensesTotal30d, 0),
      walletBalance: parseNonNegativeNumber(walletBalance, 0),
    },
    scoreBreakdown: {
      cashBufferPoints,
      sellThroughPoints,
      stuckCapitalDeduction,
      underperformDeduction,
      cashBufferPenalty,
      sellThroughPenalty,
    },
    reasons,
  };
};

export default calculateBusinessHealth;
