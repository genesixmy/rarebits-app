import { COURIER_PAYMENT_MODES, resolveCourierPaymentModeForInvoice } from '@/lib/shipping';

const DAY_MS = 24 * 60 * 60 * 1000;

const toNonNegativeNumber = (value, fallback = 0) => {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(parsed, 0);
};

const toQuantity = (value) => {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
};

const startOfLocalDay = (dateValue) => {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};

const addDays = (dateValue, days) => {
  const next = new Date(dateValue);
  next.setDate(next.getDate() + days);
  return next;
};

const toDateKey = (dateValue) => {
  const date = startOfLocalDay(dateValue);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseInvoiceDate = (invoiceDate) => {
  if (!invoiceDate) return null;
  if (typeof invoiceDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)) {
    const [year, month, day] = invoiceDate.split('-').map((part) => Number.parseInt(part, 10));
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
    return new Date(year, month - 1, day);
  }

  const parsed = new Date(invoiceDate);
  if (Number.isNaN(parsed.getTime())) return null;
  return startOfLocalDay(parsed);
};

const isDateInWindow = (dateValue, window) => (
  dateValue >= window.start && dateValue <= window.end
);

const getEffectiveCostPrice = (saleRow) => {
  const lineCostPrice = Number.parseFloat(saleRow?.cost_price);
  const hasLineCost = Number.isFinite(lineCostPrice) && lineCostPrice > 0;
  if (hasLineCost) return lineCostPrice;

  if (!saleRow?.is_manual) {
    const itemFallbackCost = Number.parseFloat(saleRow?.items?.cost_price);
    if (Number.isFinite(itemFallbackCost) && itemFallbackCost >= 0) {
      return itemFallbackCost;
    }
  }

  if (Number.isFinite(lineCostPrice) && lineCostPrice >= 0) {
    return lineCostPrice;
  }

  return 0;
};

const resolveInvoiceFinancials = (invoice, fallbackOriginal = 0) => {
  const fallback = Math.max(toNonNegativeNumber(fallbackOriginal, 0), 0);
  const totalAmountRaw = Number.parseFloat(invoice?.total_amount);
  const totalAmount = Number.isFinite(totalAmountRaw) && totalAmountRaw >= 0
    ? totalAmountRaw
    : fallback;

  const adjustmentRaw = Number.parseFloat(invoice?.adjustment_total);
  const adjustmentTotal = Number.isFinite(adjustmentRaw) && adjustmentRaw > 0
    ? adjustmentRaw
    : 0;

  const returnedRaw = Number.parseFloat(invoice?.returned_total);
  const returnedTotal = Number.isFinite(returnedRaw) && returnedRaw > 0
    ? returnedRaw
    : 0;

  const finalRaw = Number.parseFloat(invoice?.final_total);
  const finalTotal = Number.isFinite(finalRaw)
    ? Math.max(Math.min(finalRaw, totalAmount), 0)
    : Math.max(totalAmount - adjustmentTotal - returnedTotal, 0);

  return {
    totalAmount,
    finalTotal,
    adjustmentTotal,
    returnedTotal,
  };
};

const getInvoiceItemReturnEntries = (saleRow) => (
  Array.isArray(saleRow?.invoice_item_returns) ? saleRow.invoice_item_returns : []
);

const getReturnedQuantityForRow = (saleRow) => getInvoiceItemReturnEntries(saleRow).reduce((sum, entry) => {
  const qty = Number.parseFloat(entry?.returned_quantity);
  return sum + (Number.isFinite(qty) && qty > 0 ? qty : 0);
}, 0);

const getReturnedRefundTotalForRow = (saleRow) => getInvoiceItemReturnEntries(saleRow).reduce((sum, entry) => {
  const amount = Number.parseFloat(entry?.refund_amount);
  return sum + (Number.isFinite(amount) && amount > 0 ? amount : 0);
}, 0);

const getPctChange = (currentValue, previousValue) => {
  if (previousValue <= 0) return null;
  return ((currentValue - previousValue) / previousValue) * 100;
};

const formatRM = (amount) => `RM${toNonNegativeNumber(amount, 0).toFixed(2)}`;

