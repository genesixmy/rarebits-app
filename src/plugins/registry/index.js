import { rawPluginManifests } from '@/plugins/registry/manifests';
import { PLUGIN_STATUS, isKnownPluginStatus } from '@/plugins/shared/pluginLifecycle';

const DEFAULT_PRICE = Object.freeze({
  amount: 0,
  currency: 'MYR',
  label: 'Included',
});

const normalizeCapabilities = (capabilities) => {
  if (!Array.isArray(capabilities)) return [];
  return capabilities
    .map((item) => String(item || '').trim())
    .filter(Boolean);
};

const normalizePrice = (price) => {
  if (price && typeof price === 'object') {
    const amount = Number.parseFloat(price.amount);
    return {
      amount: Number.isFinite(amount) && amount >= 0 ? amount : DEFAULT_PRICE.amount,
      currency: String(price.currency || DEFAULT_PRICE.currency).trim() || DEFAULT_PRICE.currency,
      label: String(price.label || DEFAULT_PRICE.label).trim() || DEFAULT_PRICE.label,
    };
  }

  if (Number.isFinite(Number(price))) {
    return {
      ...DEFAULT_PRICE,
      amount: Math.max(Number(price), 0),
    };
  }

  return { ...DEFAULT_PRICE };
};

const normalizeSidebarItems = (sidebarItems) => {
  if (!Array.isArray(sidebarItems)) return [];

  return sidebarItems
    .map((item, index) => ({
      label: String(item?.label || '').trim(),
      route: String(item?.route || '').trim(),
      icon: String(item?.icon || 'puzzle').trim(),
      order: Number.isFinite(Number(item?.order)) ? Number(item.order) : ((index + 1) * 10),
    }))
    .filter((item) => item.label && item.route)
    .sort((left, right) => {
      if (left.order !== right.order) return left.order - right.order;
      return left.label.localeCompare(right.label);
    });
};

const normalizeManifest = (rawManifest) => {
  const id = String(rawManifest?.id || '').trim();
  const slug = String(rawManifest?.slug || id).trim().toLowerCase();
  const status = isKnownPluginStatus(rawManifest?.status)
    ? rawManifest.status
    : PLUGIN_STATUS.DISABLED;
  const normalizedSidebarItems = normalizeSidebarItems(rawManifest?.sidebarItems);

  return {
    id,
    slug,
    name: String(rawManifest?.name || id || slug || 'Unnamed Plugin').trim(),
    description: String(rawManifest?.description || '').trim(),
    version: String(rawManifest?.version || '0.0.0').trim(),
    route: String(rawManifest?.route || `/plugins/${slug}`).trim(),
    status,
    price: normalizePrice(rawManifest?.price),
    requiresSetup: Boolean(rawManifest?.requiresSetup),
    capabilities: normalizeCapabilities(rawManifest?.capabilities),
    category: String(rawManifest?.category || 'general').trim(),
    icon: String(rawManifest?.icon || 'puzzle').trim(),
    comingSoon: Boolean(rawManifest?.comingSoon || status === PLUGIN_STATUS.COMING_SOON),
    purchaseRequired: Boolean(rawManifest?.purchaseRequired),
    featureFlags: rawManifest?.featureFlags && typeof rawManifest.featureFlags === 'object'
      ? { ...rawManifest.featureFlags }
      : {},
    sidebarSectionLabel: String(rawManifest?.sidebarSectionLabel || rawManifest?.name || '').trim(),
    sidebarSectionOrder: Number.isFinite(Number(rawManifest?.sidebarSectionOrder))
      ? Number(rawManifest.sidebarSectionOrder)
      : 999,
    sidebarItems: normalizedSidebarItems,
  };
};

export const pluginRegistry = rawPluginManifests
  .map(normalizeManifest)
  .filter((manifest) => manifest.id && manifest.slug);

export const getPluginById = (pluginId) => (
  pluginRegistry.find((plugin) => plugin.id === pluginId) || null
);

export const getPluginBySlug = (pluginSlug) => (
  pluginRegistry.find((plugin) => plugin.slug === pluginSlug) || null
);
