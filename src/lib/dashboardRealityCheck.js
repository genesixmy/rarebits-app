import { COURIER_PAYMENT_MODES, resolveCourierPaymentModeForInvoice } from '@/lib/shipping';
import { getInvoicePlatformFeeTotal } from '@/lib/invoiceFees';

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

const parseItemDate = (dateValue) => {
  if (!dateValue) return null;
  const parsed = new Date(dateValue);
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
const formatPct = (value) => `${Math.abs(Number.parseFloat(value) || 0).toFixed(1)}%`;

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
      channelFeeByInvoice.set(invoiceId, getInvoicePlatformFeeTotal(invoice));
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
  const shippingCoverageRatio = shippingChargedTotal > 0
    ? (shippingCostTotal / shippingChargedTotal)
    : null;

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
    shippingCoverageRatio,
    adjustmentTotal,
    returnedTotal,
    marginPct: revenueTotal > 0 ? (profitTotal / revenueTotal) * 100 : 0,
    invoiceCount: shippingByInvoice.size,
    rowCount: selectedRows.length,
  };
};

const getItemReservedQuantity = (item) => {
  const reservations = Array.isArray(item?.inventory_reservations) ? item.inventory_reservations : [];
  if (reservations.length > 0) {
    return reservations.reduce((sum, reservation) => (
      sum + toQuantity(reservation?.quantity_reserved)
    ), 0);
  }
  return toQuantity(item?.quantity_reserved);
};

const getItemTotalStockQuantity = (item) => {
  const totalQty = toQuantity(item?.quantity);
  if (totalQty > 0) return totalQty;
  return toQuantity(item?.available_quantity) + getItemReservedQuantity(item);
};

const aggregateInventoryRestock = (inventoryItems, window) => {
  const rows = Array.isArray(inventoryItems) ? inventoryItems : [];
  return rows.reduce((sum, item) => {
    const createdDate = parseItemDate(item?.created_at);
    if (!createdDate || !isDateInWindow(createdDate, window)) return sum;

    const qty = getItemTotalStockQuantity(item);
    if (qty <= 0) return sum;

    const unitCost = toNonNegativeNumber(item?.cost_price, 0);
    return sum + (unitCost * qty);
  }, 0);
};

const createInsight = ({
  key,
  title,
  severity,
  observation,
  impact,
  suggestion,
  impactAmount = 0,
  priority,
}) => ({
  key,
  title,
  severity,
  observation,
  impact,
  suggestion,
  impactAmount: Math.max(toNonNegativeNumber(impactAmount, 0), 0),
  priority,
});

const getInsightActions = (insightKey) => {
  if (insightKey === 'revenue_profit_gap') {
    return [
      { label: 'Semak Item Margin Rendah', href: '/inventory?filter=low_margin', variant: 'default' },
      { label: 'Semak Caj Platform/Pos', href: '/wallet?tab=expenses', variant: 'outline' },
    ];
  }

  if (insightKey === 'profit_drop_with_sales') {
    return [
      { label: 'Lihat Invois Minggu Ini', href: '/invoices?range=this_week&status=paid', variant: 'default' },
      { label: 'Semak Refund/Adjustment', href: '/invoices?range=this_week&has_refund=1', variant: 'outline' },
    ];
  }

  if (insightKey === 'shipping_margin_pressure') {
    return [
      { label: 'Semak Penghantaran', href: '/invoices?range=this_week&status=paid&shipping_state=pending', variant: 'default' },
      { label: 'Ubah Caj Pos Default', href: '/settings', variant: 'outline' },
    ];
  }

  if (insightKey === 'restock_spike_low_sales') {
    return [
      { label: 'Lihat Stok Baru', href: '/inventory?filter=new_stock', variant: 'default' },
      { label: 'Cipta Katalog Clearance', href: '/catalogs/create?mode=clearance', variant: 'outline' },
    ];
  }

  if (insightKey === 'no_sales') {
    return [
      { label: 'Cipta Katalog', href: '/catalogs/create', variant: 'default' },
      { label: 'Semak Stok Aging', href: '/inventory?filter=aging_60', variant: 'outline' },
    ];
  }

  return [];
};

