import { COURIER_PAYMENT_MODES, resolveCourierPaymentModeForInvoice } from '@/lib/shipping';
import { getInvoicePlatformFeeTotal } from '@/lib/invoiceFees';

export const FINANCIAL_SETTLED_INVOICE_STATUSES = new Set(['paid', 'partially_returned', 'returned']);

const EPSILON = 0.0001;
const ADJUSTMENT_TYPE_HINTS = ['courtesy', 'gerak budi', 'diskaun', 'price adjustment', 'kompensasi'];
const INVOICE_ADJUSTMENT_TYPES = new Set(['goodwill', 'return', 'cancel', 'correction']);

const toFiniteNumber = (value, fallback = 0) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toNonNegativeNumber = (value, fallback = 0) => {
  return Math.max(toFiniteNumber(value, fallback), 0);
};

const roundCurrency = (value) => {
  const parsed = toFiniteNumber(value, 0);
  return Math.round(parsed * 100) / 100;
};

const normalizeAdjustmentType = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
};

const resolveRefundRowAdjustmentType = (refundRow) => {
  const normalizedType = normalizeAdjustmentType(refundRow?.refund_type || refundRow?.type || '');
  if (INVOICE_ADJUSTMENT_TYPES.has(normalizedType)) {
    return normalizedType;
  }

  const amount = toFiniteNumber(refundRow?.amount, 0);
  if (amount < 0) return 'goodwill';

  const hint = String(refundRow?.reason || refundRow?.note || refundRow?.notes || '').toLowerCase();
  if (ADJUSTMENT_TYPE_HINTS.some((keyword) => hint.includes(keyword))) {
    return 'goodwill';
  }

  return '';
};

const getInvoiceGoodwillAdjustmentTotal = (invoiceLike) => {
  const explicitAdjustmentTotal = toNonNegativeNumber(invoiceLike?.adjustment_total, 0);
  if (explicitAdjustmentTotal > 0) return explicitAdjustmentTotal;

  const refundRows = Array.isArray(invoiceLike?.invoice_refunds) ? invoiceLike.invoice_refunds : [];
  if (refundRows.length === 0) return explicitAdjustmentTotal;

  const fallbackGoodwill = refundRows.reduce((sum, refundRow) => {
    const adjustmentType = resolveRefundRowAdjustmentType(refundRow);
    if (adjustmentType === 'goodwill' || adjustmentType === 'cancel' || adjustmentType === 'correction') {
      return sum + Math.abs(toFiniteNumber(refundRow?.amount, 0));
    }
    return sum;
  }, 0);

  return roundCurrency(fallbackGoodwill);
};

export const getInvoiceFromSaleLine = (saleLine) => {
  if (saleLine?.invoice && typeof saleLine.invoice === 'object') return saleLine.invoice;
  if (saleLine?.invoices && typeof saleLine.invoices === 'object') return saleLine.invoices;
  return null;
};

export const getInvoiceIdFromSaleLine = (saleLine) => {
  const invoice = getInvoiceFromSaleLine(saleLine);
  return invoice?.id || saleLine?.invoice_id || null;
};

const getSaleLineReturnEntries = (saleLine) => (
  Array.isArray(saleLine?.invoice_item_returns) ? saleLine.invoice_item_returns : []
);

export const getSaleLineReturnedQuantity = (saleLine) => (
  getSaleLineReturnEntries(saleLine).reduce((sum, entry) => (
    sum + toNonNegativeNumber(entry?.returned_quantity, 0)
  ), 0)
);

export const getSaleLineReturnedRefund = (saleLine) => (
  getSaleLineReturnEntries(saleLine).reduce((sum, entry) => (
    sum + toNonNegativeNumber(entry?.refund_amount, 0)
  ), 0)
);

export const getSaleLineNetQuantity = (saleLine) => {
  const explicitNetQtyRaw = Number.parseFloat(saleLine?.quantity_sold);
  if (Number.isFinite(explicitNetQtyRaw)) {
    return Math.max(explicitNetQtyRaw, 0);
  }

  const soldQty = toNonNegativeNumber(saleLine?.quantity ?? saleLine?.invoice_quantity, 0);
  const returnedQty = getSaleLineReturnedQuantity(saleLine);
  return Math.max(soldQty - returnedQty, 0);
};

export const getSaleLineItemSubtotal = (saleLine) => {
  const explicitNetRevenueRaw = Number.parseFloat(saleLine?.actual_sold_amount);
  if (Number.isFinite(explicitNetRevenueRaw)) {
    return explicitNetRevenueRaw;
  }

  const lineTotalRaw = Number.parseFloat(saleLine?.line_total);
  if (Number.isFinite(lineTotalRaw)) {
    return lineTotalRaw - getSaleLineReturnedRefund(saleLine);
  }

  const unitPrice = toFiniteNumber(saleLine?.unit_price ?? saleLine?.selling_price, 0);
  const quantity = getSaleLineNetQuantity(saleLine);
  return (unitPrice * quantity) - getSaleLineReturnedRefund(saleLine);
};