const resolveSeverity = (impactAmount, revenueBase) => {
  const impact = toNonNegativeNumber(impactAmount, 0);
  const denominator = Math.max(toNonNegativeNumber(revenueBase, 0), 1);
  const ratio = impact / denominator;

  if (ratio >= 0.2 || impact >= 200) return 'danger';
  if (ratio >= 0.08 || impact >= 80) return 'warn';
  return 'info';
};

const createReason = ({
  key,
  type,
  label,
  deltaAmount = null,
  impactAmount = 0,
  explanation,
  effect,
  revenueBase = 0,
}) => ({
  key,
  type,
  label,
  delta_amount: deltaAmount,
  deltaAmount,
  impact_amount: impactAmount,
  impactAmount,
  explanation,
  effect,
  severity: resolveSeverity(impactAmount, revenueBase),
});

const aggregateWindowMetrics = (rows, window) => {
  const selectedRows = rows.filter((row) => isDateInWindow(row.invoiceDateObj, window));

  let itemRevenueTotal = 0;
  let costTotal = 0;
  const shippingByInvoice = new Map();
  const channelFeeByInvoice = new Map();
  const invoiceMetaById = new Map();
  const itemRevenueByInvoice = new Map();

  selectedRows.forEach((row) => {
    const invoice = row?.invoices;
    const invoiceId = invoice?.id;
    if (!invoiceId) return;

    const lineRevenue = toNonNegativeNumber(row?.line_total, 0);
    const quantity = toQuantity(row?.quantity);
    const returnedQty = getReturnedQuantityForRow(row);
    const returnedRefundTotal = getReturnedRefundTotalForRow(row);
    const netQuantity = Math.max(quantity - returnedQty, 0);
    const netLineRevenue = lineRevenue - returnedRefundTotal;
    const unitCost = getEffectiveCostPrice(row);

    itemRevenueTotal += netLineRevenue;
    costTotal += unitCost * netQuantity;
    itemRevenueByInvoice.set(invoiceId, (itemRevenueByInvoice.get(invoiceId) || 0) + netLineRevenue);
    if (!invoiceMetaById.has(invoiceId)) {
      invoiceMetaById.set(invoiceId, invoice);
    }

    if (!channelFeeByInvoice.has(invoiceId)) {
      channelFeeByInvoice.set(invoiceId, toNonNegativeNumber(invoice?.channel_fee_amount, 0));
    }

    if (!shippingByInvoice.has(invoiceId)) {
      const paymentMode = resolveCourierPaymentModeForInvoice(invoice);
      const isPlatformMode = paymentMode === COURIER_PAYMENT_MODES.PLATFORM;
      const shippingCharged = isPlatformMode ? 0 : toNonNegativeNumber(invoice?.shipping_charged, 0);
      const shippingCost = isPlatformMode ? 0 : toNonNegativeNumber(invoice?.shipment?.shipping_cost, 0);
      const isCourierPaid = isPlatformMode ? true : Boolean(invoice?.shipment?.courier_paid);
      const shippingCostPaid = isCourierPaid ? shippingCost : 0;

      shippingByInvoice.set(invoiceId, {
        shippingCharged,
        shippingCostPaid,
        shippingLoss: Math.max(shippingCostPaid - shippingCharged, 0),
      });
    }
  });

  const shippingChargedTotal = Array.from(shippingByInvoice.values()).reduce(
    (sum, value) => sum + value.shippingCharged,
    0
  );
  const shippingCostTotal = Array.from(shippingByInvoice.values()).reduce(
    (sum, value) => sum + value.shippingCostPaid,
    0
  );
  const shippingLossTotal = Array.from(shippingByInvoice.values()).reduce(
    (sum, value) => sum + value.shippingLoss,
    0
  );
  const platformFeeTotal = Array.from(channelFeeByInvoice.values()).reduce(
    (sum, fee) => sum + fee,
    0
  );
  const adjustmentTotal = Array.from(invoiceMetaById.entries()).reduce((sum, [invoiceId, invoice]) => {
    const itemRevenue = itemRevenueByInvoice.get(invoiceId) || 0;
    const shippingCharged = shippingByInvoice.get(invoiceId)?.shippingCharged || 0;
    const fallbackOriginal = itemRevenue + shippingCharged;
    const financials = resolveInvoiceFinancials(invoice, fallbackOriginal);
    return sum + financials.adjustmentTotal;
  }, 0);
  const returnedTotal = Array.from(invoiceMetaById.entries()).reduce((sum, [invoiceId, invoice]) => {
    const itemRevenue = itemRevenueByInvoice.get(invoiceId) || 0;
    const shippingCharged = shippingByInvoice.get(invoiceId)?.shippingCharged || 0;
    const fallbackOriginal = itemRevenue + shippingCharged;
    const financials = resolveInvoiceFinancials(invoice, fallbackOriginal);
    return sum + financials.returnedTotal;
  }, 0);

  const shippingProfitTotal = shippingChargedTotal - shippingCostTotal;
  const profitTotal = (itemRevenueTotal - costTotal - platformFeeTotal) + shippingProfitTotal - adjustmentTotal;
  const revenueTotal = (itemRevenueTotal + shippingChargedTotal) - adjustmentTotal;

  return {
    revenueTotal,
    profitTotal,
    itemRevenueTotal,
    costTotal,
    platformFeeTotal,
    shippingChargedTotal,
    shippingCostTotal,
    shippingLossTotal,
    shippingProfitTotal,
    adjustmentTotal,
    returnedTotal,
    marginPct: revenueTotal > 0 ? (profitTotal / revenueTotal) * 100 : 0,
    invoiceCount: shippingByInvoice.size,
    rowCount: selectedRows.length,
  };
};