export const generateRealityInsight = ({
  thisWeek,
  prevWeek,
  hasPreviousData,
  revenueChangePct,
  profitChangePct,
  inventoryCostAddedThisWeek,
}) => {
  if (!hasPreviousData) {
    return {
      onboardingMessage: 'Ini minggu pertama data direkod. Reality Check akan mula memberi analisis selepas cukup sejarah jualan.',
      insights: [],
    };
  }

  const insights = [];
  const revenueGrowth = Number.isFinite(revenueChangePct) ? revenueChangePct : null;
  const profitGrowth = Number.isFinite(profitChangePct) ? profitChangePct : null;
  const profitDelta = thisWeek.profitTotal - prevWeek.profitTotal;
  const shippingRatio = thisWeek.shippingCoverageRatio;
  const salesLowThreshold = Math.max(200, inventoryCostAddedThisWeek * 0.6);
  const hasRestockSpike = inventoryCostAddedThisWeek >= 300 && thisWeek.revenueTotal <= salesLowThreshold;

  if (thisWeek.revenueTotal <= 0) {
    insights.push(createInsight({
      key: 'no_sales',
      title: 'Jualan Tiada',
      severity: 'ALERT',
      observation: 'Tiada jualan direkod minggu ini.',
      impact: 'Stok sedang diam tanpa menjana pulangan dan cashflow boleh jadi perlahan.',
      suggestion: 'Pertimbangkan promosi ringan atau listing semula item.',
      impactAmount: thisWeek.revenueTotal,
      priority: 100,
    }));
  }

  if (revenueGrowth !== null && profitGrowth !== null && revenueGrowth > 0 && profitGrowth < revenueGrowth) {
    insights.push(createInsight({
      key: 'revenue_profit_gap',
      title: 'Margin Tidak Ikut Jualan',
      severity: 'ALERT',
      observation: `Jualan meningkat ${formatPct(revenueGrowth)}, tetapi keuntungan hanya ${formatPct(profitGrowth)}.`,
      impact: 'Jualan meningkat, tetapi keuntungan tidak berkembang seiring. Ini biasanya tanda kos meningkat atau harga terlalu rendah.',
      suggestion: 'Semak kos modal atau naikkan sedikit harga untuk lindungi margin.',
      impactAmount: Math.abs(thisWeek.revenueTotal - thisWeek.profitTotal),
      priority: 90,
    }));
  }

  if (thisWeek.revenueTotal > 0 && profitDelta < 0) {
    insights.push(createInsight({
      key: 'profit_drop_with_sales',
      title: 'Keuntungan Menurun',
      severity: 'ALERT',
      observation: `Minggu ini masih ada jualan ${formatRM(thisWeek.revenueTotal)}, tetapi keuntungan turun ${formatRM(Math.abs(profitDelta))} berbanding minggu lepas.`,
      impact: 'Walaupun ada jualan, keuntungan sebenar menurun. Kemungkinan disebabkan diskaun, kos modal tinggi, atau caj platform.',
      suggestion: 'Kenal pasti item margin rendah dan elakkan ulang stok tersebut.',
      impactAmount: Math.abs(profitDelta),
      priority: 85,
    }));
  }

  if (shippingRatio !== null && shippingRatio > 0.7) {
    insights.push(createInsight({
      key: 'shipping_margin_pressure',
      title: 'Caj Pos Terlalu Ketat',
      severity: 'ALERT',
      observation: `Kos courier menggunakan ${formatPct(shippingRatio * 100)} daripada caj pos minggu ini (${formatRM(thisWeek.shippingCostTotal)} / ${formatRM(thisWeek.shippingChargedTotal)}).`,
      impact: 'Sebahagian besar caj pos digunakan untuk bayar courier. Penghantaran hampir tidak memberi keuntungan.',
      suggestion: 'Pertimbang markup kecil pada caj penghantaran.',
      impactAmount: Math.abs(thisWeek.shippingCostTotal - thisWeek.shippingChargedTotal),
      priority: 80,
    }));
  }

  if (hasRestockSpike) {
    insights.push(createInsight({
      key: 'restock_spike_low_sales',
      title: 'Modal Baru Belum Bergerak',
      severity: 'INFO',
      observation: `Modal stok baru sekitar ${formatRM(inventoryCostAddedThisWeek)} masuk minggu ini, tetapi jualan semasa ${formatRM(thisWeek.revenueTotal)}.`,
      impact: 'Modal baru dimasukkan tetapi stok belum bergerak. Cashflow mungkin akan ketat sementara.',
      suggestion: 'Fokus jual stok baru sebelum tambah pembelian lain.',
      impactAmount: inventoryCostAddedThisWeek,
      priority: 70,
    }));
  }

  if (insights.length === 0) {
    insights.push(createInsight({
      key: 'healthy_movement',
      title: 'Pergerakan Sihat',
      severity: 'GOOD',
      observation: 'Jualan dan keuntungan minggu ini bergerak dengan stabil.',
      impact: 'Margin lebih terjaga dan aliran tunai lebih mudah dikawal.',
      suggestion: 'Teruskan item yang paling cepat pusing dan kekalkan disiplin kos semasa restock.',
      impactAmount: 0,
      priority: 10,
    }));
  }

  const withActions = insights.map((insight) => {
    const allowActions = !(insight.severity === 'INFO' && insight.impactAmount < 5);
    return {
      ...insight,
      actions: allowActions ? getInsightActions(insight.key).slice(0, 2) : [],
    };
  });

  return {
    onboardingMessage: null,
    insights: withActions
      .sort((left, right) => right.priority - left.priority)
      .slice(0, 2),
  };
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
  inventoryItems = [],
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
  const inventoryCostAddedThisWeek = aggregateInventoryRestock(inventoryItems, windows.thisWeek);

  const revenueChangePct = getPctChange(thisWeek.revenueTotal, prevWeek.revenueTotal);
  const profitChangePct = getPctChange(thisWeek.profitTotal, prevWeek.profitTotal);
  const hasPreviousData = prevWeek.rowCount > 0 || prevWeek.invoiceCount > 0;
  const insightState = generateRealityInsight({
    thisWeek,
    prevWeek,
    hasPreviousData,
    revenueChangePct,
    profitChangePct,
    inventoryCostAddedThisWeek,
  });

  const insights = insightState.insights;
  const hasAlert = insights.some((insight) => insight.severity === 'ALERT');
  const hasGood = insights.some((insight) => insight.severity === 'GOOD');

  return {
    windows,
    thisWeek,
    prevWeek,
    hasPreviousData,
    revenueChangePct,
    profitChangePct,
    inventoryCostAddedThisWeek,
    insights,
    onboardingMessage: insightState.onboardingMessage,
    overallSeverity: hasAlert ? 'ALERT' : (hasGood ? 'GOOD' : 'INFO'),
    generatedAt: startOfLocalDay(nowDate).getTime() / DAY_MS,
  };
};

export default calculateRealityCheck;
