import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  useInvoiceDetail,
  useRemoveItemFromInvoice,
  useUpdateInvoiceStatus,
  useDeleteInvoice,
  useMarkInvoiceAsPaid,
  useReverseInvoicePayment,
  useProcessRefund,
  useInvoiceShipment,
  useSaveInvoiceShipment,
  useUpdateInvoiceShipmentStatus,
  useUpdateInvoiceShippingCharged,
  useMarkShipmentCourierPaid,
} from '@/hooks/useInvoices';
import { useInvoiceSettings } from '@/hooks/useInvoiceSettings';
import { formatCurrency } from '@/lib/utils';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChevronLeft, Edit, Download, Trash2, DollarSign, AlertCircle, X } from 'lucide-react';
import QRCode from 'qrcode';
import { format } from 'date-fns';
import { ms } from 'date-fns/locale';
import toast from 'react-hot-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';

const getReservedQuantityFromItem = (item) => {
  const reservations = Array.isArray(item?.inventory_reservations) ? item.inventory_reservations : [];
  if (reservations.length > 0) {
    return reservations.reduce((sum, reservation) => {
      const qty = parseInt(reservation.quantity_reserved, 10);
      return sum + (Number.isNaN(qty) ? 0 : qty);
    }, 0);
  }

  const legacyReserved = parseInt(item?.quantity_reserved, 10);
  return Number.isNaN(legacyReserved) ? 0 : legacyReserved;
};

const getAvailableQuantityFromItem = (item) => {
  const rawTotal = parseInt(item?.quantity, 10);
  const totalQuantity = Number.isNaN(rawTotal) ? 1 : rawTotal;
  const reservedQuantity = getReservedQuantityFromItem(item);
  return Math.max(totalQuantity - reservedQuantity, 0);
};

const pickFirstNonEmptyText = (...values) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return '';
};

const normalizeOptionalText = (value) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : '';
};

const SHIPPING_VALUE_CAP = 9999;
const COURIER_MAX_LENGTH = 50;
const TRACKING_NO_MAX_LENGTH = 64;
const TRACKING_NO_PATTERN = /^[A-Za-z0-9\- ]*$/;
const SHIPMENT_NOTES_MAX_LENGTH = 500;

const normalizeWhitespaceText = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
};

const normalizeCurrencyInput = (value, { label = 'Nilai', allowEmptyAsZero = true } = {}) => {
  const rawValue = value === null || value === undefined ? '' : String(value);
  const cleaned = rawValue.replace(/,/g, '').replace(/\s+/g, '');

  if (!cleaned) {
    if (allowEmptyAsZero) {
      return { ok: true, value: 0, display: '0.00' };
    }
    return { ok: false, message: `${label} diperlukan.` };
  }

  const parsed = Number.parseFloat(cleaned);
  if (!Number.isFinite(parsed)) {
    return { ok: false, message: `${label} tidak sah.` };
  }

  const rounded = Math.round(parsed * 100) / 100;
  if (rounded < 0) {
    return { ok: false, message: `${label} mesti 0 atau lebih.` };
  }

  if (rounded > SHIPPING_VALUE_CAP) {
    return { ok: false, message: 'Nombor terlalu besar - semak semula.' };
  }

  return { ok: true, value: rounded, display: rounded.toFixed(2) };
};

const toLocalDateTimeInputValue = (value = new Date()) => {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const timezoneOffsetMs = parsed.getTimezoneOffset() * 60000;
  const localDate = new Date(parsed.getTime() - timezoneOffsetMs);
  return localDate.toISOString().slice(0, 16);
};

const validateDeliveryTextFields = ({ courier, trackingNo }) => {
  const nextErrors = { courier: '', trackingNo: '' };
  const normalizedCourier = normalizeWhitespaceText(courier);
  const normalizedTrackingNo = normalizeWhitespaceText(trackingNo);

  if (normalizedCourier.length > COURIER_MAX_LENGTH) {
    nextErrors.courier = `Nama courier maksimum ${COURIER_MAX_LENGTH} aksara.`;
  }

  if (normalizedTrackingNo.length > TRACKING_NO_MAX_LENGTH) {
    nextErrors.trackingNo = `Tracking no maksimum ${TRACKING_NO_MAX_LENGTH} aksara.`;
  } else if (normalizedTrackingNo && !TRACKING_NO_PATTERN.test(normalizedTrackingNo)) {
    nextErrors.trackingNo = 'Tracking no hanya boleh guna huruf, nombor, dash dan ruang.';
  }

  return {
    errors: nextErrors,
    hasError: Boolean(nextErrors.courier || nextErrors.trackingNo),
    values: {
      courier: normalizedCourier,
      trackingNo: normalizedTrackingNo,
    },
  };
};

const isValidHttpUrl = (value) => {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (_error) {
    return false;
  }
};

const qrDataUrlCache = new Map();
const qrSvgCache = new Map();

const getQrDataUrl = async (url, width = 160) => {
  if (!isValidHttpUrl(url)) return '';

  const cacheKey = `${url}|${width}`;
  if (qrDataUrlCache.has(cacheKey)) {
    return qrDataUrlCache.get(cacheKey);
  }

  try {
    const qrDataUrl = await QRCode.toDataURL(url, {
      width,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#000000',
        light: '#FFFFFF',
      },
    });

    qrDataUrlCache.set(cacheKey, qrDataUrl);
    return qrDataUrl;
  } catch (error) {
    console.error('[InvoiceDetailsPage] Failed to generate QR:', error);
    return '';
  }
};

const getQrSvgMarkup = async (url, width = 256) => {
  if (!isValidHttpUrl(url)) return '';

  const cacheKey = `${url}|${width}`;
  if (qrSvgCache.has(cacheKey)) {
    return qrSvgCache.get(cacheKey);
  }

  try {
    const qrSvg = await QRCode.toString(url, {
      type: 'svg',
      width,
      margin: 1,
      color: {
        dark: '#000000',
        light: '#FFFFFF',
      },
    });

    qrSvgCache.set(cacheKey, qrSvg);
    return qrSvg;
  } catch (error) {
    console.error('[InvoiceDetailsPage] Failed to generate QR SVG:', error);
    return '';
  }
};

const splitTextLines = (value, maxLines = Number.POSITIVE_INFINITY) => {
  if (!value) return [];
  return String(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines);
};

const buildInvoicePrintSettings = (settings) => {
  const legacyShowLogo = settings?.show_logo ?? true;
  const legacyShowGeneratedBy = settings?.show_generated_by ?? true;

  const companyName = pickFirstNonEmptyText(settings?.company_name, 'RareBits');
  const address = normalizeOptionalText(settings?.address);
  const phone = normalizeOptionalText(settings?.phone);
  const email = normalizeOptionalText(settings?.email);
  const website = normalizeOptionalText(settings?.website);
  const fax = normalizeOptionalText(settings?.fax);
  const logoUrl = normalizeOptionalText(settings?.logo_url);
  const taxNumber = normalizeOptionalText(settings?.tax_number);
  const footerNotes = normalizeOptionalText(settings?.footer_notes);
  const qrLabel = pickFirstNonEmptyText(settings?.qr_label, 'Scan untuk lihat katalog');
  const qrUrlRaw = normalizeOptionalText(settings?.qr_url);
  const qrModeRaw = normalizeOptionalText(settings?.qr_mode).toLowerCase();
  const qrMode = qrModeRaw === 'none' || qrModeRaw === 'url'
    ? qrModeRaw
    : (qrUrlRaw ? 'url' : 'none');
  const hasValidQrUrl = isValidHttpUrl(qrUrlRaw);
  const canShowQr = qrMode !== 'none' && hasValidQrUrl;

  return {
    companyName,
    address,
    addressLines: splitTextLines(address),
    addressLinesThermal: (settings?.thermal_show_address ?? false) ? splitTextLines(address, 2) : [],
    phone,
    email,
    website,
    fax,
    logoUrl,
    showLogoA4: Boolean((settings?.show_logo_a4 ?? legacyShowLogo) && logoUrl),
    showLogoThermal: Boolean((settings?.show_logo_thermal ?? false) && logoUrl),
    showLogoPaperang: Boolean((settings?.show_logo_paperang ?? false) && logoUrl),
    thermalShowPhone: settings?.thermal_show_phone ?? true,
    thermalShowEmail: settings?.thermal_show_email ?? false,
    thermalShowWebsite: settings?.thermal_show_website ?? true,
    showTax: Boolean(settings?.show_tax && taxNumber),
    showTaxThermal: Boolean((settings?.thermal_show_tax ?? settings?.show_tax ?? false) && taxNumber),
    taxNumber,
    footerNotes,
    qrMode,
    qrLabel,
    qrUrl: canShowQr ? qrUrlRaw : '',
    showQrA4: Boolean(settings?.qr_enabled_a4 && canShowQr),
    showQrThermal: Boolean(settings?.qr_enabled_thermal && canShowQr),
    showQrPaperang: Boolean(settings?.qr_enabled_paperang && canShowQr),
    showGeneratedByA4: settings?.show_generated_by_a4 ?? legacyShowGeneratedBy,
    showGeneratedByThermal: settings?.show_generated_by_thermal ?? false,
    showGeneratedByPaperang: settings?.show_generated_by_paperang ?? false,
  };
};

