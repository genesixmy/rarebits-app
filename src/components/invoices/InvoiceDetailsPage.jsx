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
  useProcessInvoiceReturn,
  useInvoiceShipment,
  useSaveInvoiceShipment,
  useUpdateInvoiceShipmentStatus,
  useUpdateInvoiceShippingCharged,
  useMarkShipmentCourierPaid,
} from '@/hooks/useInvoices';
import { useInvoiceSettings } from '@/hooks/useInvoiceSettings';
import { formatCurrency } from '@/lib/utils';
import {
  COURIER_PAYMENT_MODES,
  getCourierPaymentModeLabel,
  getShippingMethodLabel,
  isDeliveryRequiredForInvoice,
  resolveCourierPaymentModeForInvoice,
  resolveShippingMethodForInvoice,
  SHIPPING_METHODS,
} from '@/lib/shipping';
import {
  buildInvoiceWhatsAppMessage,
  getInvoiceExportFileName,
  getInvoiceFinancialSummary,
  getPrimaryClientPhone,
  getSellerCollectedShippingCharged,
  INVOICE_ADJUSTMENT_TYPES,
  normalizeAdjustmentType,
  normalizeWhatsAppPhone,
  resolveInvoiceAdjustmentType,
} from '@/lib/invoices/invoiceDetailUtils';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChevronLeft, Edit, Download, Trash2, DollarSign, AlertCircle, X, Send } from 'lucide-react';
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
const INVOICE_SHARE_BUCKET = 'item_images';
const INVOICE_SHARE_LINK_EXPIRES_SEC = 60 * 60 * 24 * 7;
const INVOICE_SHARE_SHORT_CODE_LENGTH = 12;

const sanitizeFileSegment = (value, fallback = 'invoice') => {
  const cleaned = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
};

const withDownloadQuery = (rawUrl, fileName) => {
  if (!rawUrl) return '';
  try {
    const url = new URL(rawUrl);
    url.searchParams.set('download', fileName);
    return url.toString();
  } catch (_error) {
    return rawUrl;
  }
};