export const getSaleLineUnitCost = (saleLine) => {
  const lineCostPrice = Number.parseFloat(saleLine?.cost_price);
  const hasLineCost = Number.isFinite(lineCostPrice) && lineCostPrice > 0;
  if (hasLineCost) return lineCostPrice;

  if (!saleLine?.is_manual) {
    const fallbackCost = Number.parseFloat(saleLine?.items?.cost_price ?? saleLine?.item?.cost_price);
    if (Number.isFinite(fallbackCost) && fallbackCost >= 0) {
      return fallbackCost;
    }
  }

  if (Number.isFinite(lineCostPrice) && lineCostPrice >= 0) {
    return lineCostPrice;
  }

  return 0;
};

export const getSaleLineItemCostTotal = (saleLine) => {
  const unitCost = getSaleLineUnitCost(saleLine);
  const quantity = getSaleLineNetQuantity(saleLine);
  return unitCost * quantity;
};

export const resolveInvoiceCollectedSummary = (invoiceLike, fallbackOriginal = 0) => {
  const fallback = toNonNegativeNumber(fallbackOriginal, 0);
  const totalAmountRaw = Number.parseFloat(invoiceLike?.total_amount);
  const totalAmount = Number.isFinite(totalAmountRaw) && totalAmountRaw >= 0
    ? totalAmountRaw
    : fallback;

  const adjustmentTotal = toNonNegativeNumber(invoiceLike?.adjustment_total, 0);
  const returnedTotal = toNonNegativeNumber(invoiceLike?.returned_total, 0);

  const finalRaw = Number.parseFloat(invoiceLike?.final_total);
  const finalTotal = Number.isFinite(finalRaw)
    ? Math.max(Math.min(finalRaw, totalAmount), 0)
    : Math.max(totalAmount - adjustmentTotal - returnedTotal, 0);

  return {
    totalAmount,
    adjustmentTotal,
    returnedTotal,
    finalTotal,
  };
};

export const getInvoiceShippingBreakdown = (invoiceLike) => {
  const paymentMode = resolveCourierPaymentModeForInvoice(invoiceLike);
  const isPlatformMode = paymentMode === COURIER_PAYMENT_MODES.PLATFORM;
  const shippingCharged = isPlatformMode ? 0 : toNonNegativeNumber(invoiceLike?.shipping_charged, 0);
  const shippingRecord = invoiceLike?.shipment || null;
  const shippingCost = isPlatformMode ? 0 : toNonNegativeNumber(shippingRecord?.shipping_cost, 0);
  const isCourierPaid = isPlatformMode ? true : Boolean(shippingRecord?.courier_paid);
  const shippingCostPaid = isCourierPaid ? shippingCost : 0;

  return {
    shippingCharged,
    shippingCostPaid,
    shippingProfit: shippingCharged - shippingCostPaid,
    isCourierPaid,
  };
};