const buildLeakReasons = ({ thisWeek, prevWeek, hasPreviousData }) => {
  const revenueBase = Math.max(thisWeek.revenueTotal, 1);
  const deltaShippingLoss = thisWeek.shippingLossTotal - prevWeek.shippingLossTotal;
  const deltaShippingCost = thisWeek.shippingCostTotal - prevWeek.shippingCostTotal;
  const deltaPlatformFee = thisWeek.platformFeeTotal - prevWeek.platformFeeTotal;
  const deltaCostTotal = thisWeek.costTotal - prevWeek.costTotal;
  const deltaAdjustmentTotal = thisWeek.adjustmentTotal - prevWeek.adjustmentTotal;
  const deltaReturnedTotal = thisWeek.returnedTotal - prevWeek.returnedTotal;
  const reasons = [];

  if (hasPreviousData) {
    if (deltaShippingLoss > 0 || (thisWeek.shippingLossTotal > 0 && prevWeek.shippingLossTotal === 0)) {
      const lossDelta = Math.max(deltaShippingLoss, 0);
      reasons.push(createReason({
        key: 'shipping_loss',
        type: 'shipping',
        label: 'Shipping rugi',
        deltaAmount: lossDelta > 0 ? lossDelta : null,
        impactAmount: lossDelta > 0 ? lossDelta : thisWeek.shippingLossTotal,
        explanation: `Courier minggu ini ${formatRM(thisWeek.shippingCostTotal)} tetapi caj pos dikutip ${formatRM(thisWeek.shippingChargedTotal)}.`,
        effect: `Kesan: -${formatRM(thisWeek.shippingLossTotal)} pada profit minggu ini.`,
        revenueBase,
      }));
    } else if (deltaShippingCost > 0) {
      reasons.push(createReason({
        key: 'shipping_cost',
        type: 'shipping',
        label: 'Kos shipping meningkat',
        deltaAmount: deltaShippingCost,
        impactAmount: deltaShippingCost,
        explanation: `Kos courier naik ${formatRM(deltaShippingCost)} berbanding minggu lepas.`,
        effect: 'Kesan: margin tertekan jika caj pos tidak naik seiring.',
        revenueBase,
      }));
    }

    if (deltaPlatformFee > 0) {
      reasons.push(createReason({
        key: 'platform_fee',
        type: 'platform',
        label: 'Fi platform meningkat',
        deltaAmount: deltaPlatformFee,
        impactAmount: deltaPlatformFee,
        explanation: `Fi platform minggu ini ${formatRM(thisWeek.platformFeeTotal)}, naik ${formatRM(deltaPlatformFee)}.`,
        effect: `Kesan: -${formatRM(deltaPlatformFee)} pada profit berbanding minggu lepas.`,
        revenueBase,
      }));
    }

    if (deltaCostTotal > 0) {
      reasons.push(createReason({
        key: 'cost_up',
        type: 'cost',
        label: 'Modal barang naik',
        deltaAmount: deltaCostTotal,
        impactAmount: deltaCostTotal,
        explanation: `Modal barang minggu ini ${formatRM(thisWeek.costTotal)}, naik ${formatRM(deltaCostTotal)}.`,
        effect: 'Kesan: margin jadi lebih nipis walaupun jualan naik.',
        revenueBase,
      }));
    }

    if (deltaAdjustmentTotal > 0 || (thisWeek.adjustmentTotal > 0 && prevWeek.adjustmentTotal === 0)) {
      const adjustmentImpact = Math.max(deltaAdjustmentTotal, 0) || thisWeek.adjustmentTotal;
      reasons.push(createReason({
        key: 'adjustment_up',
        type: 'adjustment',
        label: 'Pelarasan refund meningkat',
        deltaAmount: deltaAdjustmentTotal > 0 ? deltaAdjustmentTotal : null,
        impactAmount: adjustmentImpact,
        explanation: `Pelarasan refund/goodwill minggu ini ${formatRM(thisWeek.adjustmentTotal)}.`,
        effect: `Kesan: revenue dan profit turun ${formatRM(adjustmentImpact)} berbanding baseline asal.`,
        revenueBase,
      }));
    }

    if (deltaReturnedTotal > 0 || (thisWeek.returnedTotal > 0 && prevWeek.returnedTotal === 0)) {
      const returnImpact = Math.max(deltaReturnedTotal, 0) || thisWeek.returnedTotal;
      reasons.push(createReason({
        key: 'return_up',
        type: 'return',
        label: 'Return item meningkat',
        deltaAmount: deltaReturnedTotal > 0 ? deltaReturnedTotal : null,
        impactAmount: returnImpact,
        explanation: `Nilai return item minggu ini ${formatRM(thisWeek.returnedTotal)}.`,
        effect: `Kesan: revenue dan profit turun ${formatRM(returnImpact)} berbanding minggu lepas.`,
        revenueBase,
      }));
    }
  } else {
    if (thisWeek.shippingLossTotal > 0) {
      reasons.push(createReason({
        key: 'shipping_loss_now',
        type: 'shipping',
        label: 'Shipping rugi',
        impactAmount: thisWeek.shippingLossTotal,
        explanation: `Courier ${formatRM(thisWeek.shippingCostTotal)} lebih tinggi dari caj pos ${formatRM(thisWeek.shippingChargedTotal)} minggu ini.`,
        effect: `Kesan: -${formatRM(thisWeek.shippingLossTotal)} pada profit minggu ini.`,
        revenueBase,
      }));
    }

    if (thisWeek.costTotal > 0) {
      reasons.push(createReason({
        key: 'cost_now',
        type: 'cost',
        label: 'Modal barang tinggi',
        impactAmount: thisWeek.costTotal,
        explanation: `Modal barang minggu ini ${formatRM(thisWeek.costTotal)}.`,
        effect: 'Kesan: margin mengecil bila jualan banyak item modal tinggi.',
        revenueBase,
      }));
    }

    if (thisWeek.platformFeeTotal > 0) {
      reasons.push(createReason({
        key: 'platform_now',
        type: 'platform',
        label: 'Fi platform ditolak',
        impactAmount: thisWeek.platformFeeTotal,
        explanation: `Fi platform minggu ini ${formatRM(thisWeek.platformFeeTotal)}.`,
        effect: `Kesan: -${formatRM(thisWeek.platformFeeTotal)} pada profit.`,
        revenueBase,
      }));
    }

    if (thisWeek.adjustmentTotal > 0) {
      reasons.push(createReason({
        key: 'adjustment_now',
        type: 'adjustment',
        label: 'Pelarasan refund direkod',
        impactAmount: thisWeek.adjustmentTotal,
        explanation: `Pelarasan refund/goodwill minggu ini ${formatRM(thisWeek.adjustmentTotal)}.`,
        effect: `Kesan: nilai jualan bersih minggu ini berkurang ${formatRM(thisWeek.adjustmentTotal)}.`,
        revenueBase,
      }));
    }

    if (thisWeek.returnedTotal > 0) {
      reasons.push(createReason({
        key: 'return_now',
        type: 'return',
        label: 'Return item direkod',
        impactAmount: thisWeek.returnedTotal,
        explanation: `Nilai return item minggu ini ${formatRM(thisWeek.returnedTotal)}.`,
        effect: `Kesan: jualan bersih minggu ini berkurang ${formatRM(thisWeek.returnedTotal)}.`,
        revenueBase,
      }));
    }
  }

  return reasons
    .sort((left, right) => right.impactAmount - left.impactAmount)
    .slice(0, 2);
};