const buildInvoiceShareStoragePath = (invoiceData, ownerUserId) => {
  const ownerId = normalizeOptionalText(ownerUserId) || 'unknown-user';
  const invoiceKey = sanitizeFileSegment(invoiceData?.id || invoiceData?.invoice_number, 'invoice');
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${ownerId}/invoice-shares/${invoiceKey}-${nonce}.png`;
};

const generateShortCode = (length = INVOICE_SHARE_SHORT_CODE_LENGTH) => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const max = alphabet.length;
  const bytes = new Uint8Array(length);

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += alphabet[bytes[i] % max];
  }
  return code;
};

const buildShortInvoiceShareUrl = (shortCode) => {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  if (!origin) return `/i/${shortCode}`;
  return `${origin}/i/${shortCode}`;
};

const withTimeout = async (promise, timeoutMs, timeoutMessage) => {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(timeoutMessage || 'Operasi melebihi masa menunggu.'));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
};

const getErrorMessage = (error) => {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  if (typeof error?.message === 'string' && error.message.trim()) return error.message.trim();
  if (typeof error?.error_description === 'string' && error.error_description.trim()) return error.error_description.trim();
  if (typeof error?.details === 'string' && error.details.trim()) return error.details.trim();
  try {
    return JSON.stringify(error);
  } catch (_error) {
    return String(error);
  }
};

const uploadInvoiceAttachmentAndGetSignedShare = async ({ invoiceData, invoiceBlob, fileName, actorUserId }) => {
  if (!normalizeOptionalText(actorUserId)) {
    throw new Error('User semasa tidak ditemui untuk upload invois.');
  }

  const storagePath = buildInvoiceShareStoragePath(invoiceData, actorUserId);
  const storage = supabase.storage.from(INVOICE_SHARE_BUCKET);
  const expiresAtIso = new Date(Date.now() + (INVOICE_SHARE_LINK_EXPIRES_SEC * 1000)).toISOString();

  const { error: uploadError } = await storage.upload(storagePath, invoiceBlob, {
    contentType: 'image/png',
    cacheControl: '60',
    upsert: false,
  });
  if (uploadError) throw new Error(`Upload invois gagal: ${getErrorMessage(uploadError)}`);

  const { data: signedData, error: signedError } = await storage.createSignedUrl(
    storagePath,
    INVOICE_SHARE_LINK_EXPIRES_SEC,
    { download: fileName }
  );

  if (signedError || !signedData?.signedUrl) {
    const { data: publicData } = storage.getPublicUrl(storagePath);
    if (publicData?.publicUrl) {
      return {
        signedUrl: withDownloadQuery(publicData.publicUrl, fileName),
        expiresAtIso,
      };
    }
    if (signedError) throw new Error(`Signed URL gagal: ${getErrorMessage(signedError)}`);
    throw new Error('Gagal jana link invois.');
  }

  return {
    signedUrl: signedData.signedUrl,
    expiresAtIso,
  };
};

const isDuplicateShortCodeError = (error) => {
  if (!error) return false;
  const message = String(error?.message || '').toLowerCase();
  return error?.code === '23505' || message.includes('duplicate key');
};

const createInvoiceShortShareLink = async ({ invoiceData, targetUrl, expiresAtIso, actorUserId }) => {
  const normalizedTargetUrl = normalizeOptionalText(targetUrl);
  if (!normalizedTargetUrl) {
    throw new Error('Link sasaran invois tidak sah.');
  }
  const ownerUserId = normalizeOptionalText(actorUserId);
  if (!ownerUserId) {
    throw new Error('User semasa tidak ditemui untuk short link.');
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const shortCode = generateShortCode();
    const payload = {
      short_code: shortCode,
      user_id: ownerUserId,
      invoice_id: invoiceData.id,
      target_url: normalizedTargetUrl,
      expires_at: expiresAtIso,
    };

    const { error } = await supabase.from('invoice_share_links').insert(payload);
    if (!error) {
      return buildShortInvoiceShareUrl(shortCode);
    }
    if (isDuplicateShortCodeError(error)) {
      continue;
    }
    throw new Error(`Short link insert gagal: ${getErrorMessage(error)}`);
  }

  throw new Error('Gagal jana short link invois.');
};

const downloadBlobFile = (blob, fileName) => {
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = fileName;
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
};

const openWhatsAppThread = ({ normalizedPhone, message, targetWindow = null }) => {
  const encodedText = encodeURIComponent(message);
  const primaryUrl = `https://wa.me/${normalizedPhone}?text=${encodedText}`;
  const fallbackUrl = `https://api.whatsapp.com/send?phone=${normalizedPhone}&text=${encodedText}`;

  const navigateTab = (tabRef, url) => {
    if (!tabRef || tabRef.closed) return false;
    try {
      tabRef.location.replace(url);
      return true;
    } catch (_error) {
      try {
        tabRef.location.href = url;
        return true;
      } catch (_error2) {
        return false;
      }
    }
  };

  if (targetWindow && !targetWindow.closed) {
    if (navigateTab(targetWindow, primaryUrl)) {
      return { opened: true, url: primaryUrl };
    }
    if (navigateTab(targetWindow, fallbackUrl)) {
      return { opened: true, url: fallbackUrl };
    }
    try {
      targetWindow.close();
    } catch (_error) {
      // noop
    }
  }

  const popup = window.open(primaryUrl, '_blank', 'noopener,noreferrer');
  if (!popup) {
    const fallbackPopup = window.open(fallbackUrl, '_blank', 'noopener,noreferrer');
    if (!fallbackPopup) return { opened: false, url: fallbackUrl };
    return { opened: true, url: fallbackUrl };
  }
  return { opened: true, url: primaryUrl };
};

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

  // Adjustment modal state
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [refundType, setRefundType] = useState('goodwill');
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refundNotes, setRefundNotes] = useState('');
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [selectedReturnItemId, setSelectedReturnItemId] = useState('');
  const [returnQuantity, setReturnQuantity] = useState('1');
  const [returnRefundAmount, setReturnRefundAmount] = useState('');
  const [returnReason, setReturnReason] = useState('');
  const [returnNotes, setReturnNotes] = useState('');
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
  const [showOptionalDeliveryCard, setShowOptionalDeliveryCard] = useState(false);
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
  const processInvoiceReturn = useProcessInvoiceReturn();
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
    setShowOptionalDeliveryCard(false);
  }, [invoiceId]);

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
    const currentCourierPaymentMode = resolveCourierPaymentModeForInvoice(invoice);
    const isPlatformMode = currentCourierPaymentMode === COURIER_PAYMENT_MODES.PLATFORM;
    const validated = validateShippingChargedInput({ commitDisplay: true });
    if (!validated.ok) {
      return false;
    }

    const nextShippingValue = isPlatformMode ? 0 : validated.value;
    if (isPlatformMode) {
      setShippingChargedInput('0.00');
      setShippingChargedError('');
    }

    const currentShipping = Math.max(parseFloat(invoice?.shipping_charged) || 0, 0);
    if (Math.abs(currentShipping - nextShippingValue) <= 0.0001) {
      return true;
    }

    try {
      await updateInvoiceShippingCharged.mutateAsync({
        invoiceId,
        shippingCharged: nextShippingValue,
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

  const handleSendInvoiceWhatsApp = async () => {
    if (!invoice) return;

    const rawPhone = getPrimaryClientPhone(invoice);
    const normalizedPhone = normalizeWhatsAppPhone(rawPhone);
    if (!normalizedPhone) {
      console.warn('[InvoiceDetailsPage] Invalid/missing client WhatsApp number', { rawPhone });
      toast.error('Nombor WhatsApp pelanggan tiada / tidak sah.');
      return;
    }

    const loadingToastId = toast.loading('Menyediakan WhatsApp...');
    const message = buildInvoiceWhatsAppMessage({ invoice, printSettings });
    const fileName = getInvoiceExportFileName(invoice);
    let actorUserId = '';
    try {
      const { data: sessionData } = await withTimeout(
        supabase.auth.getSession(),
        5000,
        'Timeout semasa semak sesi pengguna.'
      );
      actorUserId = normalizeOptionalText(sessionData?.session?.user?.id);
    } catch (authError) {
      console.warn('[InvoiceDetailsPage] Unable to resolve current auth session:', authError);
    }

    if (!actorUserId) {
      toast.dismiss(loadingToastId);
      toast.error('Sesi login tidak sah. Sila refresh dan log masuk semula.');
      return;
    }

    let invoiceBlob;
    try {
      toast.loading('Menjana lampiran invois...', { id: loadingToastId });
      invoiceBlob = await withTimeout(
        generateA4InvoiceBlob(),
        45000,
        'Timeout semasa menjana lampiran A4.'
      );
    } catch (exportError) {
      console.error('[InvoiceDetailsPage] Failed to generate A4 invoice attachment, fallback to thermal:', exportError);
      try {
        toast.loading('Lampiran A4 gagal, guna fallback...', { id: loadingToastId });
        invoiceBlob = await withTimeout(
          generateThermalInvoiceBlob({ showQrFallbackToast: false }),
          20000,
          'Timeout semasa menjana lampiran fallback.'
        );
      } catch (fallbackError) {
        console.error('[InvoiceDetailsPage] Failed to generate fallback attachment:', fallbackError);
        toast.dismiss(loadingToastId);
        toast.error('Gagal sediakan lampiran invois.');
        return;
      }
    }

    let shareFailureReason = '';
    try {
      toast.loading('Memuat naik invois dan menjana link...', { id: loadingToastId });
      const shareData = await withTimeout(
        uploadInvoiceAttachmentAndGetSignedShare({
          invoiceData: invoice,
          invoiceBlob,
          fileName,
          actorUserId,
        }),
        20000,
        'Timeout semasa memuat naik invois.'
      );

      let shareUrlToSend = shareData.signedUrl;
      try {
        shareUrlToSend = await withTimeout(
          createInvoiceShortShareLink({
            invoiceData: invoice,
            targetUrl: shareData.signedUrl,
            expiresAtIso: shareData.expiresAtIso,
            actorUserId,
          }),
          10000,
          'Timeout semasa menjana short link.'
        );
      } catch (shortLinkError) {
        console.warn('[InvoiceDetailsPage] Short link unavailable, using signed URL:', shortLinkError);
      }

      const messageWithLink = `${message}\n\nMuat turun invois:\n${shareUrlToSend}`;
      const openResult = openWhatsAppThread({
        normalizedPhone,
        message: messageWithLink,
      });
      if (!openResult.opened) {
        try {
          await navigator.clipboard.writeText(openResult.url);
          toast.dismiss(loadingToastId);
          toast.error('Popup disekat browser. Link WhatsApp disalin, sila buka tab baru dan paste.');
        } catch (_clipboardError) {
          toast.dismiss(loadingToastId);
          toast.error('Popup disekat browser. Benarkan popup untuk RareBits.');
        }
        return;
      }
      toast.dismiss(loadingToastId);
      toast.success('Link invois berjaya disediakan untuk WhatsApp.');
      return;
    } catch (shareError) {
      console.error('[InvoiceDetailsPage] Failed to create invoice share link, fallback to manual attachment:', shareError);
      shareFailureReason = getErrorMessage(shareError);
    }

    downloadBlobFile(invoiceBlob, fileName);
    const openResult = openWhatsAppThread({
      normalizedPhone,
      message,
    });
    if (!openResult.opened) {
      try {
        await navigator.clipboard.writeText(openResult.url);
        toast.dismiss(loadingToastId);
        toast.error('Popup disekat browser. Link WhatsApp disalin, sila buka tab baru dan paste.');
      } catch (_clipboardError) {
        toast.dismiss(loadingToastId);
        toast.error('Popup disekat browser. Benarkan popup untuk RareBits.');
      }
      return;
    }
    toast.dismiss(loadingToastId);
    toast.error(`Gagal jana link automatik (${shareFailureReason || 'unknown'}). Fail dimuat turun, sila attach manual dalam WhatsApp.`);
  };

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
    const footerNote = normalizeOptionalText(printSettings.footerNotes);
    const normalizedFooterNote = (footerNote && /polisi\s+kedai/i.test(footerNote))
      ? 'PRODUK DIJUAL ADALAH TERTAKLUK KEPADA POLISI PENIAGA.'
      : (footerNote || 'PRODUK DIJUAL ADALAH TERTAKLUK KEPADA POLISI PENIAGA.');
    const showGeneratedBy = printSettings.showGeneratedByA4;
    const showLogoA4 = Boolean(printSettings.showLogoA4 && !options.hideLogo);
    const a4QrDataUrl = normalizeOptionalText(options.qrDataUrl);
    const showQr = Boolean(printSettings.showQrA4 && a4QrDataUrl);

    const clientName = invoiceData.client?.name || '-';
    const clientEmail = invoiceData.client?.email || '';
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
    const invoiceStatusKey = String(invoiceData.status || '').toLowerCase();
    const invoiceStatusLabelMap = {
      draft: 'DRAF',
      finalized: 'MUKTAMAD',
      paid: 'DIBAYAR',
      partially_returned: 'SEPARA PULANG',
      returned: 'DIPULANGKAN',
      cancelled: 'DIBATALKAN',
    };
    const invoiceStatusClassMap = {
      draft: 'status-badge-gray',
      finalized: 'status-badge-blue',
      paid: 'status-badge-green',
      partially_returned: 'status-badge-amber',
      returned: 'status-badge-rose',
      cancelled: 'status-badge-red',
    };
    const invoiceStatusText = invoiceStatusLabelMap[invoiceStatusKey] || String(invoiceData.status || 'STATUS').toUpperCase();
    const invoiceStatusClass = invoiceStatusClassMap[invoiceStatusKey] || 'status-badge-gray';
    const shippingCharged = getSellerCollectedShippingCharged(invoiceData);
    const financialSummary = getInvoiceFinancialSummary(invoiceData);
    const showShippingLine = shippingCharged > 0;

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

    const icon = (paths) => `
      <svg class="line-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        ${paths}
      </svg>
    `;
    const iconMapPin = icon('<path d="M12 21s-6-5.3-6-10a6 6 0 1 1 12 0c0 4.7-6 10-6 10Z"></path><circle cx="12" cy="11" r="2.3"></circle>');
    const iconPhone = icon('<path d="M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 3 5.2 2 2 0 0 1 5 3h3a2 2 0 0 1 2 1.7c.1.8.3 1.6.6 2.3a2 2 0 0 1-.4 2.1L9 10.3a16 16 0 0 0 4.7 4.7l1.2-1.2a2 2 0 0 1 2.1-.4c.7.3 1.5.5 2.3.6A2 2 0 0 1 22 16.9Z"></path>');
    const iconMail = icon('<rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m3 7 9 6 9-6"></path>');
    const iconGlobe = icon('<circle cx="12" cy="12" r="9"></circle><path d="M3 12h18"></path><path d="M12 3a14.5 14.5 0 0 1 0 18"></path><path d="M12 3a14.5 14.5 0 0 0 0 18"></path>');
    const iconHash = icon('<path d="M9 3 7 21"></path><path d="M17 3 15 21"></path><path d="M4 9h16"></path><path d="M3 15h16"></path>');
    const iconCalendar = icon('<rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M16 3v4"></path><path d="M8 3v4"></path><path d="M3 10h18"></path>');
    const iconCreditCard = icon('<rect x="2" y="5" width="20" height="14" rx="2"></rect><path d="M2 10h20"></path>');

    return `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Invoice ${escapeHtml(invoiceData.invoice_number || '')}</title>
          <style>
            * { box-sizing: border-box; }
            @page { size: A4; margin: 12mm; }
            html, body {
              margin: 0;
              padding: 0;
              background: #fff;
              color: #0f172a;
              font-family: "Poppins", "Segoe UI", Arial, sans-serif;
              line-height: 1.45;
            }
            :root {
              --rb-primary: #0ea5b7;
              --rb-primary-dark: #0f8696;
              --rb-primary-soft: #eefbfc;
              --rb-ink: #0f172a;
              --rb-muted: #64748b;
              --rb-border: #d5e3e7;
              --rb-panel: #f8fcfd;
            }
            @media print {
              html, body {
                width: 210mm;
                min-height: auto;
                overflow: visible;
              }
              body {
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
              }
            }
            .invoice-doc {
              width: 100%;
              margin: 0;
              padding: 0;
            }
            .top-bar {
              height: 8px;
              background: var(--rb-primary-dark);
            }
            .header-shell {
              padding: 28px 24px 20px;
              background:
                radial-gradient(circle at 88% 12%, rgba(14,165,183,0.08), transparent 28%),
                radial-gradient(circle at 70% 8%, rgba(15,134,150,0.06), transparent 24%),
                #fff;
            }
            .header-brand {
              display: flex;
              align-items: center;
              gap: 12px;
            }
            .seller-logo {
              max-width: 52px;
              max-height: 52px;
              width: auto;
              height: auto;
              object-fit: contain;
              background: #fff;
            }
            .seller-logo-fallback {
              width: 52px;
              height: 52px;
              border: 2px solid #cfe8ec;
              border-radius: 8px;
              display: inline-flex;
              align-items: center;
              justify-content: center;
              font-size: 28px;
              font-weight: 800;
              color: var(--rb-primary-dark);
              background: #ffffff;
              line-height: 1;
            }
            .seller-details {
              display: flex;
              align-items: center;
              min-width: 0;
              min-height: 52px;
            }
            .seller-name {
              font-size: 22px;
              font-weight: 800;
              margin: 0;
              color: var(--rb-primary-dark);
              line-height: 1;
            }
            .header-divider {
              margin: 16px 0 18px;
              height: 2px;
              background: #cfe8ec;
            }
            .header-main {
              display: grid;
              grid-template-columns: 0.9fr 1.25fr;
              gap: 24px;
              align-items: stretch;
            }
            .invoice-to {
              padding-top: 22px;
              padding-right: 22px;
              border-right: 1px solid #d9ecef;
            }
            .invoice-to-title {
              margin: 0 0 10px;
              font-size: 11px;
              color: var(--rb-muted);
              font-weight: 600;
              display: inline-flex;
              align-items: center;
              gap: 5px;
              white-space: nowrap;
              line-height: 1.2;
            }
            .invoice-to-label {
              text-transform: uppercase;
              letter-spacing: 0.06em;
            }
            .invoice-to-buyer {
              font-size: 11px;
              font-weight: 700;
              color: var(--rb-ink);
              letter-spacing: 0;
              text-transform: none;
              line-height: 1.2;
            }
            .invoice-to-line {
              display: flex;
              align-items: flex-start;
              gap: 6px;
              margin: 8px 0;
              font-size: 11px;
              color: #334155;
              line-height: 1.35;
            }
            .invoice-to-line span {
              min-width: 0;
              word-break: break-word;
            }
            .invoice-right {
              min-width: 0;
              padding-left: 14px;
            }
            .invoice-title-row {
              display: flex;
              align-items: flex-end;
              gap: 18px;
            }
            .invoice-right h1 {
              margin: 0;
              font-size: 60px;
              letter-spacing: 1px;
              line-height: 0.95;
              color: var(--rb-primary-dark);
            }
            .invoice-status-badge {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              border-radius: 999px;
              padding: 4px 10px;
              margin-bottom: 14px;
              font-size: 10px;
              font-weight: 700;
              letter-spacing: 0.04em;
              text-transform: uppercase;
              border: 1px solid transparent;
              white-space: nowrap;
            }
            .status-badge-gray {
              color: #334155;
              background: #f1f5f9;
              border-color: #cbd5e1;
            }
            .status-badge-blue {
              color: #1e3a8a;
              background: #dbeafe;
              border-color: #93c5fd;
            }
            .status-badge-green {
              color: #065f46;
              background: #d1fae5;
              border-color: #86efac;
            }
            .status-badge-amber {
              color: #92400e;
              background: #fef3c7;
              border-color: #fcd34d;
            }
            .status-badge-rose {
              color: #9f1239;
              background: #ffe4e6;
              border-color: #fda4af;
            }
            .status-badge-red {
              color: #991b1b;
              background: #fee2e2;
              border-color: #fca5a5;
            }
            .quick-stats {
              margin-top: 18px;
              padding-top: 14px;
              border-top: 1px solid #d9ecef;
              display: flex;
              gap: 0;
            }
            .quick-stat {
              display: flex;
              align-items: flex-start;
              gap: 10px;
              min-width: 0;
              flex: 1;
              padding-right: 16px;
              margin-right: 16px;
              border-right: 1px solid #d9ecef;
            }
            .quick-stat:last-child {
              flex: 1.2;
            }
            .quick-stat:last-child {
              border-right: 0;
              margin-right: 0;
              padding-right: 0;
            }
            .quick-label {
              display: block;
              font-size: 9px;
              line-height: 1.2;
              color: var(--rb-muted);
              text-transform: uppercase;
              letter-spacing: 0.03em;
            }
            .quick-value {
              display: block;
              margin-top: 1px;
              font-size: 12px;
              line-height: 1.25;
              font-weight: 700;
              color: var(--rb-ink);
              word-break: break-word;
            }
            .quick-value-nowrap {
              white-space: nowrap;
              word-break: normal;
              font-size: 11px;
            }
            .line-icon {
              flex: 0 0 auto;
              width: 12px;
              height: 12px;
              margin-top: 2px;
              color: var(--rb-primary-dark);
            }
            table {
              width: 100%;
              border-collapse: collapse;
              table-layout: fixed;
            }
            .table-wrap {
              padding: 12px 16px 0;
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
              border-bottom: 0;
              font-size: 11px;
              text-transform: uppercase;
              letter-spacing: 0.06em;
              background: var(--rb-primary-dark);
              color: #fff;
            }
            td {
              padding: 10px;
              border-bottom: 1px solid #eaf1f4;
              vertical-align: top;
              font-size: 12px;
            }
            tbody tr:nth-child(even) td {
              background: #fbfdfe;
            }
            .item-cell {
              width: 46%;
              word-break: break-word;
            }
            .item-name {
              font-weight: 600;
            }
            .item-meta {
              margin-top: 2px;
              font-size: 11px;
              color: var(--rb-muted);
            }
            .num-cell {
              width: 18%;
              text-align: right;
              white-space: nowrap;
            }
            .empty-row {
              text-align: center;
              color: var(--rb-muted);
            }
            .totals-wrap {
              margin-top: 18px;
              display: flex;
              justify-content: flex-end;
              padding: 0 16px 14px;
            }
            .totals-box {
              width: 320px;
              border: 1px solid var(--rb-border);
              border-radius: 10px;
              padding: 10px 12px;
              background: var(--rb-panel);
            }
            .totals-row {
              display: flex;
              justify-content: space-between;
              gap: 12px;
              margin: 6px 0;
              font-size: 12px;
              color: #334155;
            }
            .totals-row.total {
              margin-top: 8px;
              padding-top: 8px;
              border-top: 1px solid #c8d9de;
              font-size: 15px;
              font-weight: 700;
              color: var(--rb-primary-dark);
            }
            .qr-wrap {
              margin-top: 2px;
              display: flex;
              justify-content: flex-end;
              padding: 0 16px 10px;
            }
            .qr-box {
              width: 150px;
              text-align: center;
              border: 1px solid var(--rb-border);
              border-radius: 10px;
              background: #fff;
              padding: 9px 8px 8px;
            }
            .qr-image {
              width: 110px;
              height: 110px;
              object-fit: contain;
              display: block;
              margin: 0 auto 6px;
            }
            .qr-label {
              font-size: 10px;
              color: var(--rb-muted);
              line-height: 1.3;
            }
            .footer {
              margin-top: 6px;
              border-top: 1px solid var(--rb-border);
              padding: 0 16px 14px;
              font-size: 11px;
              color: #475569;
              background: #fff;
            }
            .footer-terms {
              margin: 0;
              padding: 7px 0;
              border-bottom: 2px solid #d9ecef;
              font-size: 10px;
              color: var(--rb-muted);
            }
            .footer-inner {
              display: flex;
              justify-content: space-between;
              align-items: flex-end;
              gap: 18px;
              padding-top: 12px;
            }
            .footer-left {
              min-width: 0;
            }
            .footer-thanks {
              margin: 0 0 8px 0;
              font-size: 14px;
              font-weight: 500;
              color: #334155;
            }
            .footer-company {
              margin: 0 0 8px 0;
              font-size: 12px;
              font-weight: 700;
              color: #0f172a;
            }
            .company-contact-line {
              display: flex;
              align-items: flex-start;
              gap: 6px;
              margin: 3px 0;
              font-size: 11px;
              color: #475569;
            }
            .company-contact-line span {
              min-width: 0;
              word-break: break-word;
            }
            .footer-empty {
              min-width: 180px;
            }
            .notes {
              white-space: pre-wrap;
              margin: 0;
              padding: 10px 0 4px;
            }
            .generated-by {
              margin-top: 10px;
              font-size: 11px;
              color: var(--rb-muted);
            }
          </style>
        </head>
        <body>
          <main class="invoice-doc">
            <div class="top-bar"></div>
            <section class="header-shell">
              <div class="header-brand">
                ${showLogoA4
                  ? `<img class="seller-logo" src="${escapeHtml(printSettings.logoUrl)}" alt="Logo" />`
                  : '<div class="seller-logo-fallback">R</div>'}
                <div class="seller-details">
                  <p class="seller-name">${escapeHtml(sellerName)}</p>
                </div>
              </div>
              <div class="header-divider"></div>
              <div class="header-main">
                <div class="invoice-to">
                  <p class="invoice-to-title">
                    ${iconMapPin}
                    <span class="invoice-to-label">INVOIS KEPADA:</span>
                    <span class="invoice-to-buyer">${escapeHtml(clientName)}</span>
                  </p>
                  ${clientAddress ? `<p class="invoice-to-line">${iconMapPin}<span>${escapeHtml(clientAddress)}</span></p>` : ''}
                  ${clientEmail ? `<p class="invoice-to-line">${iconMail}<span>${escapeHtml(clientEmail)}</span></p>` : ''}
                  ${clientPhone ? `<p class="invoice-to-line">${iconPhone}<span>${escapeHtml(clientPhone)}</span></p>` : ''}
                </div>
                <div class="invoice-right">
                  <div class="invoice-title-row">
                    <h1>INVOICE</h1>
                    <span class="invoice-status-badge ${invoiceStatusClass}">${escapeHtml(invoiceStatusText)}</span>
                  </div>
                  <div class="quick-stats">
                    <div class="quick-stat">
                      ${iconCreditCard}
                      <div>
                        <span class="quick-label">JUMLAH</span>
                        <span class="quick-value">${escapeHtml(formatCurrency(financialSummary.finalTotal || 0))}</span>
                      </div>
                    </div>
                    <div class="quick-stat">
                      ${iconCalendar}
                      <div>
                        <span class="quick-label">TARIKH INVOIS</span>
                        <span class="quick-value">${escapeHtml(invoiceDateLabel)}</span>
                      </div>
                    </div>
                    <div class="quick-stat">
                      ${iconHash}
                      <div>
                        <span class="quick-label">NO INVOIS</span>
                        <span class="quick-value quick-value-nowrap">${escapeHtml(invoiceData.invoice_number || '-')}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th style="text-align:right;">KUANTITI</th>
                    <th style="text-align:right;">PER UNIT</th>
                    <th style="text-align:right;">HARGA</th>
                  </tr>
                </thead>
                <tbody>
                  ${safeItemRows}
                </tbody>
              </table>
            </section>

            <section class="totals-wrap">
              <div class="totals-box">
                ${showShippingLine ? `
                  <div class="totals-row">
                    <span>Caj Pos</span>
                    <span>${escapeHtml(formatCurrency(shippingCharged))}</span>
                  </div>
                ` : ''}
                ${financialSummary.adjustmentTotal > 0 ? `
                  <div class="totals-row">
                    <span>Refund (Goodwill)</span>
                    <span>- ${escapeHtml(formatCurrency(financialSummary.adjustmentTotal))}</span>
                  </div>
                ` : ''}
                ${financialSummary.returnedTotal > 0 ? `
                  <div class="totals-row">
                    <span>Return/Cancel</span>
                    <span>- ${escapeHtml(formatCurrency(financialSummary.returnedTotal))}</span>
                  </div>
                ` : ''}
                <div class="totals-row total">
                  <span>JUMLAH</span>
                  <span>${escapeHtml(formatCurrency(financialSummary.finalTotal || 0))}</span>
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
              <p class="footer-terms"><strong>TERMA & SYARAT:</strong> ${escapeHtml(normalizedFooterNote)}</p>
              <div class="footer-inner">
                <div class="footer-left">
                  <p class="footer-thanks">Terima Kasih Mempercayai Kami</p>
                  <p class="footer-company">${escapeHtml(sellerName)}</p>
                  ${sellerAddress ? `<p class="company-contact-line">${iconMapPin}<span>${escapeHtml(sellerAddress)}</span></p>` : ''}
                  ${sellerPhone ? `<p class="company-contact-line">${iconPhone}<span>${escapeHtml(sellerPhone)}</span></p>` : ''}
                  ${sellerEmail ? `<p class="company-contact-line">${iconMail}<span>${escapeHtml(sellerEmail)}</span></p>` : ''}
                  ${sellerWebsite ? `<p class="company-contact-line">${iconGlobe}<span>${escapeHtml(sellerWebsite)}</span></p>` : ''}
                  ${sellerFax ? `<p class="company-contact-line">${iconCreditCard}<span>Faks: ${escapeHtml(sellerFax)}</span></p>` : ''}
                </div>
                <div class="footer-empty"></div>
              </div>
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

  const generateA4InvoiceBlob = async () => {
    if (!invoice) {
      throw new Error('Invois tidak dijumpai.');
    }

    const a4Width = 1240;
    const marginX = 56;
    const contentWidth = a4Width - (marginX * 2);
    const primary = '#0ea5b7';
    const primaryDark = '#0f8696';
    const ink = '#0f172a';
    const muted = '#64748b';
    const border = '#d5e3e7';
    const panel = '#f8fcfd';
    const sellerName = printSettings.companyName || 'RareBits';
    const sellerAddress = normalizeOptionalText(printSettings.address);
    const sellerPhone = normalizeOptionalText(printSettings.phone);
    const sellerEmail = normalizeOptionalText(printSettings.email);
    const sellerWebsite = normalizeOptionalText(printSettings.website);
    const sellerFax = normalizeOptionalText(printSettings.fax);
    const showLogoA4 = Boolean(printSettings.showLogoA4 && printSettings.logoUrl);

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

    const clientName = invoice.client?.name || '-';
    const clientEmail = invoice.client?.email || '';
    const clientPhone = (invoice.client?.client_phones || [])
      .map((phone) => phone?.phone_number)
      .filter(Boolean)
      .join(', ');
    const clientAddress = (invoice.client?.client_addresses || [])
      .map((address) => address?.address)
      .filter(Boolean)
      .join(' | ');
    const invoiceDateLabel = invoice.invoice_date
      ? format(new Date(invoice.invoice_date), 'dd MMM yyyy', { locale: ms })
      : '-';
    const invoiceStatusKey = String(invoice.status || '').toLowerCase();
    const invoiceStatusLabelMap = {
      draft: 'DRAF',
      finalized: 'MUKTAMAD',
      paid: 'DIBAYAR',
      partially_returned: 'SEPARA PULANG',
      returned: 'DIPULANGKAN',
      cancelled: 'DIBATALKAN',
    };
    const invoiceStatusThemeMap = {
      draft: { bg: '#f1f5f9', border: '#cbd5e1', text: '#334155' },
      finalized: { bg: '#dbeafe', border: '#93c5fd', text: '#1e3a8a' },
      paid: { bg: '#d1fae5', border: '#86efac', text: '#065f46' },
      partially_returned: { bg: '#fef3c7', border: '#fcd34d', text: '#92400e' },
      returned: { bg: '#ffe4e6', border: '#fda4af', text: '#9f1239' },
      cancelled: { bg: '#fee2e2', border: '#fca5a5', text: '#991b1b' },
    };
    const invoiceStatusText = invoiceStatusLabelMap[invoiceStatusKey] || String(invoice.status || 'STATUS').toUpperCase();
    const invoiceStatusTheme = invoiceStatusThemeMap[invoiceStatusKey] || invoiceStatusThemeMap.draft;
    const shippingCharged = getSellerCollectedShippingCharged(invoice);
    const financialSummary = getInvoiceFinancialSummary(invoice);
    const showShippingLine = shippingCharged > 0;

    const rows = (invoice.invoice_items || []).map((item) => {
      const name = item.is_manual ? item.item_name : item.item?.name;
      const category = item.is_manual ? 'Item Manual' : item.item?.category;
      return {
        name: name || 'Item',
        category: category || '',
        qty: item.quantity || 1,
        unitPrice: item.unit_price || 0,
        lineTotal: item.line_total || 0,
      };
    });

    const headerMainH = 332;
    const footerContactLines = [sellerAddress, sellerPhone, sellerEmail, sellerWebsite, sellerFax].filter(Boolean).length;
    const footerBlockH = 132 + (footerContactLines * 18);

    let y = 0;
    y += 18; // top bar
    y += 16;
    y += headerMainH; // header + invoice to
    y += 18;
    y += 52; // table header
    y += Math.max(rows.length, 1) * 72;
    y += 18;
    y += 124; // totals

    let qrDataUrl = '';
    if (printSettings.showQrA4) {
      qrDataUrl = await getQrDataUrl(printSettings.qrUrl, 180);
      if (qrDataUrl) y += 180;
    }

    if (invoice.notes) y += 56;
    y += footerBlockH;

    // Keep A4 export height aligned with print page size.
    const finalHeight = Math.max(y, 1754);
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = a4Width * scale;
    canvas.height = finalHeight * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas context tidak tersedia');
    }
    ctx.scale(scale, scale);

    const drawWrappedText = ({ text, x, y: startY, maxWidth, lineHeight, font, color = ink, align = 'left', maxLines = 999 }) => {
      const safeText = String(text || '').trim();
      if (!safeText) return startY;
      ctx.save();
      ctx.font = font;
      ctx.fillStyle = color;
      ctx.textAlign = align;
      ctx.textBaseline = 'top';
      const words = safeText.split(/\s+/);
      const lines = [];
      let current = '';
      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (ctx.measureText(candidate).width <= maxWidth || !current) {
          current = candidate;
        } else {
          lines.push(current);
          current = word;
          if (lines.length >= maxLines) break;
        }
      }
      if (current && lines.length < maxLines) lines.push(current);
      let yy = startY;
      for (const line of lines) {
        ctx.fillText(line, x, yy);
        yy += lineHeight;
      }
      ctx.restore();
      return yy;
    };

    const drawMiniIcon = ({ icon, x, y, color = primaryDark }) => {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1.4;
      if (icon === 'map') {
        ctx.beginPath();
        ctx.arc(x + 4, y + 4, 3.8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x + 4, y + 4, 1.2, 0, Math.PI * 2);
        ctx.fill();
      } else if (icon === 'mail') {
        ctx.strokeRect(x, y, 9, 7);
        ctx.beginPath();
        ctx.moveTo(x, y + 1);
        ctx.lineTo(x + 4.5, y + 4);
        ctx.lineTo(x + 9, y + 1);
        ctx.stroke();
      } else if (icon === 'phone') {
        ctx.beginPath();
        ctx.arc(x + 3.2, y + 3.2, 2.2, Math.PI * 0.2, Math.PI * 1.1);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x + 5.4, y + 5.2);
        ctx.lineTo(x + 8.2, y + 8);
        ctx.stroke();
      } else if (icon === 'globe') {
        ctx.beginPath();
        ctx.arc(x + 4.5, y + 4.2, 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x + 0.5, y + 4.2);
        ctx.lineTo(x + 8.5, y + 4.2);
        ctx.stroke();
      } else if (icon === 'card') {
        ctx.strokeRect(x, y + 0.5, 9, 6.5);
        ctx.beginPath();
        ctx.moveTo(x, y + 2.6);
        ctx.lineTo(x + 9, y + 2.6);
        ctx.stroke();
      }
      ctx.restore();
    };

    const drawIconTextLine = ({ icon, text, x, y, maxWidth, font = '400 14px Arial', color = '#334155', lineHeight = 18, maxLines = 1 }) => {
      drawMiniIcon({ icon, x, y: y + 3, color: primaryDark });
      return drawWrappedText({
        text,
        x: x + 16,
        y,
        maxWidth: Math.max(maxWidth - 16, 20),
        lineHeight,
        font,
        color,
        maxLines,
      });
    };

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, a4Width, finalHeight);

    // top bar
    ctx.fillStyle = primaryDark;
    ctx.fillRect(0, 0, a4Width, 18);

        // header block (closer to reference sample)
    const headerY = 34;
    const headerBottomY = headerY + headerMainH;
    const brandY = headerY + 20;

    // subtle map-like backdrop
    ctx.fillStyle = '#f8fcfd';
    ctx.fillRect(marginX, headerY, contentWidth, headerMainH);
    ctx.fillStyle = 'rgba(14,165,183,0.06)';
    ctx.beginPath();
    ctx.arc(marginX + contentWidth - 190, headerY + 28, 76, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(15,134,150,0.05)';
    ctx.beginPath();
    ctx.arc(marginX + contentWidth - 84, headerY + 36, 52, 0, Math.PI * 2);
    ctx.fill();

    let brandTextX = marginX;
    if (showLogoA4) {
      try {
        const logoImage = await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error('Logo image load failed'));
          img.src = printSettings.logoUrl;
        });
        ctx.drawImage(logoImage, marginX, brandY + 2, 54, 54);
        brandTextX = marginX + 64;
      } catch (error) {
        console.warn('[InvoiceDetailsPage] A4 logo render skipped:', error);
      }
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#cfe8ec';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect?.(marginX, brandY + 2, 54, 54, 8);
      if (ctx.roundRect) {
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillRect(marginX, brandY + 2, 54, 54);
        ctx.strokeRect(marginX, brandY + 2, 54, 54);
      }
      drawWrappedText({
        text: 'R',
        x: marginX + 27,
        y: brandY + 10,
        maxWidth: 54,
        lineHeight: 32,
        font: '800 34px Arial',
        color: primaryDark,
        align: 'center',
        maxLines: 1,
      });
      brandTextX = marginX + 64;
    }

    drawWrappedText({
      text: sellerName,
      x: brandTextX,
      y: brandY + 20,
      maxWidth: contentWidth * 0.55,
      lineHeight: 28,
      font: '800 36px Arial',
      color: primaryDark,
      maxLines: 1,
    });
    const dividerY = headerY + 112;
    ctx.strokeStyle = '#cfe8ec';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(marginX, dividerY);
    ctx.lineTo(marginX + contentWidth, dividerY);
    ctx.stroke();

    const leftColW = Math.floor(contentWidth * 0.42);
    const rightColX = marginX + leftColW + 16;
    const rightColW = contentWidth - leftColW - 16;
    const leftInfoTopY = dividerY + 34;
    const rightInfoTopY = dividerY + 26;

    // simple map-pin icon for "INVOICE TO" row
    const invoiceToIconX = marginX + 7;
    const invoiceToIconY = leftInfoTopY + 8;
    ctx.strokeStyle = primaryDark;
    ctx.fillStyle = primaryDark;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(invoiceToIconX, invoiceToIconY, 4.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(invoiceToIconX, invoiceToIconY, 1.2, 0, Math.PI * 2);
    ctx.fill();

    const invoiceToLabel = 'INVOIS KEPADA:';
    ctx.save();
    ctx.font = '600 11px Arial';
    const invoiceToLabelWidth = ctx.measureText(invoiceToLabel).width;
    ctx.restore();
    drawWrappedText({
      text: invoiceToLabel,
      x: marginX + 18,
      y: leftInfoTopY,
      maxWidth: leftColW - 10,
      lineHeight: 16,
      font: '600 11px Arial',
      color: muted,
      maxLines: 1,
    });
    drawWrappedText({
      text: clientName,
      x: marginX + 18 + invoiceToLabelWidth + 6,
      y: leftInfoTopY,
      maxWidth: leftColW - 20 - invoiceToLabelWidth,
      lineHeight: 16,
      font: '700 11px Arial',
      color: ink,
      maxLines: 1,
    });
    let clientY = leftInfoTopY + 36;
    if (clientAddress) {
      clientY = drawIconTextLine({
        icon: 'map',
        text: clientAddress,
        x: marginX,
        y: clientY,
        maxWidth: leftColW - 8,
        font: '400 14px Arial',
        color: '#334155',
        lineHeight: 18,
        maxLines: 2,
      });
    }
    if (clientEmail) {
      clientY = drawIconTextLine({
        icon: 'mail',
        text: clientEmail,
        x: marginX,
        y: clientY + 2,
        maxWidth: leftColW - 8,
        font: '400 14px Arial',
        color: '#334155',
        lineHeight: 18,
        maxLines: 1,
      });
    }
    if (clientPhone) {
      drawIconTextLine({
        icon: 'phone',
        text: clientPhone,
        x: marginX,
        y: clientY + 2,
        maxWidth: leftColW - 8,
        font: '400 14px Arial',
        color: '#334155',
        lineHeight: 18,
        maxLines: 1,
      });
    }

    ctx.strokeStyle = '#cfe8ec';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(rightColX - 8, rightInfoTopY + 6);
    ctx.lineTo(rightColX - 8, headerBottomY - 16);
    ctx.stroke();

    drawWrappedText({
      text: 'INVOICE',
      x: rightColX,
      y: rightInfoTopY - 2,
      maxWidth: rightColW,
      lineHeight: 54,
      font: '800 60px Arial',
      color: primaryDark,
      maxLines: 1,
    });

    // status badge beside "INVOICE"
    ctx.save();
    ctx.font = '700 11px Arial';
    const badgeW = Math.max(96, ctx.measureText(invoiceStatusText).width + 18);
    const badgeH = 22;
    const badgeX = rightColX + rightColW - badgeW;
    const badgeY = rightInfoTopY + 30;
    ctx.fillStyle = invoiceStatusTheme.bg;
    ctx.strokeStyle = invoiceStatusTheme.border;
    ctx.lineWidth = 1;
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 999);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
      ctx.strokeRect(badgeX, badgeY, badgeW, badgeH);
    }
    ctx.fillStyle = invoiceStatusTheme.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(invoiceStatusText, badgeX + (badgeW / 2), badgeY + (badgeH / 2));
    ctx.restore();

    const statY = rightInfoTopY + 108;
    const statW = Math.floor((rightColW - 24) / 3);
    const drawStat = (index, label, value) => {
      const sx = rightColX + (index * (statW + 10));
      drawWrappedText({
        text: label,
        x: sx,
        y: statY,
        maxWidth: index === 2 ? statW + 36 : statW,
        lineHeight: 15,
        font: '600 11px Arial',
        color: muted,
        maxLines: 1,
      });
      drawWrappedText({
        text: value || '-',
        x: sx,
        y: statY + 13,
        maxWidth: index === 2 ? statW + 36 : statW,
        lineHeight: 20,
        font: '700 16px Arial',
        color: ink,
        maxLines: 1,
      });
      if (index < 2) {
        const sxEnd = sx + statW + 6;
        ctx.strokeStyle = '#d9ecef';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sxEnd, statY);
        ctx.lineTo(sxEnd, statY + 34);
        ctx.stroke();
      }
    };
    drawStat(0, 'JUMLAH', formatCurrency(financialSummary.finalTotal || 0));
    drawStat(1, 'TARIKH INVOIS', invoiceDateLabel);
    drawStat(2, 'NO INVOIS', invoice.invoice_number || '-');

    // table
    const tableY = headerBottomY + 24;
    const colX = [
      marginX,
      marginX + Math.floor(contentWidth * 0.5),
      marginX + Math.floor(contentWidth * 0.62),
      marginX + Math.floor(contentWidth * 0.79),
      marginX + contentWidth,
    ];
    ctx.fillStyle = primaryDark;
    ctx.fillRect(marginX, tableY, contentWidth, 52);
    const headerLabels = ['ITEM', 'KUANTITI', 'PER UNIT', 'HARGA'];
    headerLabels.forEach((label, idx) => {
      const left = colX[idx] + 12;
      const right = colX[idx + 1] - 12;
      const align = idx === 0 ? 'left' : 'right';
      drawWrappedText({
        text: label,
        x: align === 'left' ? left : right,
        y: tableY + 14,
        maxWidth: right - left,
        lineHeight: 20,
        font: '700 17px Arial',
        color: '#ffffff',
        align,
        maxLines: 1,
      });
    });

    let rowY = tableY + 52;
    if (rows.length === 0) {
      ctx.strokeStyle = border;
      ctx.strokeRect(marginX, rowY, contentWidth, 72);
      drawWrappedText({
        text: 'Tiada item dalam invois.',
        x: marginX + (contentWidth / 2),
        y: rowY + 24,
        maxWidth: contentWidth - 24,
        lineHeight: 24,
        font: '500 19px Arial',
        color: muted,
        align: 'center',
      });
      rowY += 72;
    } else {
      rows.forEach((row, idx) => {
        ctx.fillStyle = idx % 2 === 0 ? '#ffffff' : '#fbfdfe';
        ctx.fillRect(marginX, rowY, contentWidth, 72);
        ctx.strokeStyle = '#eaf1f4';
        ctx.strokeRect(marginX, rowY, contentWidth, 72);

        const itemNameY = drawWrappedText({
          text: row.name,
          x: colX[0] + 12,
          y: rowY + 10,
          maxWidth: colX[1] - colX[0] - 24,
          lineHeight: 22,
          font: '700 18px Arial',
          color: ink,
          maxLines: 1,
        });
        if (row.category) {
          drawWrappedText({
            text: row.category,
            x: colX[0] + 12,
            y: itemNameY + 2,
            maxWidth: colX[1] - colX[0] - 24,
            lineHeight: 20,
            font: '400 16px Arial',
            color: muted,
            maxLines: 1,
          });
        }
        drawWrappedText({
          text: String(row.qty),
          x: colX[2] - 12,
          y: rowY + 22,
          maxWidth: colX[2] - colX[1] - 24,
          lineHeight: 20,
          font: '600 18px Arial',
          color: ink,
          align: 'right',
          maxLines: 1,
        });
        drawWrappedText({
          text: formatCurrency(row.unitPrice),
          x: colX[3] - 12,
          y: rowY + 22,
          maxWidth: colX[3] - colX[2] - 24,
          lineHeight: 20,
          font: '600 18px Arial',
          color: ink,
          align: 'right',
          maxLines: 1,
        });
        drawWrappedText({
          text: formatCurrency(row.lineTotal),
          x: colX[4] - 12,
          y: rowY + 22,
          maxWidth: colX[4] - colX[3] - 24,
          lineHeight: 20,
          font: '700 18px Arial',
          color: ink,
          align: 'right',
          maxLines: 1,
        });
        rowY += 72;
      });
    }

    // totals box
    const totalsY = rowY + 18;
    const totalsW = 390;
    const totalsX = marginX + contentWidth - totalsW;
    const totalLines = [
      showShippingLine,
      financialSummary.adjustmentTotal > 0,
      financialSummary.returnedTotal > 0,
    ].filter(Boolean).length;
    const totalsBoxH = 34 + (totalLines * 28) + 42;
    ctx.fillStyle = panel;
    ctx.strokeStyle = border;
    ctx.strokeRect(totalsX, totalsY, totalsW, totalsBoxH);
    ctx.fillRect(totalsX + 1, totalsY + 1, totalsW - 2, totalsBoxH - 2);
    let ty = totalsY + 16;
    const drawTotalRow = (label, value, isGrand = false) => {
      drawWrappedText({
        text: label,
        x: totalsX + 16,
        y: ty,
        maxWidth: totalsW - 32,
        lineHeight: 24,
        font: isGrand ? '700 22px Arial' : '500 18px Arial',
        color: isGrand ? primaryDark : ink,
        maxLines: 1,
      });
      drawWrappedText({
        text: value,
        x: totalsX + totalsW - 16,
        y: ty,
        maxWidth: totalsW - 32,
        lineHeight: 24,
        font: isGrand ? '700 22px Arial' : '600 18px Arial',
        color: isGrand ? primaryDark : ink,
        align: 'right',
        maxLines: 1,
      });
      ty += isGrand ? 34 : 28;
    };

    if (showShippingLine) drawTotalRow('Caj Pos', formatCurrency(shippingCharged));
    if (financialSummary.adjustmentTotal > 0) drawTotalRow('Refund (Goodwill)', `- ${formatCurrency(financialSummary.adjustmentTotal)}`);
    if (financialSummary.returnedTotal > 0) drawTotalRow('Return/Cancel', `- ${formatCurrency(financialSummary.returnedTotal)}`);
    drawTotalRow('JUMLAH', formatCurrency(financialSummary.finalTotal || 0), true);

    // QR
    if (qrDataUrl) {
      try {
        const qrImage = await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error('QR image load failed'));
          img.src = qrDataUrl;
        });
        const qrSize = 150;
        const qrX = marginX + contentWidth - qrSize;
        const qrY = totalsY + 170;
        ctx.drawImage(qrImage, qrX, qrY, qrSize, qrSize);
        drawWrappedText({
          text: printSettings.qrLabel,
          x: qrX + (qrSize / 2),
          y: qrY + qrSize + 8,
          maxWidth: qrSize,
          lineHeight: 18,
          font: '500 14px Arial',
          color: muted,
          align: 'center',
          maxLines: 2,
        });
      } catch (error) {
        console.warn('[InvoiceDetailsPage] A4 QR render skipped:', error);
      }
    }

    // footer
    const footerStartY = finalHeight - footerBlockH;
    const footerTermsRaw = normalizeOptionalText(printSettings.footerNotes);
    const footerTerms = (footerTermsRaw && /polisi\s+kedai/i.test(footerTermsRaw))
      ? 'PRODUK DIJUAL ADALAH TERTAKLUK KEPADA POLISI PENIAGA.'
      : (footerTermsRaw || 'PRODUK DIJUAL ADALAH TERTAKLUK KEPADA POLISI PENIAGA.');

    if (invoice.notes) {
      drawWrappedText({
        text: `Nota: ${invoice.notes}`,
        x: marginX,
        y: footerStartY - 34,
        maxWidth: contentWidth,
        lineHeight: 20,
        font: '400 16px Arial',
        color: muted,
        maxLines: 2,
      });
    }

    ctx.strokeStyle = border;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(marginX, footerStartY);
    ctx.lineTo(marginX + contentWidth, footerStartY);
    ctx.stroke();

    drawWrappedText({
      text: `TERMA & SYARAT: ${footerTerms}`,
      x: marginX,
      y: footerStartY + 10,
      maxWidth: contentWidth,
      lineHeight: 17,
      font: '400 13px Arial',
      color: muted,
      maxLines: 2,
    });

    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(marginX, footerStartY + 36);
    ctx.lineTo(marginX + contentWidth, footerStartY + 36);
    ctx.stroke();

    const leftFooterX = marginX;
    const leftFooterMaxW = contentWidth - 280;
    const innerFooterY = footerStartY + 52;
    drawWrappedText({
      text: 'Terima Kasih Mempercayai Kami',
      x: leftFooterX,
      y: innerFooterY,
      maxWidth: leftFooterMaxW,
      lineHeight: 24,
      font: '500 21px Arial',
      color: '#334155',
      maxLines: 1,
    });
    drawWrappedText({
      text: sellerName,
      x: leftFooterX,
      y: innerFooterY + 22,
      maxWidth: leftFooterMaxW,
      lineHeight: 22,
      font: '700 16px Arial',
      color: '#0f172a',
      maxLines: 1,
    });

    const footerLines = [
      sellerAddress ? { icon: 'map', text: sellerAddress } : null,
      sellerPhone ? { icon: 'phone', text: sellerPhone } : null,
      sellerEmail ? { icon: 'mail', text: sellerEmail } : null,
      sellerWebsite ? { icon: 'globe', text: sellerWebsite } : null,
      sellerFax ? { icon: 'card', text: `Faks: ${sellerFax}` } : null,
    ].filter(Boolean);

    let contactY = innerFooterY + 46;
    footerLines.forEach((line) => {
      contactY = drawIconTextLine({
        icon: line.icon,
        text: line.text,
        x: leftFooterX,
        y: contactY,
        maxWidth: leftFooterMaxW,
        font: '400 14px Arial',
        color: muted,
        lineHeight: 18,
        maxLines: 2,
      });
    });

    return await canvasToBlob(canvas);
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
    const shippingCharged = getSellerCollectedShippingCharged(invoiceData);
    const financialSummary = getInvoiceFinancialSummary(invoiceData);
    const showShippingLine = shippingCharged > 0;

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
              ${showShippingLine ? `<div class="row"><span>Caj Pos</span><span>${escapeHtml(formatCurrency(shippingCharged))}</span></div>` : ''}
              ${financialSummary.adjustmentTotal > 0 ? `<div class="row"><span>Refund (Goodwill)</span><span>- ${escapeHtml(formatCurrency(financialSummary.adjustmentTotal))}</span></div>` : ''}
              ${financialSummary.returnedTotal > 0 ? `<div class="row"><span>Return/Cancel</span><span>- ${escapeHtml(formatCurrency(financialSummary.returnedTotal))}</span></div>` : ''}
              <div class="row grand"><span>Jumlah</span><span>${escapeHtml(formatCurrency(financialSummary.finalTotal || 0))}</span></div>
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
    const shippingCharged = getSellerCollectedShippingCharged(invoiceData);
    const financialSummary = getInvoiceFinancialSummary(invoiceData);
    const showShippingLine = shippingCharged > 0;

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
          ${showShippingLine ? `<div class="row"><span>Caj Pos</span><span>${escapeHtml(formatCurrency(shippingCharged))}</span></div>` : ''}
          ${financialSummary.adjustmentTotal > 0 ? `<div class="row"><span>Refund (Goodwill)</span><span>- ${escapeHtml(formatCurrency(financialSummary.adjustmentTotal))}</span></div>` : ''}
          ${financialSummary.returnedTotal > 0 ? `<div class="row"><span>Return/Cancel</span><span>- ${escapeHtml(formatCurrency(financialSummary.returnedTotal))}</span></div>` : ''}
          <div class="row grand"><span>Jumlah</span><span>${escapeHtml(formatCurrency(financialSummary.finalTotal || 0))}</span></div>
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

  const generateThermalInvoiceBlob = async ({ showQrFallbackToast = true } = {}) => {
    if (!invoice) {
      throw new Error('Invois tidak dijumpai.');
    }

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

    const isTaintedCanvasError = (error) => {
      if (!error) return false;
      const message = String(error?.message || '').toLowerCase();
      return error?.name === 'SecurityError' || message.includes('tainted canvases');
    };

    const canvasToBlob = async (canvas) => {
      if (canvas.toBlob) {
        try {
          const blob = await new Promise((resolve, reject) => {
            try {
              canvas.toBlob((result) => resolve(result), 'image/png');
            } catch (error) {
              reject(error);
            }
          });
          if (blob) return blob;
        } catch (error) {
          throw error;
        }
      }

      try {
        return dataUrlToBlob(canvas.toDataURL('image/png'));
      } catch (error) {
        throw error;
      }
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
      const shippingCharged = getSellerCollectedShippingCharged(invoice);
      const financialSummary = getInvoiceFinancialSummary(invoice);
      if (shippingCharged > 0) {
        addRow('Caj Pos', formatCurrency(shippingCharged));
      }
      if (financialSummary.adjustmentTotal > 0) {
        addRow('Refund (Goodwill)', `- ${formatCurrency(financialSummary.adjustmentTotal)}`);
      }
      if (financialSummary.returnedTotal > 0) {
        addRow('Return/Cancel', `- ${formatCurrency(financialSummary.returnedTotal)}`);
      }
      addRow('Jumlah', formatCurrency(financialSummary.finalTotal || 0), { size: 27, weight: 700, lineHeight: 36 });

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

    const buildFallbackMobileBlob = async (triggerError) => {
      console.error('[InvoiceDetailsPage] Export fallback to safe mobile renderer:', triggerError);
      if (showQrFallbackToast) {
        toast.error('Imej luaran tidak dapat diexport automatik. Sistem guna mod fallback.');
      }
      let qrDataUrl = '';
      if (printSettings.showQrPaperang) {
        qrDataUrl = await getQrDataUrl(printSettings.qrUrl, 256);
      }
      return await buildMobileExportBlob(qrDataUrl);
    };

    if (isMobile) {
      let qrDataUrl = '';
      if (printSettings.showQrPaperang) {
        qrDataUrl = await getQrDataUrl(printSettings.qrUrl, 256);
      }
      return await buildMobileExportBlob(qrDataUrl);
    }

    let qrSvgMarkup = '';
    if (printSettings.showQrPaperang) {
      qrSvgMarkup = await getQrSvgMarkup(printSettings.qrUrl, 256);
    }

    try {
      return await buildExportBlob(qrSvgMarkup);
    } catch (error) {
      if (isTaintedCanvasError(error)) {
        return await buildFallbackMobileBlob(error);
      }

      if (!qrSvgMarkup) throw error;
      console.error('[InvoiceDetailsPage] Paperang export with QR failed, retrying without QR:', error);
      if (showQrFallbackToast) {
        toast.error('QR gagal dirender untuk Paperang. Export diteruskan tanpa QR.');
      }

      try {
        return await buildExportBlob('');
      } catch (retryError) {
        if (isTaintedCanvasError(retryError)) {
          return await buildFallbackMobileBlob(retryError);
        }
        throw retryError;
      }
    }
  };

  const handleExportThermal = async () => {
    if (!invoice) return;

    const isMobile = typeof navigator !== 'undefined'
      ? /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '')
      : false;

    try {
      const blob = await generateThermalInvoiceBlob({ showQrFallbackToast: true });
      const fileName = getInvoiceExportFileName(invoice);

      if (isMobile) {
        const canShareFile = typeof navigator !== 'undefined'
          && typeof navigator.share === 'function'
          && typeof File !== 'undefined';

        if (canShareFile) {
          const mobileFile = new File([blob], fileName, { type: 'image/png' });
          const canSharePayload = typeof navigator.canShare !== 'function'
            || navigator.canShare({ files: [mobileFile] });

          if (canSharePayload) {
            try {
              await navigator.share({
                files: [mobileFile],
                title: invoice.invoice_number || 'Resit',
                text: 'Resit untuk dicetak',
              });
              return;
            } catch (error) {
              if (error?.name === 'AbortError') return;
              console.error('[InvoiceDetailsPage] Mobile share failed, fallback to download:', error);
            }
          }
        }

        downloadBlobFile(blob, fileName);
        return;
      }

      const canShareOnDesktop = typeof navigator !== 'undefined'
        && typeof navigator.share === 'function'
        && typeof File !== 'undefined';

      if (canShareOnDesktop) {
        const file = new File([blob], fileName, { type: 'image/png' });
        const canSharePayload = typeof navigator.canShare !== 'function'
          || navigator.canShare({ files: [file] });

        if (canSharePayload) {
          try {
            await navigator.share({
              files: [file],
              title: invoice.invoice_number || 'Resit',
              text: 'Resit untuk dicetak',
            });
            return;
          } catch (error) {
            if (error?.name === 'AbortError') return;
            console.error('[InvoiceDetailsPage] Share file failed:', error);
          }
        }
      }

      downloadBlobFile(blob, fileName);
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
      if (!deliveryRequired) {
        toast.error('Penghantaran tidak diperlukan untuk invois ini.');
        return;
      }

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
      if (!deliveryRequired) {
        toast.error('Penghantaran tidak diperlukan untuk invois ini.');
        return;
      }

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
      const currentCourierPaymentMode = resolveCourierPaymentModeForInvoice(invoice);
      if (currentCourierPaymentMode === COURIER_PAYMENT_MODES.PLATFORM) {
        toast.error('Mode platform: bayaran courier tidak direkodkan di wallet.');
        return;
      }

      if (!deliveryRequired) {
        toast.error('Penghantaran tidak diperlukan untuk invois ini.');
        return;
      }

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
      const normalizedRefundType = normalizeAdjustmentType(refundType);
      const currentFinalTotal = getInvoiceFinancialSummary(invoice).finalTotal;
      if (!amount || amount <= 0) {
        toast.error('Amaun pelarasan mestilah lebih besar dari 0');
        return;
      }
      if (!normalizedRefundType) {
        toast.error('Jenis adjustment wajib dipilih.');
        return;
      }
      if (!INVOICE_ADJUSTMENT_TYPES.includes(normalizedRefundType)) {
        toast.error('Jenis adjustment tidak sah.');
        return;
      }
      if (normalizedRefundType === 'return') {
        toast.error('Jenis return sila guna proses pulangan item.');
        return;
      }

      if (amount > currentFinalTotal) {
        toast.error(`Amaun pelarasan tidak boleh melebihi RM${currentFinalTotal.toFixed(2)}`);
        return;
      }

      await processRefund.mutateAsync({
        invoiceId,
        refundAmount: amount,
        reason: refundReason?.trim() || '',
        notes: refundNotes || '',
        adjustmentType: normalizedRefundType,
      });

      toast.success('Invois telah diselaraskan');
      closeRefundModal();
    } catch (error) {
      console.error('[InvoiceDetailsPage] Error processing refund:', error);
      toast.error('Ralat: ' + (error.message || 'Gagal memproses pelarasan'));
    }
  };

  const closeRefundModal = () => {
    setShowRefundModal(false);
    setRefundType('goodwill');
    setRefundAmount('');
    setRefundReason('');
    setRefundNotes('');
  };

  const openReturnModal = () => {
    if (returnableItems.length === 0) {
      toast.error('Tiada item yang boleh dipulangkan');
      return;
    }

    const firstItem = returnableItems[0];
    setSelectedReturnItemId(firstItem.invoiceItemId);
    setReturnQuantity('1');
    setReturnRefundAmount((firstItem.unitPrice || 0).toFixed(2));
    setReturnReason('');
    setReturnNotes('');
    setShowReturnModal(true);
  };

  const handleReturnItemChange = (invoiceItemId) => {
    setSelectedReturnItemId(invoiceItemId);
    const nextItem = returnableItems.find((entry) => entry.invoiceItemId === invoiceItemId);
    if (!nextItem) return;
    setReturnQuantity('1');
    setReturnRefundAmount((nextItem.unitPrice || 0).toFixed(2));
  };

  const handleReturnQuantityChange = (rawValue) => {
    const selectedItem = selectedReturnItem;
    if (!selectedItem) {
      setReturnQuantity(rawValue);
      return;
    }

    const parsed = parseInt(rawValue, 10);
    if (Number.isNaN(parsed)) {
      setReturnQuantity('');
      setReturnRefundAmount('');
      return;
    }

    const clamped = Math.min(Math.max(parsed, 1), selectedItem.maxReturnQty);
    setReturnQuantity(String(clamped));
    setReturnRefundAmount((selectedItem.unitPrice * clamped).toFixed(2));
  };

  const handleProcessReturn = async () => {
    try {
      if (!selectedReturnItem) {
        toast.error('Pilih item untuk dipulangkan');
        return;
      }

      const quantity = parseInt(returnQuantity, 10);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        toast.error('Kuantiti pulangan tidak sah');
        return;
      }

      if (quantity > selectedReturnItem.maxReturnQty) {
        toast.error(`Kuantiti pulangan maksimum ${selectedReturnItem.maxReturnQty}`);
        return;
      }

      const amount = parseFloat(returnRefundAmount);
      if (!Number.isFinite(amount) || amount <= 0) {
        toast.error('Amaun pulangan tidak sah');
        return;
      }

      if (amount > financialSummary.finalTotal) {
        toast.error(`Amaun pulangan tidak boleh melebihi RM${financialSummary.finalTotal.toFixed(2)}`);
        return;
      }

      await processInvoiceReturn.mutateAsync({
        invoiceId,
        invoiceItemId: selectedReturnItem.invoiceItemId,
        returnQuantity: quantity,
        refundAmount: amount,
        reason: returnReason?.trim() || '',
        notes: returnNotes || '',
      });

      toast.success('Invois telah diselaraskan');
      setShowReturnModal(false);
      setSelectedReturnItemId('');
      setReturnQuantity('1');
      setReturnRefundAmount('');
      setReturnReason('');
      setReturnNotes('');
    } catch (error) {
      console.error('[InvoiceDetailsPage] Error processing return:', error);
      toast.error('Ralat: ' + (error.message || 'Gagal memproses pulangan'));
    }
  };

  const getStatusBadgeColor = (status) => {
    const statusColors = {
      draft: 'bg-gray-100 text-gray-800',
      finalized: 'bg-blue-100 text-blue-800',
      paid: 'bg-green-100 text-green-800',
      partially_returned: 'bg-amber-100 text-amber-800',
      returned: 'bg-rose-100 text-rose-800',
      cancelled: 'bg-red-100 text-red-800',
    };
    return statusColors[status] || 'bg-gray-100 text-gray-800';
  };

  const getStatusLabel = (status) => {
    const labels = {
      draft: 'Draf',
      finalized: 'Muktamad',
      paid: 'Dibayar',
      partially_returned: 'Separa Pulang',
      returned: 'Dipulangkan',
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

  const resolvedCourierPaymentMode = resolveCourierPaymentModeForInvoice(invoice);
  const courierPaymentModeLabel = getCourierPaymentModeLabel(resolvedCourierPaymentMode);
  const isPlatformCourierMode = resolvedCourierPaymentMode === COURIER_PAYMENT_MODES.PLATFORM;
  const shippingChargedAmount = isPlatformCourierMode
    ? 0
    : Math.max(parseFloat(invoice.shipping_charged) || 0, 0);
  const resolvedShippingMethod = resolveShippingMethodForInvoice(invoice);
  const shippingMethodLabel = getShippingMethodLabel(resolvedShippingMethod);
  const deliveryRequired = isDeliveryRequiredForInvoice(invoice);
  const isSettledInvoice = ['paid', 'partially_returned', 'returned'].includes(invoice.status);
  const shipmentStatus = deliveryRequired ? (shipment?.ship_status || 'pending') : 'not_required';
  const deliveryActionsDisabled = !isSettledInvoice;
  const isSavingDelivery = saveInvoiceShipment.isPending || updateInvoiceShipmentStatus.isPending;
  const isSavingShippingCharged = updateInvoiceShippingCharged.isPending;
  const hasCourierPaid = isPlatformCourierMode ? true : Boolean(shipment?.courier_paid);
  const hasShipmentRecord = Boolean(shipment?.id || invoice?.shipment_id);
  const canShowCourierPaidAction = deliveryRequired && isSettledInvoice && hasShipmentRecord && !isPlatformCourierMode;
  const shouldShowDeliveryCard = deliveryRequired || showOptionalDeliveryCard;
  const courierPayAllowedByStatus = ['pending', 'shipped', 'delivered'].includes(shipmentStatus);
  const canMarkCourierPaid = canShowCourierPaidAction && courierPayAllowedByStatus && !hasCourierPaid;
  const isMarkingCourierPaid = markShipmentCourierPaid.isPending;
  const shippingCostValue = isPlatformCourierMode ? 0 : Math.max(parseFloat(shipment?.shipping_cost) || 0, 0);
  const isShippingCostRecorded = isPlatformCourierMode
    ? true
    : Boolean(shipment && (shipment.courier_paid || shippingCostValue > 0));
  const shippingProfitValue = shippingChargedAmount - shippingCostValue;
  const channelFeeAmount = Math.max(parseFloat(invoice.channel_fee_amount) || 0, 0);
  const invoiceFeeLines = Array.isArray(invoice?.invoice_fees)
    ? [...invoice.invoice_fees].sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0))
    : [];
  const invoiceFeeRows = invoiceFeeLines.map((fee) => {
    const autoAmount = Math.max(parseFloat(fee?.amount) || 0, 0);
    const overrideRaw = parseFloat(fee?.amount_override);
    const hasOverride = Number.isFinite(overrideRaw) && overrideRaw >= 0;
    const manualAmount = hasOverride ? overrideRaw : null;
    return {
      ...fee,
      auto_amount: autoAmount,
      amount_override: manualAmount,
      effective_amount: hasOverride ? manualAmount : autoAmount,
      is_overridden: hasOverride,
    };
  });
  const invoiceFeeTotal = invoiceFeeLines.length > 0
    ? invoiceFeeRows.reduce((sum, fee) => sum + Math.max(parseFloat(fee?.effective_amount) || 0, 0), 0)
    : channelFeeAmount;
  const financialSummary = getInvoiceFinancialSummary(invoice);
  const netAfterChannelFee = financialSummary.finalTotal - invoiceFeeTotal;
  const hasTrackingNumber = normalizeWhitespaceText(shipment?.tracking_no || deliveryForm.trackingNo || '').length > 0;
  const invoiceRefunds = Array.isArray(invoice?.invoice_refunds)
    ? [...invoice.invoice_refunds].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    : [];
  const goodwillRefundHistory = invoiceRefunds.filter((entry) => {
    const adjustmentType = resolveInvoiceAdjustmentType(entry);
    return adjustmentType === 'goodwill' || adjustmentType === 'cancel' || adjustmentType === 'correction';
  });
  const legacyGoodwillRefundHistory = Array.isArray(invoice?.refunds)
    ? [...invoice.refunds].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    : [];
  const goodwillLegacyRefundIds = new Set(
    goodwillRefundHistory
      .map((entry) => entry?.legacy_refund_id)
      .filter(Boolean)
  );
  const combinedGoodwillRefundHistory = [
    ...goodwillRefundHistory,
    ...legacyGoodwillRefundHistory.filter((entry) => !goodwillLegacyRefundIds.has(entry.id)),
  ].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  const invoiceItemReturns = Array.isArray(invoice?.invoice_item_returns) ? invoice.invoice_item_returns : [];
  const returnedQtyByInvoiceItemId = invoiceItemReturns.reduce((acc, entry) => {
    const key = entry?.invoice_item_id;
    if (!key) return acc;
    const qty = parseInt(entry?.returned_quantity, 10);
    acc[key] = (acc[key] || 0) + (Number.isNaN(qty) ? 0 : Math.max(qty, 0));
    return acc;
  }, {});
  const returnableItems = (invoice?.invoice_items || [])
    .filter((item) => item?.item_id)
    .map((item) => {
      const soldQty = Math.max(parseInt(item?.quantity, 10) || 0, 0);
      const returnedQty = Math.max(returnedQtyByInvoiceItemId[item.id] || 0, 0);
      const maxReturnQty = Math.max(soldQty - returnedQty, 0);
      const itemLabel = item.item?.name || item.item_name || 'Item';
      const unitPrice = Math.max(parseFloat(item?.unit_price) || 0, 0);
      return {
        invoiceItemId: item.id,
        itemId: item.item_id,
        itemLabel,
        unitPrice,
        soldQty,
        returnedQty,
        maxReturnQty,
      };
    })
    .filter((entry) => entry.maxReturnQty > 0);
  const selectedReturnItem = returnableItems.find((entry) => entry.invoiceItemId === selectedReturnItemId) || null;
  const canAdjustInvoice = ['paid', 'partially_returned'].includes(invoice.status) && financialSummary.finalTotal > 0;
  const canProcessReturn = canAdjustInvoice && returnableItems.length > 0;

  return (
    <div className="space-y-6 overflow-x-hidden p-4 sm:p-6">
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
            <div className="mt-2">
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  resolvedShippingMethod === SHIPPING_METHODS.COURIER
                    ? 'bg-indigo-100 text-indigo-700'
                    : 'bg-slate-100 text-slate-700'
                }`}
              >
                {shippingMethodLabel}
              </span>
            </div>
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
            onClick={handleSendInvoiceWhatsApp}
            className="gap-2 flex-1 sm:flex-initial h-10"
          >
            <Send className="h-5 w-5" />
            Send WhatsApp
          </Button>
          <Button
            variant="outline"
            size="default"
            onClick={() => navigate(`/invoices/${invoiceId}/edit`)}
            disabled={isSettledInvoice}
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

          {canAdjustInvoice && (
            <>
              <Button
                variant="outline"
                size="default"
                onClick={() => {
                  setRefundType('goodwill');
                  setShowRefundModal(true);
                }}
                disabled={processRefund.isPending}
                className="gap-2 flex-1 sm:flex-initial h-10"
              >
                <DollarSign className="h-5 w-5" />
                Adjust Price
              </Button>
              <Button
                variant="outline"
                size="default"
                onClick={openReturnModal}
                disabled={processInvoiceReturn.isPending || !canProcessReturn}
                className="gap-2 flex-1 sm:flex-initial h-10"
              >
                Return Item
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
            disabled={isSettledInvoice}
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
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-sm font-medium text-gray-600">Nama</p>
                  <p className="break-words text-base font-semibold sm:text-lg">{invoice.client?.name}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-600">Email</p>
                  <p className="break-all text-base sm:text-lg">{invoice.client?.email || '-'}</p>
                </div>
              </div>

              {invoice.client?.client_phones?.[0] && (
                <div>
                  <p className="text-sm font-medium text-gray-600">Telefon</p>
                  <p className="break-all text-base sm:text-lg">
                    {invoice.client.client_phones.map((p) => p.phone_number).join(', ')}
                  </p>
                </div>
              )}

              {invoice.client?.client_addresses?.[0] && (
                <div>
                  <p className="text-sm font-medium text-gray-600">Alamat</p>
                  <p className="break-words text-base leading-relaxed sm:text-lg">
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
                  <span>Platform Jualan:</span>
                  <span className="font-medium">
                    {invoice.platform || 'Manual'}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Subtotal:</span>
                  <span className="font-medium">
                    {formatCurrency(invoice.subtotal)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Caj Platform (tolak untung):</span>
                  <span className="font-medium">
                    - {formatCurrency(invoiceFeeTotal)}
                  </span>
                </div>
                {invoiceFeeRows.length > 0 && (
                  <div className="space-y-1 rounded-lg bg-muted/40 p-2 text-xs text-muted-foreground">
                    {invoiceFeeRows.map((fee) => (
                      <div key={fee.id || `${fee.name}-${fee.created_at}`} className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <span className="truncate">{fee.name}</span>
                          {fee.is_overridden && (
                            <span className="ml-2 inline-flex rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                              Manual
                            </span>
                          )}
                          {fee.is_overridden && (
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                              Auto {formatCurrency(fee.auto_amount)} -> Manual {formatCurrency(fee.amount_override)}
                            </p>
                          )}
                        </div>
                        <span className="font-medium text-foreground">- {formatCurrency(fee.effective_amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {!isPlatformCourierMode && (
                  <div className="flex justify-between text-sm">
                    <span>Caj Pos Dikutip:</span>
                    <span className="font-medium">
                      {formatCurrency(invoice.shipping_charged || 0)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span>Original Amount:</span>
                  <span className="font-medium">
                    {formatCurrency(financialSummary.originalTotal)}
                  </span>
                </div>
                {financialSummary.adjustmentTotal > 0 && (
                  <div className="flex justify-between text-sm text-red-600">
                    <span>Refund (Goodwill):</span>
                    <span className="font-medium">
                      - {formatCurrency(financialSummary.adjustmentTotal)}
                    </span>
                  </div>
                )}
                {financialSummary.returnedTotal > 0 && (
                  <div className="flex justify-between text-sm text-rose-600">
                    <span>Return/Cancel:</span>
                    <span className="font-medium">
                      - {formatCurrency(financialSummary.returnedTotal)}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex justify-between text-xl font-bold">
                <span>Final Paid:</span>
                <span>{formatCurrency(financialSummary.finalTotal)}</span>
              </div>
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Bersih Selepas Caj Platform:</span>
                <span className="font-medium">{formatCurrency(netAfterChannelFee)}</span>
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

              {isSettledInvoice && (
                <>
                  <div className={`rounded-lg border p-3 ${
                    invoice.status === 'returned'
                      ? 'border-rose-200 bg-rose-50'
                      : invoice.status === 'partially_returned'
                        ? 'border-amber-200 bg-amber-50'
                        : 'border-green-200 bg-green-50'
                  }`}>
                    <p className={`text-sm font-medium ${
                      invoice.status === 'returned'
                        ? 'text-rose-800'
                        : invoice.status === 'partially_returned'
                          ? 'text-amber-800'
                          : 'text-green-800'
                    }`}>
                      {invoice.status === 'returned'
                        ? 'Invois Dipulangkan Penuh'
                        : invoice.status === 'partially_returned'
                          ? 'Invois Separa Pulang'
                          : 'Invois Telah Dibayar'}
                    </p>
                    <p className={`mt-1 text-xs ${
                      invoice.status === 'returned'
                        ? 'text-rose-700'
                        : invoice.status === 'partially_returned'
                          ? 'text-amber-700'
                          : 'text-green-700'
                    }`}>
                      {invoice.status === 'returned'
                        ? 'Pulangan penuh direkod. Stok telah dipulangkan.'
                        : invoice.status === 'partially_returned'
                          ? 'Pulangan separa direkod. Baki jualan masih aktif.'
                          : 'Dompet dan rekod pelanggan telah diperbarui.'}
                    </p>
                  </div>

                  {/* Goodwill refund history */}
                  {combinedGoodwillRefundHistory.length > 0 && (
                    <div className="space-y-2 mt-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-red-700 dark:text-red-300">
                        Sejarah Refund Goodwill
                      </p>
                      {combinedGoodwillRefundHistory.map((refund) => (
                        <div key={refund.id} className="flex items-start justify-between p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900">
                          <div className="flex-1">
                            <p className="font-semibold text-red-700 dark:text-red-300">RM {parseFloat(refund.amount).toFixed(2)}</p>
                            <p className="text-sm text-red-600 dark:text-red-400 mt-0.5">{refund.reason || 'Refund (Goodwill)'}</p>
                            {(refund.note || refund.notes) && <p className="text-xs text-red-500 dark:text-red-400 mt-1">Catatan: {refund.note || refund.notes}</p>}
                            <p className="text-xs text-red-500 dark:text-red-600 mt-1">{new Date(refund.created_at).toLocaleDateString()} - {new Date(refund.created_at).toLocaleTimeString()}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {invoiceItemReturns.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300">
                        Sejarah Return Item
                      </p>
                      {invoiceItemReturns.map((entry) => (
                        <div key={entry.id} className="flex items-start justify-between rounded-lg border border-rose-200 bg-rose-50 p-3 dark:border-rose-900 dark:bg-rose-950/30">
                          <div className="flex-1">
                            <p className="font-semibold text-rose-700 dark:text-rose-300">
                              {(parseInt(entry.returned_quantity, 10) || 0)} unit - RM {(parseFloat(entry.refund_amount) || 0).toFixed(2)}
                            </p>
                            <p className="mt-0.5 text-sm text-rose-600 dark:text-rose-400">
                              {entry.return_item_name || 'Item Returned'}
                            </p>
                            <p className="mt-1 text-xs text-rose-500 dark:text-rose-400">
                              {entry.reason || 'Item Returned'}
                            </p>
                            {entry.notes && <p className="mt-1 text-xs text-rose-500 dark:text-rose-400">Catatan: {entry.notes}</p>}
                            <p className="mt-1 text-xs text-rose-500 dark:text-rose-600">
                              {new Date(entry.created_at).toLocaleDateString()} - {new Date(entry.created_at).toLocaleTimeString()}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {!shouldShowDeliveryCard && (
            <Card className="mt-6">
              <CardHeader>
                <CardTitle>Delivery</CardTitle>
                <CardDescription>
                  Penghantaran tidak diperlukan (Walk-in/Pickup).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  Invois ini tidak memerlukan penghantaran.
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowOptionalDeliveryCard(true)}
                >
                  Lihat Butiran Delivery
                </Button>
              </CardContent>
            </Card>
          )}

          {shouldShowDeliveryCard && (
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

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-medium text-slate-600">Bayaran Penghantaran</p>
                <p className="mt-1 text-sm font-medium text-slate-900">{courierPaymentModeLabel}</p>
                {isPlatformCourierMode ? (
                  <p className="mt-1 text-xs text-blue-700">
                    Platform urus bayaran courier. Tiada caj pos/rekod expense wallet.
                  </p>
                ) : null}
              </div>

              {!isPlatformCourierMode && (
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
                    disabled={isSettledInvoice || isSavingShippingCharged}
                    className="h-10"
                  />
                  {shippingChargedError && (
                    <p className="mt-1 text-xs text-red-600">{shippingChargedError}</p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-gray-500">
                      Kos pos yang dibayar pelanggan. Biar kosong untuk auto 0.
                    </p>
                    {!isSettledInvoice && (
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
              )}

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
                  {isPlatformCourierMode
                    ? 'Mode platform: bayaran courier diurus platform.'
                    : 'Courier telah dibayar. Kos courier dikunci dan tidak boleh diubah.'}
                </p>
              )}
              {isPlatformCourierMode && (
                <p className="text-xs text-blue-700">
                  Mark Courier Paid dinyahaktifkan kerana platform yang urus bayaran penghantaran.
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
          )}
        </div>
      </div>

      {/* Return Modal */}
      {showReturnModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-md">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <div>
                <CardTitle>Return Item</CardTitle>
                <CardDescription className="mt-2">
                  Invois: <span className="font-semibold text-foreground">{invoice?.invoice_number}</span>
                </CardDescription>
                <CardDescription>
                  Baki Final Paid: <span className="font-semibold text-foreground">{formatCurrency(financialSummary.finalTotal || 0)}</span>
                </CardDescription>
              </div>
              <button
                onClick={() => setShowReturnModal(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <X className="h-5 w-5" />
              </button>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
                <div className="text-sm text-amber-800">
                  <p className="font-medium">Pulangan Item Fizikal</p>
                  <p className="mt-1">
                    Aliran ini akan tambah semula stok, tolak hasil invois dan rekod keluar duit dari dompet.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Item Dipulangkan *</label>
                <select
                  value={selectedReturnItemId}
                  onChange={(event) => handleReturnItemChange(event.target.value)}
                  className="flex h-10 w-full items-center justify-between rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {returnableItems.length === 0 ? (
                    <option value="">Tiada item boleh dipulangkan</option>
                  ) : (
                    returnableItems.map((entry) => (
                      <option key={entry.invoiceItemId} value={entry.invoiceItemId}>
                        {entry.itemLabel} (Baki: {entry.maxReturnQty} unit)
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Kuantiti Return *</label>
                  <Input
                    type="number"
                    min="1"
                    max={selectedReturnItem?.maxReturnQty || 1}
                    value={returnQuantity}
                    onChange={(event) => handleReturnQuantityChange(event.target.value)}
                    className="h-10"
                  />
                  <p className="text-xs text-gray-600">
                    Maksimum: {selectedReturnItem?.maxReturnQty || 0} unit
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Amaun Refund (RM) *</label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max={financialSummary.finalTotal || 0}
                    value={returnRefundAmount}
                    onChange={(event) => setReturnRefundAmount(event.target.value)}
                    className="h-10"
                  />
                  <p className="text-xs text-gray-600">
                    Maksimum: RM{(financialSummary.finalTotal || 0).toFixed(2)}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Sebab Return (Pilihan)</label>
                <select
                  value={returnReason}
                  onChange={(event) => setReturnReason(event.target.value)}
                  className="flex h-10 w-full items-center justify-between rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Pilih sebab return (opsyenal)</option>
                  <option value="Customer Return">Pemulangan Pelanggan</option>
                  <option value="Defect Return">Return Barang Rosak</option>
                  <option value="Cancel Order">Batal Order</option>
                  <option value="Other">Lain-lain</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Catatan (Pilihan)</label>
                <Input
                  placeholder="Masukkan catatan return..."
                  value={returnNotes}
                  onChange={(event) => setReturnNotes(event.target.value)}
                  className="h-10"
                />
              </div>
            </CardContent>

            <div className="flex justify-end gap-3 border-t p-4">
              <Button
                variant="outline"
                onClick={() => setShowReturnModal(false)}
                disabled={processInvoiceReturn.isPending}
                className="h-10"
              >
                Batal
              </Button>
              <Button
                onClick={handleProcessReturn}
                disabled={processInvoiceReturn.isPending || !selectedReturnItem || !returnQuantity || !returnRefundAmount}
                className="h-10 bg-rose-600 hover:bg-rose-700"
              >
                {processInvoiceReturn.isPending ? 'Sedang Memproses...' : 'Process Return'}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Adjustment Modal */}
      {showRefundModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <div>
                <CardTitle>Adjust Price</CardTitle>
                <CardDescription className="mt-2">
                  Invois: <span className="font-semibold text-foreground">{invoice?.invoice_number}</span>
                </CardDescription>
                <CardDescription>
                  Final Paid: <span className="font-semibold text-foreground">{formatCurrency(financialSummary.finalTotal || 0)}</span>
                </CardDescription>
              </div>
              <button
                onClick={closeRefundModal}
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
                  <p className="font-medium">Maklumat Pelarasan</p>
                  <p className="mt-1">Pelarasan harga akan mengurangkan hasil invois dan baki dompet. Amaun mestilah {'<='} RM{financialSummary.finalTotal.toFixed(2)}</p>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Jenis Adjustment *</label>
                <select
                  value={refundType}
                  onChange={(e) => setRefundType(e.target.value)}
                  className="flex h-10 w-full items-center justify-between rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="goodwill">Goodwill (Gerak Budi / Diskaun)</option>
                  <option value="correction">Correction (Pembetulan)</option>
                  <option value="cancel">Cancel (Pembatalan)</option>
                  <option value="return" disabled>Return (guna butang Return Item)</option>
                </select>
                <p className="text-xs text-gray-600">
                  Jenis adjustment wajib dipilih sebelum simpan.
                </p>
              </div>

              {/* Adjustment Amount */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Amaun Pelarasan (RM) *</label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max={financialSummary.finalTotal || 0}
                  placeholder="0.00"
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                  className="h-10"
                />
                <p className="text-xs text-gray-600">
                  Maksimum: RM{financialSummary.finalTotal.toFixed(2)}
                </p>
              </div>

              {/* Adjustment Reason */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Sebab Pelarasan (Pilihan)</label>
                <select
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  className="flex h-10 w-full items-center justify-between rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Pilih sebab pelarasan (opsyenal)</option>
                  <option value="Price Correction">Pembetulan Harga</option>
                  <option value="Courtesy">Gerak Budi / Diskaun</option>
                  <option value="Defect Compensation">Kompensasi Kerosakan</option>
                  <option value="Shipping Compensation">Kompensasi Penghantaran</option>
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
                onClick={closeRefundModal}
                disabled={processRefund.isPending}
                className="h-10"
              >
                Batal
              </Button>
              <Button
                onClick={handleProcessRefund}
                disabled={processRefund.isPending || !refundAmount || !refundType}
                className="bg-amber-600 hover:bg-amber-700 h-10"
              >
                {processRefund.isPending ? 'Sedang Memproses...' : 'Simpan Pelarasan'}
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