const InvoiceDetailsPage = () => {
  const navigate = useNavigate();
  const { invoiceId } = useParams();

  // Refund modal state
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refundNotes, setRefundNotes] = useState('');
  const [showPrintOptions, setShowPrintOptions] = useState(false);
  const [showCourierPaidModal, setShowCourierPaidModal] = useState(false);
  const [courierPaidCost, setCourierPaidCost] = useState('');
  const [courierPaidCostError, setCourierPaidCostError] = useState('');
  const [courierPaidDate, setCourierPaidDate] = useState(() => toLocalDateTimeInputValue(new Date()));
  const [courierPaidDateError, setCourierPaidDateError] = useState('');
  const [courierPaidNotes, setCourierPaidNotes] = useState('');
  const [courierPaidNotesError, setCourierPaidNotesError] = useState('');
  const [shippingChargedInput, setShippingChargedInput] = useState('0.00');
  const [shippingChargedError, setShippingChargedError] = useState('');
  const [deliveryFieldErrors, setDeliveryFieldErrors] = useState({
    courier: '',
    trackingNo: '',
  });
  const [deliveryForm, setDeliveryForm] = useState({
    courier: '',
    trackingNo: '',
  });

  // Fetch invoice details
  const { data: invoice, isLoading, error } = useInvoiceDetail(invoiceId);
  const { data: shipment, isLoading: isShipmentLoading } = useInvoiceShipment(invoiceId);
  const { settings: invoiceSettings } = useInvoiceSettings(invoice?.user_id);
  const printSettings = useMemo(
    () => buildInvoicePrintSettings(invoiceSettings),
    [invoiceSettings]
  );

  // Log for debugging
  useEffect(() => {
    console.log('[InvoiceDetailsPage] invoiceId:', invoiceId);
    console.log('[InvoiceDetailsPage] isLoading:', isLoading);
    console.log('[InvoiceDetailsPage] invoice:', invoice);
    console.log('[InvoiceDetailsPage] error:', error);
  }, [invoiceId, isLoading, invoice, error]);

  // Mutations
  const removeItem = useRemoveItemFromInvoice();
  const updateStatus = useUpdateInvoiceStatus();
  const deleteInvoice = useDeleteInvoice();
  const markInvoiceAsPaid = useMarkInvoiceAsPaid();
  const reversePayment = useReverseInvoicePayment();
  const processRefund = useProcessRefund();
  const saveInvoiceShipment = useSaveInvoiceShipment();
  const updateInvoiceShipmentStatus = useUpdateInvoiceShipmentStatus();
  const updateInvoiceShippingCharged = useUpdateInvoiceShippingCharged();
  const markShipmentCourierPaid = useMarkShipmentCourierPaid();

  useEffect(() => {
    setDeliveryForm({
      courier: shipment?.courier || '',
      trackingNo: shipment?.tracking_no || '',
    });
  }, [shipment?.courier, shipment?.tracking_no]);

  useEffect(() => {
    if (shipment?.shipping_cost && Number(shipment.shipping_cost) > 0) {
      setCourierPaidCost(String(shipment.shipping_cost));
    }
  }, [shipment?.shipping_cost]);

  useEffect(() => {
    if (!showCourierPaidModal) return;

    setCourierPaidCost((current) => {
      if (current.trim() !== '') return current;
      if (shipment?.shipping_cost && Number(shipment.shipping_cost) > 0) {
        return String(shipment.shipping_cost);
      }
      return '';
    });

    setCourierPaidDate(toLocalDateTimeInputValue(new Date()));
    setCourierPaidNotes(shipment?.notes || '');
    setCourierPaidDateError('');
    setCourierPaidNotesError('');
  }, [showCourierPaidModal, shipment?.shipping_cost, shipment?.notes]);

  useEffect(() => {
    const normalizedShipping = normalizeCurrencyInput(invoice?.shipping_charged ?? 0, {
      label: 'Caj pos',
      allowEmptyAsZero: true,
    });

    if (normalizedShipping.ok) {
      setShippingChargedInput(normalizedShipping.display);
      setShippingChargedError('');
    }
  }, [invoice?.shipping_charged]);

  const validateShippingChargedInput = ({ commitDisplay = false } = {}) => {
    const normalized = normalizeCurrencyInput(shippingChargedInput, {
      label: 'Caj pos',
      allowEmptyAsZero: true,
    });

    if (!normalized.ok) {
      setShippingChargedError(normalized.message);
      return { ok: false, message: normalized.message };
    }

    if (commitDisplay) {
      setShippingChargedInput(normalized.display);
    }
    setShippingChargedError('');
    return { ok: true, value: normalized.value, display: normalized.display };
  };

  const validateCourierPaidCostInput = ({ commitDisplay = false } = {}) => {
    const normalized = normalizeCurrencyInput(courierPaidCost, {
      label: 'Kos courier',
      allowEmptyAsZero: false,
    });

    if (!normalized.ok) {
      setCourierPaidCostError(normalized.message);
      return { ok: false, message: normalized.message };
    }

    if (commitDisplay) {
      setCourierPaidCost(normalized.display);
    }
    setCourierPaidCostError('');
    return { ok: true, value: normalized.value, display: normalized.display };
  };

  const validateCourierPaidDateInput = () => {
    const rawDate = String(courierPaidDate || '').trim();
    const fallbackDisplay = toLocalDateTimeInputValue(new Date());

    if (!rawDate) {
      setCourierPaidDate(fallbackDisplay);
      setCourierPaidDateError('');
      return { ok: true, iso: new Date().toISOString() };
    }

    const parsed = new Date(rawDate);
    if (Number.isNaN(parsed.getTime())) {
      const message = 'Tarikh bayaran tidak sah.';
      setCourierPaidDateError(message);
      return { ok: false, message };
    }

    setCourierPaidDateError('');
    return { ok: true, iso: parsed.toISOString() };
  };

  const validateCourierPaidNotesInput = ({ normalize = false } = {}) => {
    const cleaned = String(courierPaidNotes || '').trim();

    if (cleaned.length > SHIPMENT_NOTES_MAX_LENGTH) {
      const message = `Catatan maksimum ${SHIPMENT_NOTES_MAX_LENGTH} aksara.`;
      setCourierPaidNotesError(message);
      return { ok: false, message };
    }

    if (normalize) {
      setCourierPaidNotes(cleaned);
    }

    setCourierPaidNotesError('');
    return { ok: true, value: cleaned };
  };

  const validateDeliveryInput = ({ commitNormalized = false } = {}) => {
    const validation = validateDeliveryTextFields(deliveryForm);
    setDeliveryFieldErrors(validation.errors);

    if (validation.hasError) {
      return { ok: false, errors: validation.errors };
    }

    if (commitNormalized) {
      setDeliveryForm(validation.values);
    }

    return { ok: true, values: validation.values };
  };

  const persistShippingCharged = async ({ silentSuccess = false } = {}) => {
    const validated = validateShippingChargedInput({ commitDisplay: true });
    if (!validated.ok) {
      return false;
    }

    const currentShipping = Math.max(parseFloat(invoice?.shipping_charged) || 0, 0);
    if (Math.abs(currentShipping - validated.value) <= 0.0001) {
      return true;
    }

    try {
      await updateInvoiceShippingCharged.mutateAsync({
        invoiceId,
        shippingCharged: validated.value,
      });

      if (!silentSuccess) {
        toast.success('Caj pos berjaya dikemaskini');
      }
      return true;
    } catch (shippingError) {
      const message = shippingError?.message || 'Gagal kemaskini caj pos';
      setShippingChargedError(message);
      toast.error(message);
      return false;
    }
  };

  const handleRemoveItem = async (itemId) => {
    try {
      await removeItem.mutateAsync({
        invoiceId,
        itemId,
      });
      toast.success('Item dibuang dari invois');
    } catch (error) {
      console.error('[InvoiceDetailsPage] Error removing item:', error);
      toast.error('Gagal membuang item');
    }
  };

  const handleStatusChange = async (newStatus) => {
    try {
      if (newStatus === 'finalized' || newStatus === 'paid') {
        const shippingReady = await persistShippingCharged({ silentSuccess: true });
        if (!shippingReady) return;
      }

      if (newStatus === 'paid') {
        const availabilityCheck = await validateInvoiceAvailability();
        if (!availabilityCheck.ok) return;
      }

      await updateStatus.mutateAsync({
        invoiceId,
        status: newStatus,
      });
      toast.success(`Status diubah kepada ${newStatus}`);
    } catch (error) {
      console.error('[InvoiceDetailsPage] Error updating status:', error);
      toast.error('Gagal mengubah status');
    }
  };