const resolveGapIndicator = ({ hasPreviousData, revenueChangePct, profitChangePct }) => {
  if (!hasPreviousData || !Number.isFinite(revenueChangePct) || !Number.isFinite(profitChangePct)) {
    return { label: 'Belum ada data perbandingan', tone: 'neutral' };
  }

  if (revenueChangePct > 0 && profitChangePct < (revenueChangePct - 3)) {
    const gap = revenueChangePct - profitChangePct;
    if (gap >= 15 || profitChangePct <= 0) {
      return { label: 'Revenue naik, Profit tak ikut', tone: 'danger' };
    }
    return { label: 'Revenue naik, Profit tak ikut', tone: 'warn' };
  }

  if (profitChangePct > (revenueChangePct + 3)) {
    return { label: 'Profit lebih laju dari revenue', tone: 'success' };
  }

  if (revenueChangePct < 0 && profitChangePct < 0) {
    return { label: 'Revenue & profit sama-sama menurun', tone: 'warn' };
  }

  return { label: 'Revenue dan profit bergerak seimbang', tone: 'info' };
};

export const getRollingWeekWindows = (nowDate = new Date()) => {
  const today = startOfLocalDay(nowDate);
  const thisStart = addDays(today, -6);
  const prevStart = addDays(today, -13);
  const prevEnd = addDays(today, -7);

  return {
    thisWeek: {
      start: thisStart,
      end: today,
      startDate: toDateKey(thisStart),
      endDate: toDateKey(today),
    },
    prevWeek: {
      start: prevStart,
      end: prevEnd,
      startDate: toDateKey(prevStart),
      endDate: toDateKey(prevEnd),
    },
  };
};

