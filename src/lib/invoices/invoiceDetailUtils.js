import { format } from 'date-fns';
import { ms } from 'date-fns/locale';
import { formatCurrency } from '@/lib/utils';
import { COURIER_PAYMENT_MODES, resolveCourierPaymentModeForInvoice } from '@/lib/shipping';

const normalizeOptionalText = (value) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : '';
};

export const INVOICE_ADJUSTMENT_TYPES = ['goodwill', 'return', 'cancel', 'correction'];

export const normalizeAdjustmentType = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
};

export const resolveInvoiceAdjustmentType = (entry) => {
  const normalizedType = normalizeAdjustmentType(entry?.refund_type || entry?.type || '');
  if (INVOICE_ADJUSTMENT_TYPES.includes(normalizedType)) {
    return normalizedType;
  }

  const amount = Number.parseFloat(entry?.amount);
  if (Number.isFinite(amount) && amount < 0) {
    return 'goodwill';
  }

  const hint = String(entry?.reason || entry?.note || entry?.notes || '').toLowerCase();
  if (
    hint.includes('courtesy')
    || hint.includes('gerak budi')
    || hint.includes('diskaun')
    || hint.includes('price adjustment')
    || hint.includes('kompensasi')
  ) {
    return 'goodwill';
  }

  return '';
};

export const getSellerCollectedShippingCharged = (invoiceData) => {
  const courierMode = resolveCourierPaymentModeForInvoice(invoiceData);
  if (courierMode === COURIER_PAYMENT_MODES.PLATFORM) return 0;
  const parsed = Number.parseFloat(invoiceData?.shipping_charged);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(parsed, 0);
};

export const getInvoiceFinancialSummary = (invoiceData) => {
  const totalAmountRaw = Number.parseFloat(invoiceData?.total_amount);
  const totalAmount = Number.isFinite(totalAmountRaw) && totalAmountRaw >= 0 ? totalAmountRaw : 0;

  const adjustmentRaw = Number.parseFloat(invoiceData?.adjustment_total);
  const adjustmentTotal = Number.isFinite(adjustmentRaw) && adjustmentRaw > 0 ? adjustmentRaw : 0;

  const returnedRaw = Number.parseFloat(invoiceData?.returned_total);
  const returnedTotal = Number.isFinite(returnedRaw) && returnedRaw > 0 ? returnedRaw : 0;

  const finalRaw = Number.parseFloat(invoiceData?.final_total);
  const finalTotal = Number.isFinite(finalRaw)
    ? Math.max(Math.min(finalRaw, totalAmount), 0)
    : Math.max(totalAmount - adjustmentTotal - returnedTotal, 0);

  return {
    originalTotal: totalAmount,
    adjustmentTotal,
    returnedTotal,
    finalTotal,
  };
};

export const normalizeWhatsAppPhone = (phoneValue) => {
  if (typeof phoneValue !== 'string') return '';
  const trimmed = phoneValue.trim();
  if (!trimmed) return '';

  const keepDigitsAndPlus = trimmed.replace(/[^\d+]/g, '');
  const withoutLeadingPlus = keepDigitsAndPlus.startsWith('+')
    ? keepDigitsAndPlus.slice(1)
    : keepDigitsAndPlus;

  let normalized = withoutLeadingPlus.replace(/\D/g, '');
  if (!normalized) return '';

  if (normalized.startsWith('00')) {
    normalized = normalized.slice(2);
  }
  if (normalized.startsWith('0')) {
    normalized = `60${normalized.slice(1)}`;
  }

  return normalized.length >= 8 ? normalized : '';
};

export const getPrimaryClientPhone = (invoiceData) => {
  const phones = Array.isArray(invoiceData?.client?.client_phones) ? invoiceData.client.client_phones : [];
  for (const entry of phones) {
    const candidate = typeof entry?.phone_number === 'string' ? entry.phone_number.trim() : '';
    if (candidate) return candidate;
  }
  return '';
};

export const buildInvoiceWhatsAppMessage = ({ invoice, printSettings }) => {
  const clientName = normalizeOptionalText(invoice?.client?.name) || 'Pelanggan';
  const companyName = normalizeOptionalText(printSettings?.companyName) || 'RareBits';
  const invoiceNumber = normalizeOptionalText(invoice?.invoice_number) || '-';
  const invoiceDateLabel = invoice?.invoice_date
    ? format(new Date(invoice.invoice_date), 'dd MMM yyyy', { locale: ms })
    : '-';
  const paymentSettled = ['paid', 'partially_returned', 'returned'].includes(String(invoice?.status || '').toLowerCase());
  const paymentStatus = paymentSettled ? 'Lunas' : 'Belum Lunas';
  const financialSummary = getInvoiceFinancialSummary(invoice || {});
  const amountLabel = formatCurrency(financialSummary.finalTotal || 0);

  return [
    `Hi ${clientName},`,
    `Ini invois anda dari ${companyName}.`,
    '',
    `No Invois: ${invoiceNumber}`,
    `Tarikh: ${invoiceDateLabel}`,
    `Jumlah: ${amountLabel}`,
    `Status: ${paymentStatus}`,
    '',
    'Terima kasih.',
  ].join('\n');
};

export const getInvoiceExportFileName = (invoiceData) => `invoice-${invoiceData?.invoice_number || invoiceData?.id || 'rarebits'}.png`;

