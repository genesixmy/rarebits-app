export const SHIPPING_METHODS = Object.freeze({
  WALK_IN: 'walk_in',
  COURIER: 'courier',
});

export const COURIER_PAYMENT_MODES = Object.freeze({
  SELLER: 'seller',
  PLATFORM: 'platform',
});

const DELIVERY_METHODS = new Set(['courier', 'post', 'delivery', 'prepaid', 'cod']);
const NON_DELIVERY_METHODS = new Set(['walk_in', 'walkin', 'pickup', 'meetup', 'selfpickup']);

export const normalizeShippingMethod = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_');
};

const toNonNegativeNumber = (value) => {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(parsed, 0);
};

export const isDeliveryRequired = ({ shippingMethod, shippingCharged }) => {
  const charged = toNonNegativeNumber(shippingCharged);
  if (charged > 0) return true;

  const normalizedMethod = normalizeShippingMethod(shippingMethod);
  if (!normalizedMethod) return false;
  if (DELIVERY_METHODS.has(normalizedMethod)) return true;
  if (NON_DELIVERY_METHODS.has(normalizedMethod)) return false;

  return false;
};

export const isDeliveryRequiredForInvoice = (invoice) => (
  isDeliveryRequired({
    shippingMethod: invoice?.shipping_method,
    shippingCharged: invoice?.shipping_charged,
  })
);

export const resolveShippingMethodForInvoice = (invoice) => {
  const normalizedMethod = normalizeShippingMethod(invoice?.shipping_method);
  if (normalizedMethod === SHIPPING_METHODS.COURIER) return SHIPPING_METHODS.COURIER;
  if (normalizedMethod === SHIPPING_METHODS.WALK_IN || normalizedMethod === 'walkin' || normalizedMethod === 'pickup' || normalizedMethod === 'meetup' || normalizedMethod === 'selfpickup') {
    return SHIPPING_METHODS.WALK_IN;
  }

  return isDeliveryRequiredForInvoice(invoice) ? SHIPPING_METHODS.COURIER : SHIPPING_METHODS.WALK_IN;
};

export const getShippingMethodLabel = (method) => (
  normalizeShippingMethod(method) === SHIPPING_METHODS.COURIER ? 'Courier' : 'Walk-in'
);

export const normalizeCourierPaymentMode = (value) => {
  if (typeof value !== 'string') return COURIER_PAYMENT_MODES.SELLER;
  const normalized = value.trim().toLowerCase();
  if (normalized === COURIER_PAYMENT_MODES.PLATFORM) return COURIER_PAYMENT_MODES.PLATFORM;
  return COURIER_PAYMENT_MODES.SELLER;
};

export const resolveCourierPaymentModeForInvoice = (invoice) => (
  normalizeCourierPaymentMode(invoice?.courier_payment_mode)
);

export const getCourierPaymentModeLabel = (mode) => (
  normalizeCourierPaymentMode(mode) === COURIER_PAYMENT_MODES.PLATFORM
    ? 'Platform uruskan'
    : 'Seller kutip & bayar'
);