export const calculateRealityCheck = ({
  invoiceItems = [],
  nowDate = new Date(),
}) => {
  const windows = getRollingWeekWindows(nowDate);
  const minWindowDate = windows.prevWeek.start;
  const maxWindowDate = windows.thisWeek.end;

  const rows = (Array.isArray(invoiceItems) ? invoiceItems : [])
    .filter((row) => {
      const invoice = row?.invoices;
      return invoice && ['paid', 'partially_returned', 'returned'].includes(invoice.status);
    })
    .map((row) => ({
      ...row,
      invoiceDateObj: parseInvoiceDate(row?.invoices?.invoice_date),
    }))
    .filter((row) => row.invoiceDateObj && row.invoiceDateObj >= minWindowDate && row.invoiceDateObj <= maxWindowDate);

  const thisWeek = aggregateWindowMetrics(rows, windows.thisWeek);
  const prevWeek = aggregateWindowMetrics(rows, windows.prevWeek);

  const revenueChangePct = getPctChange(thisWeek.revenueTotal, prevWeek.revenueTotal);
  const profitChangePct = getPctChange(thisWeek.profitTotal, prevWeek.profitTotal);
  const hasPreviousData = prevWeek.revenueTotal > 0 || prevWeek.profitTotal !== 0;
  const reasons = buildLeakReasons({ thisWeek, prevWeek, hasPreviousData });
  const gapIndicator = resolveGapIndicator({ hasPreviousData, revenueChangePct, profitChangePct });
  const isProfitLagging = (
    Number.isFinite(revenueChangePct)
    && Number.isFinite(profitChangePct)
    && revenueChangePct > 0
    && profitChangePct < (revenueChangePct - 3)
  );

  const isSlowWeek = hasPreviousData
    ? (
      Number.isFinite(revenueChangePct)
      && Number.isFinite(profitChangePct)
      && revenueChangePct < 0
      && profitChangePct < 0
    )
    : (thisWeek.revenueTotal < 200 && thisWeek.profitTotal < 80);

  return {
    windows,
    thisWeek,
    prevWeek,
    hasPreviousData,
    revenueChangePct,
    profitChangePct,
    reasons,
    gapIndicator,
    isProfitLagging,
    isSlowWeek,
    generatedAt: startOfLocalDay(nowDate).getTime() / DAY_MS,
  };
};

export default calculateRealityCheck;
