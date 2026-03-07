export const PLUGIN_STATUS = Object.freeze({
  AVAILABLE: 'available',
  ENABLED: 'enabled',
  DISABLED: 'disabled',
  COMING_SOON: 'coming_soon',
});

export const PLUGIN_STATUS_LABEL = Object.freeze({
  [PLUGIN_STATUS.AVAILABLE]: 'Available',
  [PLUGIN_STATUS.ENABLED]: 'Enabled',
  [PLUGIN_STATUS.DISABLED]: 'Disabled',
  [PLUGIN_STATUS.COMING_SOON]: 'Coming Soon',
});

export const VISIBLE_PLUGIN_STATUSES = Object.freeze([
  PLUGIN_STATUS.AVAILABLE,
  PLUGIN_STATUS.ENABLED,
  PLUGIN_STATUS.COMING_SOON,
]);

export const ACCESSIBLE_PLUGIN_STATUSES = Object.freeze([
  PLUGIN_STATUS.ENABLED,
]);

export const isKnownPluginStatus = (status) => (
  Object.values(PLUGIN_STATUS).includes(status)
);