const handleDeleteInvoice = async () => {    try {      await deleteInvoice.mutateAsync({ invoiceId });      toast.success('Invois dihapus');      navigate('/invoices');    } catch (error) {      console.error('[InvoiceDetailsPage] Error deleting invoice:', error);      toast.error('Gagal menghapus invois');    }  };

  const printHtmlInIframe = (htmlContent, title) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('title', title);
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.visibility = 'hidden';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) {
      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
      return;
    }

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
    };

    doc.open();
    doc.write(htmlContent);
    doc.close();

    iframe.onload = () => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    };

    iframe.contentWindow?.addEventListener('afterprint', cleanup, { once: true });
    setTimeout(cleanup, 30000);
  };

  const buildA4InvoiceHtml = (invoiceData, options = {}) => {
    const escapeHtml = (value) => {
      if (value === null || value === undefined) return '';
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    };

    const sellerName = printSettings.companyName;
    const sellerAddress = printSettings.address;
    const sellerPhone = printSettings.phone;
    const sellerEmail = printSettings.email;
    const sellerWebsite = printSettings.website;
    const sellerFax = printSettings.fax;
    const footerNote = printSettings.footerNotes;
    const showGeneratedBy = printSettings.showGeneratedByA4;
    const a4QrDataUrl = normalizeOptionalText(options.qrDataUrl);
    const showQr = Boolean(printSettings.showQrA4 && a4QrDataUrl);

    const clientName = invoiceData.client?.name || '-';
    const clientPhone = (invoiceData.client?.client_phones || [])
      .map((phone) => phone?.phone_number)
      .filter(Boolean)
      .join(', ');
    const clientAddress = (invoiceData.client?.client_addresses || [])
      .map((address) => address?.address)
      .filter(Boolean)
      .join(' | ');

    const invoiceDateLabel = invoiceData.invoice_date
      ? format(new Date(invoiceData.invoice_date), 'dd MMM yyyy', { locale: ms })
      : '-';
    const createdAtLabel = invoiceData.created_at
      ? format(new Date(invoiceData.created_at), 'dd MMM yyyy, HH:mm', { locale: ms })
      : '-';
    const paymentStatus = invoiceData.status === 'paid' ? 'Paid' : 'Unpaid';
    const paymentStatusClass = invoiceData.status === 'paid' ? 'status-paid' : 'status-unpaid';

    const itemRows = (invoiceData.invoice_items || [])
      .map((item) => {
        const name = item.is_manual ? item.item_name : item.item?.name;
        const category = item.is_manual ? 'Item Manual' : item.item?.category;
        const qty = item.quantity || 1;
        const unitPrice = item.unit_price || 0;
        const lineTotal = item.line_total || 0;

        return `
          <tr>
            <td class="item-cell">
              <div class="item-name">${escapeHtml(name || 'Item')}</div>
              ${category ? `<div class="item-meta">${escapeHtml(category)}</div>` : ''}
            </td>
            <td class="num-cell">${escapeHtml(qty)}</td>
            <td class="num-cell">${escapeHtml(formatCurrency(unitPrice))}</td>
            <td class="num-cell">${escapeHtml(formatCurrency(lineTotal))}</td>
          </tr>
        `;
      })
      .join('');

    const safeItemRows = itemRows || `
      <tr>
        <td colspan="4" class="empty-row">Tiada item dalam invois.</td>
      </tr>
    `;

    return `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Invoice ${escapeHtml(invoiceData.invoice_number || '')}</title>
          <style>
            * { box-sizing: border-box; }
            @page { size: A4; margin: 20mm; }
            html, body {
              margin: 0;
              padding: 0;
              background: #fff;
              color: #111;
              font-family: "Inter", Arial, sans-serif;
              line-height: 1.45;
            }
            @media print {
              html, body {
                width: 210mm;
                min-height: auto;
                overflow: visible;
              }
            }
            .invoice-doc {
              width: 100%;
              margin: 0;
              padding: 0;
            }
            .header {
              display: flex;
              justify-content: space-between;
              align-items: flex-start;
              gap: 24px;
              margin-bottom: 20px;
            }
            .seller-brand {
              display: flex;
              align-items: flex-start;
              gap: 14px;
            }
            .seller-logo {
              max-width: 86px;
              max-height: 86px;
              width: auto;
              height: auto;
              object-fit: contain;
              border: 1px solid #e5e7eb;
              border-radius: 8px;
              padding: 4px;
              background: #fff;
            }
            .seller-details {
              min-width: 0;
            }
            .seller-name {
              font-size: 24px;
              font-weight: 700;
              margin-bottom: 6px;
            }
            .seller-line {
              font-size: 12px;
              margin: 2px 0;
              color: #303030;
            }
            .invoice-title {
              text-align: right;
            }
            .invoice-title h1 {
              margin: 0;
              font-size: 30px;
              letter-spacing: 1.6px;
            }
            .meta-row {
              font-size: 12px;
              margin-top: 4px;
            }
            .status-chip {
              display: inline-block;
              margin-top: 8px;
              padding: 3px 10px;
              border-radius: 999px;
              font-size: 11px;
              border: 1px solid #c7c7c7;
            }
            .status-paid {
              color: #166534;
              border-color: #86efac;
              background: #f0fdf4;
            }
            .status-unpaid {
              color: #854d0e;
              border-color: #fcd34d;
              background: #fffbeb;
            }
            .bill-to {
              margin-bottom: 20px;
              border: 1px solid #e5e7eb;
              border-radius: 8px;
              padding: 12px 14px;
            }
            .section-label {
              margin: 0 0 6px 0;
              font-size: 11px;
              font-weight: 700;
              letter-spacing: 0.08em;
              color: #4b5563;
              text-transform: uppercase;
            }
            .bill-line {
              margin: 2px 0;
              font-size: 13px;
              color: #111827;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              table-layout: fixed;
            }
            thead {
              display: table-header-group;
            }
            tbody {
              display: table-row-group;
            }
            tr {
              break-inside: avoid;
              page-break-inside: avoid;
            }
            th {
              text-align: left;
              padding: 8px 10px;
              border-bottom: 1px solid #111;
              font-size: 11px;
              text-transform: uppercase;
              letter-spacing: 0.06em;
            }
            td {
              padding: 10px;
              border-bottom: 1px solid #e5e7eb;
              vertical-align: top;
              font-size: 13px;
            }
            .item-cell {
              width: 52%;
              word-break: break-word;
            }
            .item-name {
              font-weight: 600;
            }
            .item-meta {
              margin-top: 2px;
              font-size: 11px;
              color: #6b7280;
            }
            .num-cell {
              width: 16%;
              text-align: right;
              white-space: nowrap;
            }
            .empty-row {
              text-align: center;
              color: #6b7280;
            }
            .totals-wrap {
              margin-top: 18px;
              display: flex;
              justify-content: flex-end;
            }
            .totals-box {
              width: 280px;
              border: 1px solid #e5e7eb;
              border-radius: 8px;
              padding: 10px 12px;
            }
            .totals-row {
              display: flex;
              justify-content: space-between;
              gap: 12px;
              margin: 6px 0;
              font-size: 13px;
            }
            .totals-row.total {
              margin-top: 10px;
              padding-top: 10px;
              border-top: 1px solid #d1d5db;
              font-size: 16px;
              font-weight: 700;
            }
            .tax-meta {
              margin-top: 8px;
              font-size: 11px;
              color: #4b5563;
            }
            .qr-wrap {
              margin-top: 10px;
              display: flex;
              justify-content: flex-end;
            }
            .qr-box {
              width: 136px;
              text-align: center;
            }
            .qr-image {
              width: 120px;
              height: 120px;
              object-fit: contain;
              display: block;
              margin: 0 auto 6px;
            }
            .qr-label {
              font-size: 10px;
              color: #4b5563;
              line-height: 1.3;
            }
            .footer {
              margin-top: 22px;
              border-top: 1px solid #e5e7eb;
              padding-top: 12px;
              font-size: 12px;
              color: #374151;
            }
            .notes {
              white-space: pre-wrap;
              margin-bottom: 10px;
            }
            .generated-by {
              margin-top: 10px;
              font-size: 11px;
              color: #6b7280;
            }
          </style>
        </head>
        <body>
          <main class="invoice-doc">
            <section class="header">
              <div class="seller-brand">
                ${printSettings.showLogoA4 ? `<img class="seller-logo" src="${escapeHtml(printSettings.logoUrl)}" alt="Logo" />` : ''}
                <div class="seller-details">
                  <div class="seller-name">${escapeHtml(sellerName)}</div>
                  ${sellerAddress ? `<p class="seller-line">${escapeHtml(sellerAddress)}</p>` : ''}
                  ${sellerPhone ? `<p class="seller-line">Telefon: ${escapeHtml(sellerPhone)}</p>` : ''}
                  ${sellerEmail ? `<p class="seller-line">Emel: ${escapeHtml(sellerEmail)}</p>` : ''}
                  ${sellerWebsite ? `<p class="seller-line">Laman: ${escapeHtml(sellerWebsite)}</p>` : ''}
                  ${sellerFax ? `<p class="seller-line">Faks: ${escapeHtml(sellerFax)}</p>` : ''}
                </div>
              </div>
              <div class="invoice-title">
                <h1>INVOICE</h1>
                <div class="meta-row">No: ${escapeHtml(invoiceData.invoice_number || '-')}</div>
                <div class="meta-row">Tarikh Invois: ${escapeHtml(invoiceDateLabel)}</div>
                <div class="meta-row">Dicipta: ${escapeHtml(createdAtLabel)}</div>
                <span class="status-chip ${paymentStatusClass}">${paymentStatus}</span>
              </div>
            </section>

            <section class="bill-to">
              <p class="section-label">Bill To</p>
              <p class="bill-line"><strong>${escapeHtml(clientName)}</strong></p>
              ${clientPhone ? `<p class="bill-line">Telefon: ${escapeHtml(clientPhone)}</p>` : ''}
              ${invoiceData.client?.email ? `<p class="bill-line">Emel: ${escapeHtml(invoiceData.client.email)}</p>` : ''}
              ${clientAddress ? `<p class="bill-line">${escapeHtml(clientAddress)}</p>` : ''}
            </section>

            <section>
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th style="text-align:right;">Qty</th>
                    <th style="text-align:right;">Unit Price</th>
                    <th style="text-align:right;">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  ${safeItemRows}
                </tbody>
              </table>
            </section>

            <section class="totals-wrap">
              <div class="totals-box">
                <div class="totals-row">
                  <span>Subtotal</span>
                  <span>${escapeHtml(formatCurrency(invoiceData.subtotal || 0))}</span>
                </div>
                <div class="totals-row">
                  <span>Cukai</span>
                  <span>${escapeHtml(formatCurrency(invoiceData.tax_amount || 0))}</span>
                </div>
                ${printSettings.showTax ? `<div class="tax-meta">No. Cukai: ${escapeHtml(printSettings.taxNumber)}</div>` : ''}
                ${invoiceData.payment_method ? `
                  <div class="totals-row">
                    <span>Kaedah Bayaran</span>
                    <span>${escapeHtml(invoiceData.payment_method)}</span>
                  </div>
                ` : ''}
                <div class="totals-row total">
                  <span>Jumlah</span>
                  <span>${escapeHtml(formatCurrency(invoiceData.total_amount || 0))}</span>
                </div>
              </div>
            </section>

            ${showQr ? `
              <section class="qr-wrap">
                <div class="qr-box">
                  <img class="qr-image" src="${escapeHtml(a4QrDataUrl)}" alt="QR Code" />
                  <div class="qr-label">${escapeHtml(printSettings.qrLabel)}</div>
                </div>
              </section>
            ` : ''}

            <section class="footer">
              ${invoiceData.notes ? `<div class="notes"><strong>Nota:</strong> ${escapeHtml(invoiceData.notes)}</div>` : ''}
              ${footerNote ? `<div class="notes">${escapeHtml(footerNote)}</div>` : ''}
              ${showGeneratedBy ? '<div class="generated-by">Generated by RareBits</div>' : ''}
            </section>
          </main>
        </body>
      </html>
    `;
  };

  const handlePrintInvoice = async () => {
    if (!invoice) return;

    let qrDataUrl = '';
    if (printSettings.showQrA4) {
      qrDataUrl = await getQrDataUrl(printSettings.qrUrl, 160);
    }

    printHtmlInIframe(buildA4InvoiceHtml(invoice, { qrDataUrl }), 'invoice-a4-print');
  };

  const buildThermalReceiptHtml = (invoiceData, options = {}) => {
    const escapeHtml = (value) => {
      if (value === null || value === undefined) return '';
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    };

    const itemsHtml = (invoiceData.invoice_items || [])
      .map((item) => {
        const name = item.is_manual ? item.item_name : item.item?.name;
        const qty = item.quantity || 1;
        const unitPrice = item.unit_price || 0;
        const lineTotal = item.line_total || 0;
        return `
          <div class="item-row">
            <div class="item-name">${escapeHtml(name || 'Item')}</div>
            <div class="item-line">
              <div class="item-meta">${qty} x ${escapeHtml(formatCurrency(unitPrice))}</div>
              <div class="item-total">${escapeHtml(formatCurrency(lineTotal))}</div>
            </div>
          </div>
        `;
      })
      .join('');

    const clientName = invoiceData.client?.name || 'Pelanggan';
    const invoiceDate = invoiceData.invoice_date
      ? format(new Date(invoiceData.invoice_date), 'dd MMM yyyy', { locale: ms })
      : '';
    const createdAt = invoiceData.created_at
      ? format(new Date(invoiceData.created_at), 'dd MMM yyyy, HH:mm', { locale: ms })
      : '';
    const companyName = printSettings.companyName;
    const addressLines = printSettings.addressLinesThermal;
    const contactLines = [
      (printSettings.thermalShowPhone && printSettings.phone) ? `Tel: ${printSettings.phone}` : '',
      (printSettings.thermalShowWebsite && printSettings.website) ? printSettings.website : '',
      (printSettings.thermalShowEmail && printSettings.email) ? printSettings.email : '',
    ].filter(Boolean);
    const thermalQrDataUrl = normalizeOptionalText(options.qrDataUrl);
    const showQr = Boolean(printSettings.showQrThermal && thermalQrDataUrl);

    return `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Thermal Receipt</title>
          <style>
            * { box-sizing: border-box; }
            @page { size: 58mm auto; margin: 0; }
            html, body { margin: 0; padding: 0; }
            body { width: 58mm; font-family: "Inter", Arial, sans-serif; font-size: 12px; color: #111; }
            .receipt { width: 58mm; padding: 8px 10px; }
            .center { text-align: center; }
            .muted { color: #666; }
            .company-logo {
              max-width: 40px;
              max-height: 40px;
              width: auto;
              height: auto;
              object-fit: contain;
              margin: 0 auto 6px;
              display: block;
            }
            .company { font-weight: 700; font-size: 14px; line-height: 1.25; margin-top: 6px; }
            .contact { font-size: 11px; line-height: 1.2; }
            .title { font-weight: 700; font-size: 14px; letter-spacing: 0.2px; }
            .divider { border-top: 1px dashed #999; margin: 8px 0; }
            .row { display: flex; justify-content: space-between; }
            .item-row { margin-bottom: 6px; }
            .item-name { font-weight: 600; }
            .item-line { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
            .item-meta { font-size: 11px; color: #555; }
            .item-total { font-weight: 600; text-align: right; }
            .totals { margin-top: 8px; }
            .totals .row { margin-bottom: 4px; }
            .grand { font-weight: 700; font-size: 13px; }
            .qr-wrap { text-align: center; margin: 8px 0; }
            .qr-image {
              width: 112px;
              height: 112px;
              object-fit: contain;
              display: block;
              margin: 0 auto 5px;
            }
            .qr-label {
              font-size: 11px;
              line-height: 1.2;
              color: #444;
            }
            .footer-note { white-space: pre-wrap; line-height: 1.25; text-align: center; }
            .generated { margin-bottom: 6px; }
          </style>
        </head>
        <body>
          <div class="receipt">
            ${printSettings.showLogoThermal ? `<img class="company-logo" src="${escapeHtml(printSettings.logoUrl)}" alt="Logo" />` : ''}
            <div class="center company">${escapeHtml(companyName)}</div>
            ${addressLines.map((line) => `<div class="center muted contact">${escapeHtml(line)}</div>`).join('')}
            ${contactLines.map((line) => `<div class="center muted contact">${escapeHtml(line)}</div>`).join('')}
            ${printSettings.showTaxThermal ? `<div class="center muted contact">No. Cukai: ${escapeHtml(printSettings.taxNumber)}</div>` : ''}
            <div class="divider"></div>
            <div class="center title">INVOIS</div>
            <div class="center muted">${escapeHtml(invoiceData.invoice_number || '')}</div>
            <div class="divider"></div>
            <div class="row"><span>Pelanggan</span><span>${escapeHtml(clientName)}</span></div>
            <div class="row"><span>Tarikh</span><span>${escapeHtml(invoiceDate)}</span></div>
            ${createdAt ? `<div class="row"><span>Masa</span><span>${escapeHtml(createdAt.split(', ')[1] || '')}</span></div>` : ''}
            <div class="divider"></div>
            ${itemsHtml}
            <div class="divider"></div>
            <div class="totals">
              <div class="row"><span>Subtotal</span><span>${escapeHtml(formatCurrency(invoiceData.subtotal || 0))}</span></div>
              <div class="row"><span>Cukai</span><span>${escapeHtml(formatCurrency(invoiceData.tax_amount || 0))}</span></div>
              <div class="row grand"><span>Jumlah</span><span>${escapeHtml(formatCurrency(invoiceData.total_amount || 0))}</span></div>
            </div>
            ${showQr ? `
              <div class="divider"></div>
              <div class="qr-wrap">
                <img class="qr-image" src="${escapeHtml(thermalQrDataUrl)}" alt="QR Code" />
                <div class="qr-label">${escapeHtml(printSettings.qrLabel)}</div>
              </div>
            ` : ''}
            ${invoiceData.notes ? `<div class="divider"></div><div class="muted footer-note">Nota: ${escapeHtml(invoiceData.notes)}</div>` : ''}
            ${printSettings.footerNotes ? `<div class="divider"></div><div class="muted footer-note">${escapeHtml(printSettings.footerNotes)}</div>` : ''}
            ${printSettings.showGeneratedByThermal ? '<div class="divider"></div><div class="center muted generated">Generated by RareBits</div>' : ''}
          </div>
        </body>
      </html>
    `;
  };

  const handlePrintThermal = async () => {
    if (!invoice) return;

    let qrDataUrl = '';
    if (printSettings.showQrThermal) {
      qrDataUrl = await getQrDataUrl(printSettings.qrUrl, 160);
    }

    printHtmlInIframe(buildThermalReceiptHtml(invoice, { qrDataUrl }), 'thermal-print');
  };

  const buildThermalExportMarkup = (invoiceData, options = {}) => {
    const escapeHtml = (value) => {
      if (value === null || value === undefined) return '';
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    };

    const itemsHtml = (invoiceData.invoice_items || [])
      .map((item) => {
        const name = item.is_manual ? item.item_name : item.item?.name;
        const qty = item.quantity || 1;
        const unitPrice = item.unit_price || 0;
        const lineTotal = item.line_total || 0;
        return `
          <div class="item-row">
            <div class="item-name">${escapeHtml(name || 'Item')}</div>
            <div class="item-line">
              <div class="item-meta">${qty} x ${escapeHtml(formatCurrency(unitPrice))}</div>
              <div class="item-total">${escapeHtml(formatCurrency(lineTotal))}</div>
            </div>
          </div>
        `;
      })
      .join('');

    const clientName = invoiceData.client?.name || 'Pelanggan';
    const invoiceDate = invoiceData.invoice_date
      ? format(new Date(invoiceData.invoice_date), 'dd MMM yyyy', { locale: ms })
      : '';
    const createdAt = invoiceData.created_at
      ? format(new Date(invoiceData.created_at), 'dd MMM yyyy, HH:mm', { locale: ms })
      : '';
    const companyName = printSettings.companyName;
    const addressLines = printSettings.addressLinesThermal;
    const contactLines = [
      (printSettings.thermalShowPhone && printSettings.phone) ? `Tel: ${printSettings.phone}` : '',
      (printSettings.thermalShowWebsite && printSettings.website) ? printSettings.website : '',
      (printSettings.thermalShowEmail && printSettings.email) ? printSettings.email : '',
    ].filter(Boolean);
    const paperangQrSvgMarkup = typeof options.qrSvgMarkup === 'string' ? options.qrSvgMarkup : '';
    const showQr = Boolean(printSettings.showQrPaperang && paperangQrSvgMarkup);

    return `
      <style>
        * { box-sizing: border-box; }
        .export-receipt {
          width: 384px;
          background: #fff;
          color: #000;
          font-family: Arial, sans-serif;
          font-size: 25px;
          font-weight: 700;
          line-height: 1.4;
          padding: 16px;
        }
        .export-center { text-align: center; }
        .export-logo {
          max-width: 92px;
          max-height: 92px;
          width: auto;
          height: auto;
          object-fit: contain;
          display: block;
          margin: 0 auto 8px;
        }
        .export-company { font-size: 32px; font-weight: 700; letter-spacing: 0.2px; line-height: 1.2; margin-top: 10px; }
        .export-contact { font-size: 25px; line-height: 1.25; margin-top: 2px; }
        .export-title { font-size: 28px; font-weight: 700; letter-spacing: 0.3px; }
        .export-sub { font-size: 25px; font-weight: 700; margin-top: 2px; }
        .divider { border-top: 3px dashed #000; margin: 14px 0; }
        .row { display: flex; justify-content: space-between; gap: 8px; padding: 3px 0; }
        .item-row { padding: 6px 0; margin-bottom: 8px; }
        .item-name { font-weight: 700; font-size: 25px; margin-bottom: 2px; }
        .item-line { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; margin-top: 2px; }
        .item-meta { font-size: 25px; }
        .item-total { font-weight: 700; text-align: right; font-size: 25px; }
        .totals .row { font-size: 25px; padding: 3px 0; }
        .grand { font-size: 27px; font-weight: 700; }
        .export-qr-wrap { text-align: center; padding: 8px 0; }
        .export-qr-svg {
          width: 190px;
          height: 190px;
          margin: 0 auto 6px;
        }
        .export-qr-svg svg {
          width: 100%;
          height: 100%;
          display: block;
        }
        .export-qr-label {
          font-size: 25px;
          line-height: 1.25;
          text-align: center;
        }
        .footer-note { white-space: pre-wrap; font-size: 19px; line-height: 1.35; text-align: center; }
        .generated { font-size: 19px; text-align: center; margin-top: 8px; margin-bottom: 10px; }
      </style>
      <div class="export-receipt">
        ${printSettings.showLogoPaperang ? `<img class="export-logo" src="${escapeHtml(printSettings.logoUrl)}" alt="Logo" />` : ''}
        <div class="export-center export-company">${escapeHtml(companyName)}</div>
        ${addressLines.map((line) => `<div class="export-center export-contact">${escapeHtml(line)}</div>`).join('')}
        ${contactLines.map((line) => `<div class="export-center export-contact">${escapeHtml(line)}</div>`).join('')}
        ${printSettings.showTaxThermal ? `<div class="export-center export-contact">No. Cukai: ${escapeHtml(printSettings.taxNumber)}</div>` : ''}
        <div class="divider"></div>
        <div class="export-center export-title">INVOIS</div>
        <div class="export-center export-sub">${escapeHtml(invoiceData.invoice_number || '')}</div>
        <div class="divider"></div>
        <div class="row"><span>Pelanggan</span><span>${escapeHtml(clientName)}</span></div>
        <div class="row"><span>Tarikh</span><span>${escapeHtml(invoiceDate)}</span></div>
        ${createdAt ? `<div class="row"><span>Masa</span><span>${escapeHtml(createdAt.split(', ')[1] || '')}</span></div>` : ''}
        <div class="divider"></div>
        ${itemsHtml}
        <div class="divider"></div>
        <div class="totals">
          <div class="row"><span>Subtotal</span><span>${escapeHtml(formatCurrency(invoiceData.subtotal || 0))}</span></div>
          <div class="row"><span>Cukai</span><span>${escapeHtml(formatCurrency(invoiceData.tax_amount || 0))}</span></div>
          <div class="row grand"><span>Jumlah</span><span>${escapeHtml(formatCurrency(invoiceData.total_amount || 0))}</span></div>
        </div>
        ${showQr ? `
          <div class="divider"></div>
          <div class="export-qr-wrap">
            <div class="export-qr-svg">${paperangQrSvgMarkup}</div>
            <div class="export-qr-label">${escapeHtml(printSettings.qrLabel)}</div>
          </div>
        ` : ''}
        ${invoiceData.notes ? `<div class="divider"></div><div class="footer-note">Nota: ${escapeHtml(invoiceData.notes)}</div>` : ''}
        ${printSettings.footerNotes ? `<div class="divider"></div><div class="footer-note">${escapeHtml(printSettings.footerNotes)}</div>` : ''}
        ${printSettings.showGeneratedByPaperang ? '<div class="divider"></div><div class="generated">Generated by RareBits</div>' : ''}
      </div>
    `;
  };

  const handleExportThermal = async () => {
    if (!invoice) return;

    const exportWidth = 384;
    const scale = 2;
    const isMobile = typeof navigator !== 'undefined'
      ? /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '')
      : false;

    const dataUrlToBlob = (dataUrl) => {
      const [meta, base64] = dataUrl.split(',');
      const mimeMatch = meta.match(/data:(.*?);base64/);
      const mime = mimeMatch?.[1] || 'image/png';
      const binary = atob(base64 || '');
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return new Blob([bytes], { type: mime });
    };

    const canvasToBlob = async (canvas) => {
      if (canvas.toBlob) {
        const blob = await new Promise((resolve) => {
          canvas.toBlob((result) => resolve(result), 'image/png');
        });
        if (blob) return blob;
      }
      return dataUrlToBlob(canvas.toDataURL('image/png'));
    };

    const loadImage = async (src) => {
      if (!src) return null;
      return await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Gagal memuat imej QR'));
        image.src = src;
      });
    };

    const buildMobileExportBlob = async (qrDataUrlForExport) => {
      const measureCanvas = document.createElement('canvas');
      const measureCtx = measureCanvas.getContext('2d');
      if (!measureCtx) {
        throw new Error('Gagal ukur layout export');
      }

      const paddingX = 16;
      const contentWidth = exportWidth - (paddingX * 2);
      const ops = [];
      let y = 18;
      const defaultSize = 25;
      const defaultLineHeight = 36;

      const wrapText = (text, font) => {
        if (!text) return [];
        const paragraphs = String(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        if (paragraphs.length === 0) return [];
        measureCtx.font = font;
        const lines = [];
        paragraphs.forEach((paragraph) => {
          const words = paragraph.split(/\s+/);
          let current = '';
          words.forEach((word) => {
            const candidate = current ? `${current} ${word}` : word;
            if (measureCtx.measureText(candidate).width <= contentWidth || !current) {
              current = candidate;
            } else {
              lines.push(current);
              current = word;
            }
          });
          if (current) lines.push(current);
        });
        return lines;
      };

      const addTextBlock = (text, options = {}) => {
        if (!text) return;
        const size = options.size ?? defaultSize;
        const weight = options.weight ?? 700;
        const lineHeight = options.lineHeight ?? defaultLineHeight;
        const align = options.align ?? 'left';
        const color = options.color ?? '#000000';
        const font = `${weight} ${size}px Arial`;
        const lines = wrapText(text, font);
        lines.forEach((line) => {
          ops.push({ type: 'text', text: line, x: align === 'center' ? exportWidth / 2 : paddingX, y, align, size, weight, color });
          y += lineHeight;
        });
      };

      const addDivider = () => {
        y += 10;
        ops.push({ type: 'divider', y });
        y += 20;
      };

      const addRow = (left, right, options = {}) => {
        const size = options.size ?? defaultSize;
        const weight = options.weight ?? 700;
        const color = options.color ?? '#000000';
        ops.push({ type: 'row', left: String(left || ''), right: String(right || ''), y, size, weight, color });
        y += options.lineHeight ?? defaultLineHeight;
      };

      const invoiceDate = invoice.invoice_date
        ? format(new Date(invoice.invoice_date), 'dd MMM yyyy', { locale: ms })
        : '';
      const createdAt = invoice.created_at
        ? format(new Date(invoice.created_at), 'dd MMM yyyy, HH:mm', { locale: ms })
        : '';
      const clientName = invoice.client?.name || 'Pelanggan';
      const addressLines = printSettings.addressLinesThermal;
      const contactLines = [
        (printSettings.thermalShowPhone && printSettings.phone) ? `Tel: ${printSettings.phone}` : '',
        (printSettings.thermalShowWebsite && printSettings.website) ? printSettings.website : '',
        (printSettings.thermalShowEmail && printSettings.email) ? printSettings.email : '',
      ].filter(Boolean);

      addTextBlock(printSettings.companyName, { align: 'center', size: 32, weight: 700, lineHeight: 39 });
      addressLines.forEach((line) => addTextBlock(line, { align: 'center', size: 25, weight: 700, lineHeight: 31 }));
      contactLines.forEach((line) => addTextBlock(line, { align: 'center', size: 25, weight: 700, lineHeight: 31 }));
      if (printSettings.showTaxThermal && printSettings.taxNumber) {
        addTextBlock(`No. Cukai: ${printSettings.taxNumber}`, { align: 'center', size: 25, weight: 700, lineHeight: 31 });
      }

      addDivider();
      addTextBlock('INVOIS', { align: 'center', size: 28, weight: 700, lineHeight: 36 });
      addTextBlock(invoice.invoice_number || '', { align: 'center', size: 25, weight: 700, lineHeight: 33 });
      addDivider();

      addRow('Pelanggan', clientName);
      addRow('Tarikh', invoiceDate);
      if (createdAt) {
        addRow('Masa', createdAt.split(', ')[1] || '');
      }

      addDivider();
      (invoice.invoice_items || []).forEach((item) => {
        const name = item.is_manual ? item.item_name : item.item?.name;
        const qty = item.quantity || 1;
        const unitPrice = item.unit_price || 0;
        const lineTotal = item.line_total || 0;

        addTextBlock(name || 'Item', { align: 'left', size: 25, weight: 700, lineHeight: 32 });
        addRow(`${qty} x ${formatCurrency(unitPrice)}`, formatCurrency(lineTotal), { lineHeight: 32 });
        y += 6;
      });

      addDivider();
      addRow('Subtotal', formatCurrency(invoice.subtotal || 0));
      addRow('Cukai', formatCurrency(invoice.tax_amount || 0));
      addRow('Jumlah', formatCurrency(invoice.total_amount || 0), { size: 27, weight: 700, lineHeight: 36 });

      if (qrDataUrlForExport) {
        addDivider();
        const qrSize = 190;
        ops.push({ type: 'qr', x: (exportWidth - qrSize) / 2, y, size: qrSize, src: qrDataUrlForExport });
        y += qrSize + 10;
        addTextBlock(printSettings.qrLabel, { align: 'center', size: 25, weight: 700, lineHeight: 33 });
      }

      if (invoice.notes) {
        addDivider();
        addTextBlock(`Nota: ${invoice.notes}`, { align: 'center', size: 25, weight: 700, lineHeight: 33 });
      }

      if (printSettings.footerNotes) {
        addDivider();
        addTextBlock(printSettings.footerNotes, { align: 'center', size: 19, weight: 700, lineHeight: 27 });
      }

      if (printSettings.showGeneratedByPaperang) {
        addDivider();
        addTextBlock('Generated by RareBits', { align: 'center', size: 19, weight: 700, lineHeight: 27 });
      }

      const finalHeight = Math.max(Math.ceil(y + 72), 260);
      const canvas = document.createElement('canvas');
      canvas.width = exportWidth * scale;
      canvas.height = finalHeight * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Canvas context tidak tersedia');
      }

      ctx.scale(scale, scale);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, exportWidth, finalHeight);

      let qrImage = null;
      if (qrDataUrlForExport) {
        try {
          qrImage = await loadImage(qrDataUrlForExport);
        } catch (error) {
          console.error('[InvoiceDetailsPage] Mobile QR load failed:', error);
        }
      }

      for (const op of ops) {
        if (op.type === 'divider') {
          ctx.save();
          ctx.strokeStyle = '#000000';
          ctx.setLineDash([7, 4]);
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(paddingX, op.y);
          ctx.lineTo(exportWidth - paddingX, op.y);
          ctx.stroke();
          ctx.restore();
          continue;
        }

        if (op.type === 'text') {
          ctx.save();
          ctx.fillStyle = op.color || '#000000';
          ctx.textAlign = op.align || 'left';
          ctx.textBaseline = 'top';
          ctx.font = `${op.weight || 700} ${op.size || defaultSize}px Arial`;
          ctx.fillText(op.text, op.x, op.y);
          ctx.restore();
          continue;
        }

        if (op.type === 'row') {
          ctx.save();
          ctx.fillStyle = op.color || '#000000';
          ctx.font = `${op.weight || 700} ${op.size || defaultSize}px Arial`;
          ctx.textBaseline = 'top';
          ctx.textAlign = 'left';
          ctx.fillText(op.left, paddingX, op.y);
          ctx.textAlign = 'right';
          ctx.fillText(op.right, exportWidth - paddingX, op.y);
          ctx.restore();
          continue;
        }

        if (op.type === 'qr' && qrImage) {
          ctx.drawImage(qrImage, op.x, op.y, op.size, op.size);
        }
      }

      return await canvasToBlob(canvas);
    };

    const buildExportBlob = async (qrSvgMarkupForExport) => {
      const container = document.createElement('div');
      container.style.position = 'fixed';
      container.style.left = '-9999px';
      container.style.top = '0';
      container.style.width = `${exportWidth}px`;
      container.style.background = '#fff';
      container.innerHTML = buildThermalExportMarkup(invoice, { qrSvgMarkup: qrSvgMarkupForExport });
      document.body.appendChild(container);

      try {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const height = Math.ceil(container.scrollHeight);

        const svg = `
          <svg xmlns="http://www.w3.org/2000/svg" width="${exportWidth}" height="${height}">
            <foreignObject width="100%" height="100%">
              <div xmlns="http://www.w3.org/1999/xhtml" style="width:${exportWidth}px;height:${height}px;">
                ${container.innerHTML}
              </div>
            </foreignObject>
          </svg>
        `;

        const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
        const svgObjectUrl = URL.createObjectURL(svgBlob);

        const img = await new Promise((resolve, reject) => {
          const image = new Image();
          const timeoutId = setTimeout(() => {
            image.onload = null;
            image.onerror = null;
            reject(new Error('Timeout render SVG untuk export Paperang'));
          }, 10000);

          image.onload = () => {
            clearTimeout(timeoutId);
            resolve(image);
          };
          image.onerror = () => {
            clearTimeout(timeoutId);
            reject(new Error('Gagal render SVG untuk export Paperang'));
          };
          image.src = svgObjectUrl;
        });
        URL.revokeObjectURL(svgObjectUrl);

        const canvas = document.createElement('canvas');
        canvas.width = exportWidth * scale;
        canvas.height = height * scale;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Canvas context tidak tersedia');
        }
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0);

        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = exportWidth;
        finalCanvas.height = height;
        const finalCtx = finalCanvas.getContext('2d');
        if (!finalCtx) {
          throw new Error('Final canvas context tidak tersedia');
        }
        finalCtx.imageSmoothingEnabled = true;
        finalCtx.drawImage(canvas, 0, 0, exportWidth, height);

        return await canvasToBlob(finalCanvas);
      } finally {
        container.remove();
      }
    };

    try {
      let blob;

      if (isMobile) {
        let qrDataUrl = '';
        if (printSettings.showQrPaperang) {
          qrDataUrl = await getQrDataUrl(printSettings.qrUrl, 256);
        }
        blob = await buildMobileExportBlob(qrDataUrl);
      } else {
        let qrSvgMarkup = '';
        if (printSettings.showQrPaperang) {
          qrSvgMarkup = await getQrSvgMarkup(printSettings.qrUrl, 256);
        }

        try {
          blob = await buildExportBlob(qrSvgMarkup);
        } catch (error) {
          if (!qrSvgMarkup) throw error;
          console.error('[InvoiceDetailsPage] Paperang export with QR failed, retrying without QR:', error);
          blob = await buildExportBlob('');
          toast.error('QR gagal dirender untuk Paperang. Export diteruskan tanpa QR.');
        }
      }

      const fileName = `invoice-${invoice.invoice_number || invoice.id}.png`;
      const blobUrl = URL.createObjectURL(blob);
      if (isMobile) {
        const mobileFile = new File([blob], fileName, { type: 'image/png' });
        const canShareFile = typeof navigator !== 'undefined'
          && typeof navigator.share === 'function'
          && (typeof navigator.canShare !== 'function' || navigator.canShare({ files: [mobileFile] }));

        if (canShareFile) {
          try {
            await navigator.share({
              files: [mobileFile],
              title: invoice.invoice_number || 'Resit',
              text: 'Resit untuk dicetak',
            });
            URL.revokeObjectURL(blobUrl);
            return;
          } catch (error) {
            if (error?.name === 'AbortError') {
              URL.revokeObjectURL(blobUrl);
              return;
            }
            console.error('[InvoiceDetailsPage] Mobile share failed, fallback to download:', error);
          }
        }

        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = fileName;
        link.rel = 'noopener noreferrer';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
        return;
      }

      const file = new File([blob], fileName, { type: 'image/png' });
      if (typeof navigator !== 'undefined' && navigator.share) {
        try {
          await navigator.share({
            files: [file],
            title: invoice.invoice_number || 'Resit',
            text: 'Resit untuk dicetak',
          });
          URL.revokeObjectURL(blobUrl);
          return;
        } catch (error) {
          if (error?.name === 'AbortError') {
            URL.revokeObjectURL(blobUrl);
            return;
          }
          console.error('[InvoiceDetailsPage] Share file failed:', error);
        }
      }

      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error('[InvoiceDetailsPage] Export Paperang failed:', error);
      toast.error('Gagal export resit Paperang');
    }
  };

  async function validateInvoiceAvailability() {
    if (!invoice?.invoice_items || invoice.invoice_items.length === 0) return { ok: true };

    const requestedById = new Map();
    invoice.invoice_items.forEach((invItem) => {
      if (!invItem.item_id) return;
      const qty = parseInt(invItem.quantity, 10) || 0;
      requestedById.set(invItem.item_id, (requestedById.get(invItem.item_id) || 0) + qty);
    });

    const itemIds = Array.from(requestedById.keys());
    if (itemIds.length === 0) return { ok: true };

    const { data, error } = await supabase
      .from('items')
      .select('id, name, quantity, quantity_reserved, inventory_reservations(quantity_reserved)')
      .in('id', itemIds);

    if (error) {
      console.error('[InvoiceDetailsPage] Error validating availability:', error);
      toast.error('Gagal menyemak stok. Sila cuba lagi.');
      return { ok: false };
    }

    const availabilityById = new Map(
      (data || []).map((item) => [
        item.id,
        {
          available: getAvailableQuantityFromItem(item),
          name: item.name || 'Item',
        },
      ])
    );

    const shortages = [];
    requestedById.forEach((requested, itemId) => {
      const availability = availabilityById.get(itemId);
      const available = availability?.available ?? 0;
      const fallbackName = invoice.invoice_items.find((invItem) => invItem.item_id === itemId)?.item?.name || 'Item';
      const name = availability?.name || fallbackName;

      if (!availability || requested > available) {
        shortages.push({ name, available, requested });
      }
    });

    if (shortages.length > 0) {
      const first = shortages[0];
      toast.error(`Stok tidak mencukupi untuk ${first.name}. Available: ${first.available}, Requested: ${first.requested}`);
      return { ok: false, shortages };
    }

    return { ok: true };
  }

  const handleMarkAsPaid = async () => {
    try {
      const shippingReady = await persistShippingCharged({ silentSuccess: true });
      if (!shippingReady) return;

      const availabilityCheck = await validateInvoiceAvailability();
      if (!availabilityCheck.ok) return;

      await markInvoiceAsPaid.mutateAsync({
        invoiceId,
      });
      toast.success('Invois berjaya ditandai sebagai dibayar. Dompet diperbarui!');
    } catch (error) {
      console.error('[InvoiceDetailsPage] Error marking as paid:', error);
      toast.error('Ralat: ' + (error.message || 'Gagal menandai sebagai dibayar'));
    }
  };

  const handleSaveTracking = async () => {
    try {
      const deliveryValidation = validateDeliveryInput({ commitNormalized: true });
      if (!deliveryValidation.ok) {
        const message = deliveryValidation.errors.courier || deliveryValidation.errors.trackingNo;
        toast.error(message || 'Sila semak maklumat penghantaran');
        return;
      }

      await saveInvoiceShipment.mutateAsync({
        invoiceId,
        courier: deliveryValidation.values.courier,
        trackingNo: deliveryValidation.values.trackingNo,
      });
      toast.success('Tracking berjaya disimpan');
    } catch (saveError) {
      console.error('[InvoiceDetailsPage] Error saving shipment tracking:', saveError);
      toast.error(saveError?.message || 'Gagal simpan tracking');
    }
  };

  const handleUpdateShipmentStatus = async (shipStatus) => {
    try {
      const deliveryValidation = validateDeliveryInput({ commitNormalized: true });
      if (!deliveryValidation.ok) {
        const message = deliveryValidation.errors.courier || deliveryValidation.errors.trackingNo;
        toast.error(message || 'Sila semak maklumat penghantaran');
        return;
      }

      await updateInvoiceShipmentStatus.mutateAsync({
        invoiceId,
        shipStatus,
        courier: deliveryValidation.values.courier,
        trackingNo: deliveryValidation.values.trackingNo,
      });
      if (shipStatus === 'shipped') {
        toast.success('Status penghantaran: Shipped');
      } else if (shipStatus === 'delivered') {
        toast.success('Status penghantaran: Delivered');
      } else {
        toast.success('Status penghantaran dikemaskini');
      }
    } catch (statusError) {
      console.error('[InvoiceDetailsPage] Error updating shipment status:', statusError);
      toast.error('Gagal kemaskini status penghantaran');
    }
  };

  const handleMarkCourierPaid = async () => {
    try {
      const shippingCostValidation = validateCourierPaidCostInput({ commitDisplay: true });
      if (!shippingCostValidation.ok) {
        toast.error(shippingCostValidation.message || 'Kos courier tidak sah');
        return;
      }

      const paidDateValidation = validateCourierPaidDateInput();
      if (!paidDateValidation.ok) {
        toast.error(paidDateValidation.message || 'Tarikh bayaran tidak sah');
        return;
      }

      const notesValidation = validateCourierPaidNotesInput({ normalize: true });
      if (!notesValidation.ok) {
        toast.error(notesValidation.message || 'Catatan tidak sah');
        return;
      }

      await markShipmentCourierPaid.mutateAsync({
        invoiceId,
        shippingCost: shippingCostValidation.value,
        paidAt: paidDateValidation.iso,
        notes: notesValidation.value,
      });
      toast.success('Bayaran courier berjaya direkod');
      setShowCourierPaidModal(false);
      setCourierPaidCost('');
      setCourierPaidDate(toLocalDateTimeInputValue(new Date()));
      setCourierPaidNotes('');
    } catch (markPaidError) {
      console.error('[InvoiceDetailsPage] Error marking courier paid:', markPaidError);
      toast.error(markPaidError.message || 'Gagal rekod bayaran courier');
    }
  };

  const handleSaveShippingCharged = async () => {
    await persistShippingCharged({ silentSuccess: false });
  };

  const handleReversePayment = async () => {
    if (!window.confirm('Anda pasti mahu batalkan pembayaran invois ini?')) return;

    try {
      await reversePayment.mutateAsync({
        invoiceId,
      });
      toast.success('Pembayaran invois berjaya dibatalkan');
    } catch (error) {
      console.error('[InvoiceDetailsPage] Error reversing payment:', error);
      toast.error('Ralat: ' + (error.message || 'Gagal membatalkan pembayaran'));
    }
  };

  const handleProcessRefund = async () => {
    try {
      const amount = parseFloat(refundAmount);
      if (!amount || amount <= 0) {
        toast.error('Amaun pemulangan mestilah lebih besar dari 0');
        return;
      }

      if (amount > (invoice?.total_amount || 0)) {
        toast.error(`Amaun pemulangan tidak boleh melebihi RM${invoice?.total_amount}`);
        return;
      }

      if (!refundReason) {
        toast.error('Sila pilih sebab pemulangan');
        return;
      }

      await processRefund.mutateAsync({
        invoiceId,
        refundAmount: amount,
        reason: refundReason,
        notes: refundNotes || '',
      });

      toast.success(`Pemulangan sebanyak RM${amount.toFixed(2)} berjaya diproses`);
      
      // Reset modal
      setShowRefundModal(false);
      setRefundAmount('');
      setRefundReason('');
      setRefundNotes('');
    } catch (error) {
      console.error('[InvoiceDetailsPage] Error processing refund:', error);
      toast.error('Ralat: ' + (error.message || 'Gagal memproses pemulangan'));
    }
  };

  const getStatusBadgeColor = (status) => {
    const statusColors = {
      draft: 'bg-gray-100 text-gray-800',
      finalized: 'bg-blue-100 text-blue-800',
      paid: 'bg-green-100 text-green-800',
      cancelled: 'bg-red-100 text-red-800',
    };
    return statusColors[status] || 'bg-gray-100 text-gray-800';
  };

  const getStatusLabel = (status) => {
    const labels = {
      draft: 'Draf',
      finalized: 'Muktamad',
      paid: 'Dibayar',
      cancelled: 'Dibatalkan',
    };
    return labels[status] || status;
  };

  const getShipmentStatusBadgeColor = (shipStatus) => {
    const statusColors = {
      not_required: 'bg-slate-100 text-slate-700',
      pending: 'bg-amber-100 text-amber-800',
      shipped: 'bg-blue-100 text-blue-800',
      delivered: 'bg-emerald-100 text-emerald-800',
      returned: 'bg-rose-100 text-rose-800',
      cancelled: 'bg-red-100 text-red-800',
    };
    return statusColors[shipStatus] || 'bg-slate-100 text-slate-700';
  };

  const getShipmentStatusLabel = (shipStatus) => {
    const labels = {
      not_required: 'Tak Perlu Pos',
      pending: 'Pending',
      shipped: 'Shipped',
      delivered: 'Delivered',
      returned: 'Returned',
      cancelled: 'Cancelled',
    };
    return labels[shipStatus] || 'Pending';
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="text-center">Sedang memuatkan invois...</div>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="p-6">
        <div className="text-center">Invois tidak ditemui</div>
      </div>
    );
  }

  const shippingChargedAmount = Math.max(parseFloat(invoice.shipping_charged) || 0, 0);
  const shippingMethod = String(invoice.shipping_method || '').trim().toLowerCase();
  const deliveryNotRequired = shippingChargedAmount === 0
    && (invoice.shipping_required === false || ['pickup', 'meetup', 'selfpickup'].includes(shippingMethod));
  const shipmentStatus = deliveryNotRequired ? 'not_required' : (shipment?.ship_status || 'pending');
  const deliveryActionsDisabled = invoice.status !== 'paid';
  const isSavingDelivery = saveInvoiceShipment.isPending || updateInvoiceShipmentStatus.isPending;
  const isSavingShippingCharged = updateInvoiceShippingCharged.isPending;
  const hasCourierPaid = Boolean(shipment?.courier_paid);
  const hasShipmentRecord = Boolean(shipment?.id || invoice?.shipment_id);
  const canShowCourierPaidAction = !deliveryNotRequired && invoice.status === 'paid' && hasShipmentRecord;
  const courierPayAllowedByStatus = ['pending', 'shipped', 'delivered'].includes(shipmentStatus);
  const canMarkCourierPaid = canShowCourierPaidAction && courierPayAllowedByStatus && !hasCourierPaid;
  const isMarkingCourierPaid = markShipmentCourierPaid.isPending;
  const shippingCostValue = Math.max(parseFloat(shipment?.shipping_cost) || 0, 0);
  const isShippingCostRecorded = Boolean(shipment && (shipment.courier_paid || shippingCostValue > 0));
  const shippingProfitValue = shippingChargedAmount - shippingCostValue;
  const hasTrackingNumber = normalizeWhitespaceText(shipment?.tracking_no || deliveryForm.trackingNo || '').length > 0;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/invoices')}
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">{invoice.invoice_number}</h1>
            <p className="mt-2 text-gray-600">Lihat dan urus butiran invois</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <Button
            variant="outline"
            size="default"
            onClick={() => setShowPrintOptions(true)}
            className="gap-2 flex-1 sm:flex-initial h-10"
          >
            <Download className="h-5 w-5" />
            Cetak
          </Button>
          <Button
            variant="outline"
            size="default"
            onClick={() => navigate(`/invoices/${invoiceId}/edit`)}
            disabled={invoice.status === 'paid'}
            className="gap-2 flex-1 sm:flex-initial h-10"
          >
            <Edit className="h-5 w-5" />
            Sunting
          </Button>

          {invoice.status === 'draft' && (
            <>
              <Button
                variant="outline"
                size="default"
                onClick={() => handleStatusChange('finalized')}
                disabled={updateStatus.isPending}
                className="gap-2 flex-1 sm:flex-initial h-10"
              >
                Muktamadkan
              </Button>
            </>
          )}

          {invoice.status === 'finalized' && (
            <>
              <Button
                variant="outline"
                size="default"
                onClick={handleMarkAsPaid}
                disabled={markInvoiceAsPaid.isPending}
                className="gap-2 flex-1 sm:flex-initial h-10"
              >
                Tandai Dibayar
              </Button>
            </>
          )}

          {invoice.status === 'paid' && (
            <>
              <Button
                variant="outline"
                size="default"
                onClick={() => setShowRefundModal(true)}
                disabled={processRefund.isPending}
                className="gap-2 flex-1 sm:flex-initial h-10"
              >
                <DollarSign className="h-5 w-5" />
                Refund
              </Button>
            </>
          )}

          <Button
            variant="outline"
            size="default"
            onClick={() => {
              if (window.confirm('Adakah anda pasti ingin menghapus invois ini?')) {
                handleDeleteInvoice();
              }
            }}
            disabled={invoice.status === 'paid'}
            className="gap-2 flex-1 sm:flex-initial text-red-600 hover:text-red-800 h-10"
          >
            <Trash2 className="h-5 w-5" />
            Hapus
          </Button>
        </div>
      </div>

      <AlertDialog open={showPrintOptions} onOpenChange={setShowPrintOptions}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pilih Cara Cetak</AlertDialogTitle>
            <AlertDialogDescription>
              Pilih jenis cetakan yang anda mahu gunakan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex flex-row flex-nowrap gap-2 overflow-x-auto">
            <AlertDialogCancel className="whitespace-nowrap">Batal</AlertDialogCancel>
            <AlertDialogAction
              className="whitespace-nowrap"
              onClick={() => {
                setShowPrintOptions(false);
                handlePrintInvoice();
              }}
            >
              Cetak A4
            </AlertDialogAction>
            <AlertDialogAction
              className="whitespace-nowrap"
              onClick={() => {
                setShowPrintOptions(false);
                handlePrintThermal();
              }}
            >
              Cetak Thermal
            </AlertDialogAction>
            <AlertDialogAction
              className="whitespace-nowrap"
              onClick={() => {
                setShowPrintOptions(false);
                handleExportThermal();
              }}
            >
              Export Paperang
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Main Content */}
        <div className="space-y-6 lg:col-span-2">
          {/* Buyer Information */}
          <Card>
            <CardHeader>
              <CardTitle>Maklumat Pembeli</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium text-gray-600">Nama</p>
                  <p className="text-lg font-semibold">{invoice.client?.name}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-600">Email</p>
                  <p className="text-lg">{invoice.client?.email || '-'}</p>
                </div>
              </div>

              {invoice.client?.client_phones?.[0] && (
                <div>
                  <p className="text-sm font-medium text-gray-600">Telefon</p>
                  <p className="text-lg">
                    {invoice.client.client_phones.map((p) => p.phone_number).join(', ')}
                  </p>
                </div>
              )}

              {invoice.client?.client_addresses?.[0] && (
                <div>
                  <p className="text-sm font-medium text-gray-600">Alamat</p>
                  <p className="text-lg">
                    {invoice.client.client_addresses
                      .map((a) => a.address)
                      .join(' | ')}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Invoice Items */}
          <Card>
            <CardHeader>
              <CardTitle>Item Invois</CardTitle>
              <CardDescription>
                {invoice.invoice_items?.length || 0} item dalam invois ini
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {invoice.invoice_items?.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between rounded-lg border p-4"
                  >
                    <div className="flex-1">
                      <p className="font-medium">
                        {item.is_manual ? item.item_name : item.item?.name}
                      </p>
                      <p className="text-sm text-gray-600">
                        {item.is_manual ? 'Item Manual' : item.item?.category}
                      </p>
                    </div>
                    <div className="flex items-center gap-4 text-right">
                      <div className="min-w-24">
                        <p className="text-sm text-gray-600">
                          {item.quantity} × {formatCurrency(item.unit_price)}
                        </p>
                        <p className="font-semibold">
                          {formatCurrency(item.line_total)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Notes */}
          {invoice.notes && (
            <Card>
              <CardHeader>
                <CardTitle>Nota</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap">{invoice.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Summary Section */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle>Ringkasan Invois</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Status */}
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs font-medium text-gray-600">Status</p>
                <span
                  className={`mt-2 inline-block rounded-full px-3 py-1 text-sm font-medium ${getStatusBadgeColor(invoice.status)}`}
                >
                  {getStatusLabel(invoice.status)}
                </span>
              </div>

              {/* Dates */}
              <div>
                <p className="text-xs font-medium text-gray-600">Tarikh Invois</p>
                <p className="mt-1 text-lg font-semibold">
                  {format(new Date(invoice.invoice_date), 'dd MMMM yyyy', {
                    locale: ms,
                  })}
                </p>
              </div>

              <div>
                <p className="text-xs font-medium text-gray-600">Dibuat</p>
                <p className="mt-1 text-sm text-gray-600">
                  {format(new Date(invoice.created_at), 'dd MMM yyyy, HH:mm', {
                    locale: ms,
                  })}
                </p>
              </div>

              {/* Totals */}
              <div className="space-y-3 border-t border-b py-4">
                <div className="flex justify-between text-sm">
                  <span>Subtotal:</span>
                  <span className="font-medium">
                    {formatCurrency(invoice.subtotal)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Cukai:</span>
                  <span className="font-medium">
                    {formatCurrency(invoice.tax_amount)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Caj Pos Dikutip:</span>
                  <span className="font-medium">
                    {formatCurrency(invoice.shipping_charged || 0)}
                  </span>
                </div>
              </div>

              <div className="flex justify-between text-xl font-bold">
                <span>Jumlah:</span>
                <span>{formatCurrency(invoice.total_amount)}</span>
              </div>

              {/* Action Buttons */}
              {invoice.status === 'draft' && (
                <Button
                  onClick={() => handleStatusChange('finalized')}
                  size="default"
                  className="w-full h-10"
                  disabled={updateStatus.isPending || isSavingShippingCharged || Boolean(shippingChargedError)}
                >
                  Muktamadkan Invois
                </Button>
              )}

              {invoice.status === 'finalized' && (
                <Button
                  onClick={handleMarkAsPaid}
                  size="default"
                  className="w-full bg-green-600 hover:bg-green-700 h-10"
                  disabled={markInvoiceAsPaid.isPending || isSavingShippingCharged || Boolean(shippingChargedError)}
                >
                  {markInvoiceAsPaid.isPending ? 'Sedang Memproses...' : 'Tandai Dibayar'}
                </Button>
              )}

              {invoice.status === 'paid' && (
                <>
                  <div className="rounded-lg bg-green-50 p-3 border border-green-200">
                    <p className="text-sm font-medium text-green-800">✓ Invois Telah Dibayar</p>
                    <p className="text-xs text-green-700 mt-1">
                      Dompet dan rekod pelanggan telah diperbarui
                    </p>
                  </div>
                  
                  {/* Refunds History - Direct under paid status */}
                  {invoice?.refunds && invoice.refunds.length > 0 && (
                    <div className="space-y-2 mt-3">
                      {invoice.refunds.map((refund) => (
                        <div key={refund.id} className="flex items-start justify-between p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900">
                          <div className="flex-1">
                            <p className="font-semibold text-red-700 dark:text-red-300">RM {parseFloat(refund.amount).toFixed(2)}</p>
                            <p className="text-sm text-red-600 dark:text-red-400 mt-0.5">{refund.reason}</p>
                            {refund.notes && <p className="text-xs text-red-500 dark:text-red-400 mt-1">Catatan: {refund.notes}</p>}
                            <p className="text-xs text-red-500 dark:text-red-600 mt-1">{new Date(refund.created_at).toLocaleDateString()} · {new Date(refund.created_at).toLocaleTimeString()}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Delivery</CardTitle>
              <CardDescription>
                Urus tracking penghantaran. Caj pos ini bukan revenue.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border bg-slate-50 p-3">
                <div>
                  <p className="text-xs font-medium text-slate-600">Caj Pos Dikutip</p>
                  <p className="text-lg font-semibold text-slate-900">
                    {formatCurrency(shippingChargedAmount)}
                  </p>
                </div>
                <span className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${getShipmentStatusBadgeColor(shipmentStatus)}`}>
                  {getShipmentStatusLabel(shipmentStatus)}
                </span>
              </div>

              <div className="rounded-lg border p-3">
                <label className="mb-1 block text-xs font-medium text-gray-600">Caj Pos Dikutip (RM)</label>
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={shippingChargedInput}
                  onChange={(event) => {
                    setShippingChargedInput(event.target.value);
                    if (shippingChargedError) {
                      setShippingChargedError('');
                    }
                  }}
                  onBlur={() => {
                    validateShippingChargedInput({ commitDisplay: true });
                  }}
                  disabled={invoice.status === 'paid' || isSavingShippingCharged}
                  className="h-10"
                />
                {shippingChargedError && (
                  <p className="mt-1 text-xs text-red-600">{shippingChargedError}</p>
                )}
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-gray-500">
                    Kos pos yang dibayar pelanggan. Biar kosong untuk auto 0.
                  </p>
                  {invoice.status !== 'paid' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleSaveShippingCharged}
                      disabled={isSavingShippingCharged}
                    >
                      {isSavingShippingCharged ? 'Menyimpan...' : 'Simpan Caj Pos'}
                    </Button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 rounded-lg border p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">Kos Courier</span>
                  <span className="font-medium text-slate-900">{formatCurrency(shippingCostValue)}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">Status Bayaran Courier</span>
                  <span className={`inline-block rounded-full px-2.5 py-0.5 font-medium ${hasCourierPaid ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                    {hasCourierPaid ? 'Telah Dibayar' : 'Belum Dibayar'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">Untung/Rugi Pos</span>
                  {isShippingCostRecorded ? (
                    <span className={`inline-block rounded-full px-2.5 py-0.5 font-medium ${shippingProfitValue >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                      {formatCurrency(shippingProfitValue)}
                    </span>
                  ) : (
                    <span className="inline-block rounded-full bg-slate-100 px-2.5 py-0.5 font-medium text-slate-600">
                      Pending kos courier
                    </span>
                  )}
                </div>
                {shipment?.courier_paid_at && (
                  <p className="text-xs text-slate-500">
                    Dibayar pada {format(new Date(shipment.courier_paid_at), 'dd MMM yyyy, HH:mm', { locale: ms })}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Courier</label>
                  <Input
                    placeholder="Contoh: J&T, PosLaju"
                    value={deliveryForm.courier}
                    onChange={(event) => {
                      setDeliveryForm((prev) => ({ ...prev, courier: event.target.value }));
                      if (deliveryFieldErrors.courier) {
                        setDeliveryFieldErrors((prev) => ({ ...prev, courier: '' }));
                      }
                    }}
                    onBlur={() => {
                      const validation = validateDeliveryTextFields(deliveryForm);
                      setDeliveryFieldErrors(validation.errors);
                      setDeliveryForm((prev) => ({ ...prev, courier: validation.values.courier }));
                    }}
                    disabled={deliveryActionsDisabled}
                    className="h-10"
                  />
                  {deliveryFieldErrors.courier && (
                    <p className="mt-1 text-xs text-red-600">{deliveryFieldErrors.courier}</p>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Tracking No</label>
                  <Input
                    placeholder="Masukkan nombor tracking"
                    value={deliveryForm.trackingNo}
                    onChange={(event) => {
                      setDeliveryForm((prev) => ({ ...prev, trackingNo: event.target.value }));
                      if (deliveryFieldErrors.trackingNo) {
                        setDeliveryFieldErrors((prev) => ({ ...prev, trackingNo: '' }));
                      }
                    }}
                    onBlur={() => {
                      const validation = validateDeliveryTextFields(deliveryForm);
                      setDeliveryFieldErrors(validation.errors);
                      setDeliveryForm((prev) => ({ ...prev, trackingNo: validation.values.trackingNo }));
                    }}
                    disabled={deliveryActionsDisabled}
                    className="h-10"
                  />
                  {deliveryFieldErrors.trackingNo && (
                    <p className="mt-1 text-xs text-red-600">{deliveryFieldErrors.trackingNo}</p>
                  )}
                </div>
              </div>

              {shipment?.shipped_at && (
                <p className="text-xs text-gray-600">
                  Shipped: {format(new Date(shipment.shipped_at), 'dd MMM yyyy, HH:mm', { locale: ms })}
                </p>
              )}
              {shipment?.delivered_at && (
                <p className="text-xs text-gray-600">
                  Delivered: {format(new Date(shipment.delivered_at), 'dd MMM yyyy, HH:mm', { locale: ms })}
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="default"
                  onClick={handleSaveTracking}
                  disabled={deliveryActionsDisabled || isSavingDelivery || isShipmentLoading}
                  className="h-10"
                >
                  Simpan Tracking
                </Button>
                <Button
                  variant="outline"
                  size="default"
                  onClick={() => handleUpdateShipmentStatus('shipped')}
                  disabled={deliveryActionsDisabled || isSavingDelivery || isShipmentLoading || shipmentStatus === 'shipped' || shipmentStatus === 'delivered'}
                  className="h-10"
                >
                  Mark Shipped
                </Button>
                <Button
                  variant="outline"
                  size="default"
                  onClick={() => handleUpdateShipmentStatus('delivered')}
                  disabled={deliveryActionsDisabled || isSavingDelivery || isShipmentLoading || shipmentStatus === 'delivered'}
                  className="h-10"
                >
                  Delivered
                </Button>
                {canShowCourierPaidAction && (
                  <Button
                    variant="outline"
                    size="default"
                    onClick={() => setShowCourierPaidModal(true)}
                    disabled={!canMarkCourierPaid || isMarkingCourierPaid || isShipmentLoading}
                    className="h-10"
                  >
                    {hasCourierPaid ? 'Courier Paid' : 'Mark Courier Paid'}
                  </Button>
                )}
              </div>

              {hasCourierPaid && (
                <p className="text-xs text-emerald-700">
                  Courier telah dibayar. Kos courier dikunci dan tidak boleh diubah.
                </p>
              )}
              {canShowCourierPaidAction && !hasCourierPaid && !hasTrackingNumber && (
                <p className="text-xs text-amber-700">
                  Tracking boleh dimasukkan kemudian.
                </p>
              )}
              {canShowCourierPaidAction && !hasCourierPaid && !courierPayAllowedByStatus && (
                <p className="text-xs text-amber-700">
                  Bayaran courier hanya untuk status Pending, Shipped atau Delivered.
                </p>
              )}

              {deliveryActionsDisabled && (
                <p className="text-xs text-gray-500">
                  Delivery boleh dikemaskini selepas invois ditandai sebagai dibayar.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Refund Modal */}
      {showRefundModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <div>
                <CardTitle>Kembalikan Dana</CardTitle>
                <CardDescription className="mt-2">
                  Invois: <span className="font-semibold text-foreground">{invoice?.invoice_number}</span>
                </CardDescription>
                <CardDescription>
                  Jumlah: <span className="font-semibold text-foreground">{formatCurrency(invoice?.total_amount || 0)}</span>
                </CardDescription>
              </div>
              <button
                onClick={() => setShowRefundModal(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <X className="h-5 w-5" />
              </button>
            </CardHeader>

            <CardContent className="space-y-4">
              {/* Warning */}
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 flex gap-3">
                <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-amber-800">
                  <p className="font-medium">Maklumat Penting</p>
                  <p className="mt-1">Pemulangan ini akan mengurangkan saldo dompet anda. Amaun mestilah ≤ RM{invoice?.total_amount}</p>
                </div>
              </div>

              {/* Refund Amount */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Amaun Pemulangan (RM) *</label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max={invoice?.total_amount || 0}
                  placeholder="0.00"
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                  className="h-10"
                />
                <p className="text-xs text-gray-600">
                  Maksimum: RM{invoice?.total_amount}
                </p>
              </div>

              {/* Refund Reason */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Sebab Pemulangan *</label>
                <select
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  className="flex h-10 w-full items-center justify-between rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Pilih sebab pemulangan</option>
                  <option value="Customer Return">Pelanggan Mengembalikan Item</option>
                  <option value="Courtesy">Gerak Budi / Diskaun</option>
                  <option value="Damage">Item Rosak</option>
                  <option value="Exchange">Pertukaran Item</option>
                  <option value="Other">Lain-lain</option>
                </select>
              </div>

              {/* Optional Notes */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Catatan (Pilihan)</label>
                <Input
                  placeholder="Masukkan catatan tambahan..."
                  value={refundNotes}
                  onChange={(e) => setRefundNotes(e.target.value)}
                  className="h-10"
                />
              </div>
            </CardContent>

            <div className="border-t p-4 flex gap-3 justify-end">
              <Button
                variant="outline"
                onClick={() => setShowRefundModal(false)}
                disabled={processRefund.isPending}
                className="h-10"
              >
                Batal
              </Button>
              <Button
                onClick={handleProcessRefund}
                disabled={processRefund.isPending || !refundAmount || !refundReason}
                className="bg-amber-600 hover:bg-amber-700 h-10"
              >
                {processRefund.isPending ? 'Sedang Memproses...' : 'Kembalikan Dana'}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Courier Paid Modal */}
      {showCourierPaidModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-md">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <div>
                <CardTitle>Mark Courier Paid</CardTitle>
                <CardDescription className="mt-2">
                  Invois: <span className="font-semibold text-foreground">{invoice?.invoice_number}</span>
                </CardDescription>
                <CardDescription>
                  Shipment: <span className="font-semibold text-foreground">{shipment?.id || invoice?.shipment_id || '-'}</span>
                </CardDescription>
              </div>
              <button
                onClick={() => setShowCourierPaidModal(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <X className="h-5 w-5" />
              </button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Kos Courier (RM) *</label>
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={courierPaidCost}
                  onChange={(event) => {
                    setCourierPaidCost(event.target.value);
                    if (courierPaidCostError) {
                      setCourierPaidCostError('');
                    }
                  }}
                  onBlur={() => {
                    validateCourierPaidCostInput({ commitDisplay: true });
                  }}
                  className="h-10"
                />
                {courierPaidCostError && (
                  <p className="text-xs text-red-600">{courierPaidCostError}</p>
                )}
                <p className="text-xs text-gray-600">
                  Nilai ini akan ditolak dari dompet Business dan direkod sebagai expense.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Tarikh Bayaran *</label>
                <Input
                  type="datetime-local"
                  value={courierPaidDate}
                  onChange={(event) => {
                    setCourierPaidDate(event.target.value);
                    if (courierPaidDateError) {
                      setCourierPaidDateError('');
                    }
                  }}
                  onBlur={() => {
                    validateCourierPaidDateInput();
                  }}
                  className="h-10"
                />
                {courierPaidDateError && (
                  <p className="text-xs text-red-600">{courierPaidDateError}</p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Catatan (Pilihan)</label>
                <textarea
                  value={courierPaidNotes}
                  onChange={(event) => {
                    setCourierPaidNotes(event.target.value);
                    if (courierPaidNotesError) {
                      setCourierPaidNotesError('');
                    }
                  }}
                  onBlur={() => {
                    validateCourierPaidNotesInput({ normalize: true });
                  }}
                  maxLength={SHIPMENT_NOTES_MAX_LENGTH}
                  rows={3}
                  className="flex w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Contoh: Bayar di kaunter J&T"
                />
                {courierPaidNotesError && (
                  <p className="text-xs text-red-600">{courierPaidNotesError}</p>
                )}
              </div>
            </CardContent>
            <div className="flex justify-end gap-3 border-t p-4">
              <Button
                variant="outline"
                onClick={() => setShowCourierPaidModal(false)}
                disabled={isMarkingCourierPaid}
                className="h-10"
              >
                Batal
              </Button>
              <Button
                onClick={handleMarkCourierPaid}
                disabled={
                  isMarkingCourierPaid
                  || Boolean(courierPaidCostError)
                  || Boolean(courierPaidDateError)
                  || Boolean(courierPaidNotesError)
                  || courierPaidCost.trim() === ''
                  || courierPaidDate.trim() === ''
                }
                className="h-10"
              >
                {isMarkingCourierPaid ? 'Sedang Memproses...' : 'Sahkan Bayaran'}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};

export default InvoiceDetailsPage;