export const buildFinancialMetricsFromSalesLines = (saleLines = []) => {
  const invoiceById = new Map();
  const invoiceItemSubtotalById = new Map();
  const invoicePlatformFeeById = new Map();
  const invoiceGoodwillById = new Map();
  const invoiceShippingById = new Map();
  const invoiceCollectedById = new Map();
  const soldInvoiceIds = new Set();

  let itemSubtotal = 0;
  let itemCostTotal = 0;
  let totalQuantitySold = 0;

  (saleLines || []).forEach((saleLine) => {
    const lineSubtotal = getSaleLineItemSubtotal(saleLine);
    const lineCostTotal = getSaleLineItemCostTotal(saleLine);
    const lineQuantity = getSaleLineNetQuantity(saleLine);
    const invoice = getInvoiceFromSaleLine(saleLine);
    const invoiceId = invoice?.id || saleLine?.invoice_id || null;

    itemSubtotal += lineSubtotal;
    itemCostTotal += lineCostTotal;
    totalQuantitySold += lineQuantity;

    if (!invoiceId) return;

    if (lineQuantity > 0 || Math.abs(lineSubtotal) > EPSILON) {
      soldInvoiceIds.add(invoiceId);
    }

    invoiceItemSubtotalById.set(
      invoiceId,
      (invoiceItemSubtotalById.get(invoiceId) || 0) + lineSubtotal
    );

    if (!invoiceById.has(invoiceId)) {
      invoiceById.set(invoiceId, invoice || null);
    }
  });

  let shippingCharged = 0;
  let shippingCost = 0;
  let shippingPendingCount = 0;
  let platformFeeTotal = 0;
  let goodwillAdjustments = 0;
  let totalCollected = 0;
  let paidInvoiceCount = 0;
  let partiallyReturnedInvoiceCount = 0;
  let returnedInvoiceCount = 0;
  const adjustedInvoiceIds = new Set();

  invoiceById.forEach((invoice, invoiceId) => {
    const status = String(invoice?.status || '').trim().toLowerCase();
    if (status === 'paid') paidInvoiceCount += 1;
    if (status === 'partially_returned') partiallyReturnedInvoiceCount += 1;
    if (status === 'returned') returnedInvoiceCount += 1;

    const shippingSnapshot = getInvoiceShippingBreakdown(invoice);
    invoiceShippingById.set(invoiceId, shippingSnapshot);
    shippingCharged += shippingSnapshot.shippingCharged;
    shippingCost += shippingSnapshot.shippingCostPaid;
    if (shippingSnapshot.shippingCharged > 0 && !shippingSnapshot.isCourierPaid) {
      shippingPendingCount += 1;
    }

    const platformFee = getInvoicePlatformFeeTotal(invoice);
    invoicePlatformFeeById.set(invoiceId, platformFee);
    platformFeeTotal += platformFee;

    const goodwill = getInvoiceGoodwillAdjustmentTotal(invoice);
    invoiceGoodwillById.set(invoiceId, goodwill);
    goodwillAdjustments += goodwill;
    if (goodwill > EPSILON && status !== 'partially_returned' && status !== 'returned') {
      adjustedInvoiceIds.add(invoiceId);
    }

    const fallbackOriginal = (invoiceItemSubtotalById.get(invoiceId) || 0) + shippingSnapshot.shippingCharged;
    const collected = resolveInvoiceCollectedSummary(invoice, fallbackOriginal);
    invoiceCollectedById.set(invoiceId, collected);
    totalCollected += collected.finalTotal;
  });

  const itemProfit = itemSubtotal - itemCostTotal;
  const shippingProfit = shippingCharged - shippingCost;
  const netProfit = itemProfit + shippingProfit - platformFeeTotal - goodwillAdjustments;

  return {
    revenueItem: roundCurrency(itemSubtotal),
    itemCostTotal: roundCurrency(itemCostTotal),
    itemProfit: roundCurrency(itemProfit),
    shippingCharged: roundCurrency(shippingCharged),
    shippingCost: roundCurrency(shippingCost),
    shippingProfit: roundCurrency(shippingProfit),
    platformFeeTotal: roundCurrency(platformFeeTotal),
    goodwillAdjustments: roundCurrency(goodwillAdjustments),
    netProfit: roundCurrency(netProfit),
    totalCollected: roundCurrency(totalCollected),
    shippingPendingCount,
    soldInvoiceCount: soldInvoiceIds.size,
    totalQuantitySold,
    paidInvoiceCount,
    refundedInvoiceCount: partiallyReturnedInvoiceCount,
    partiallyReturnedInvoiceCount,
    returnedInvoiceCount,
    adjustedInvoiceCount: adjustedInvoiceIds.size,
    invoiceItemSubtotalById,
    invoicePlatformFeeById,
    invoiceGoodwillById,
    invoiceShippingById,
    invoiceCollectedById,
  };
};

export const getSaleLineFinancialBreakdown = (saleLine, metrics) => {
  const invoiceId = getInvoiceIdFromSaleLine(saleLine);
  const lineItemSubtotal = getSaleLineItemSubtotal(saleLine);
  const lineItemCost = getSaleLineItemCostTotal(saleLine);

  const invoiceItemSubtotal = invoiceId
    ? (metrics?.invoiceItemSubtotalById?.get(invoiceId) || 0)
    : 0;
  const invoicePlatformFee = invoiceId
    ? (metrics?.invoicePlatformFeeById?.get(invoiceId) || 0)
    : 0;
  const invoiceGoodwill = invoiceId
    ? (metrics?.invoiceGoodwillById?.get(invoiceId) || 0)
    : 0;
  const invoiceShipping = invoiceId
    ? (metrics?.invoiceShippingById?.get(invoiceId) || {
      shippingCharged: 0,
      shippingCostPaid: 0,
      shippingProfit: 0,
      isCourierPaid: true,
    })
    : {
      shippingCharged: 0,
      shippingCostPaid: 0,
      shippingProfit: 0,
      isCourierPaid: true,
    };

  const share = invoiceItemSubtotal > 0 ? (lineItemSubtotal / invoiceItemSubtotal) : 0;
  const platformFeeShare = share * invoicePlatformFee;
  const goodwillShare = share * invoiceGoodwill;
  const shippingChargedShare = share * invoiceShipping.shippingCharged;
  const shippingCostShare = share * invoiceShipping.shippingCostPaid;
  const shippingProfitShare = shippingChargedShare - shippingCostShare;
  const netRevenueAfterGoodwill = lineItemSubtotal - goodwillShare;
  const netProfit = lineItemSubtotal - lineItemCost - platformFeeShare - goodwillShare + shippingProfitShare;

  return {
    lineItemSubtotal,
    lineItemCost,
    invoiceItemSubtotal,
    share,
    platformFeeShare,
    goodwillShare,
    shippingChargedShare,
    shippingCostShare,
    shippingProfitShare,
    netRevenueAfterGoodwill,
    netProfit,
  };
};
