import { getPluginBySlug, pluginRegistry } from '@/plugins/registry';
import {
  ACCESSIBLE_PLUGIN_STATUSES,
  PLUGIN_STATUS,
  VISIBLE_PLUGIN_STATUSES,
} from '@/plugins/shared/pluginLifecycle';

export const getAvailablePlugins = () => (
  pluginRegistry.filter((plugin) => (
    VISIBLE_PLUGIN_STATUSES.includes(plugin.status)
    && plugin.featureFlags?.hidden !== true
  ))
);

export const isPluginEnabled = (pluginSlug) => {
  const plugin = getPluginBySlug(pluginSlug);
  return plugin?.status === PLUGIN_STATUS.ENABLED;
};

export const canAccessPlugin = (pluginSlug) => {
  const plugin = getPluginBySlug(pluginSlug);
  if (!plugin) return false;
  if (!ACCESSIBLE_PLUGIN_STATUSES.includes(plugin.status)) return false;
  return true;
};

export const getPluginAccessState = (pluginSlug) => {
  const plugin = getPluginBySlug(pluginSlug);
  if (!plugin) {
    return {
      plugin: null,
      canAccess: false,
      reason: 'not_found',
    };
  }

  if (plugin.status === PLUGIN_STATUS.DISABLED) {
    return {
      plugin,
      canAccess: false,
      reason: 'disabled',
    };
  }

  if (plugin.status === PLUGIN_STATUS.COMING_SOON || plugin.comingSoon) {
    return {
      plugin,
      canAccess: false,
      reason: 'coming_soon',
    };
  }

  if (plugin.purchaseRequired) {
    return {
      plugin,
      canAccess: false,
      reason: 'purchase_required',
    };
  }

  return {
    plugin,
    canAccess: canAccessPlugin(pluginSlug),
    reason: 'ok',
  };
};

export const shouldShowPluginCenterNav = () => getAvailablePlugins().length > 0;

export const isPluginVisibleInSidebar = (pluginSlug) => {
  const plugin = getPluginBySlug(pluginSlug);
  if (!plugin) return false;
  if (plugin.featureFlags?.hiddenInSidebar === true) return false;
  if (plugin.status !== PLUGIN_STATUS.ENABLED) return false;
  if (!Array.isArray(plugin.sidebarItems) || plugin.sidebarItems.length === 0) return false;
  return true;
};

export const normalizePluginSidebarSection = (plugin) => {
  if (!plugin) return null;

  const sectionItems = (Array.isArray(plugin.sidebarItems) ? plugin.sidebarItems : [])
    .filter((item) => item?.label && item?.route)
    .map((item, index) => ({
      key: `${plugin.slug}:${item.route}:${index}`,
      label: item.label,
      route: item.route,
      icon: item.icon || 'puzzle',
      order: Number.isFinite(Number(item.order)) ? Number(item.order) : ((index + 1) * 10),
    }))
    .sort((left, right) => {
      if (left.order !== right.order) return left.order - right.order;
      return left.label.localeCompare(right.label);
    });

  if (sectionItems.length === 0) return null;

  return {
    pluginId: plugin.id,
    pluginSlug: plugin.slug,
    label: plugin.sidebarSectionLabel || plugin.name || 'Plugin',
    order: Number.isFinite(Number(plugin.sidebarSectionOrder)) ? Number(plugin.sidebarSectionOrder) : 999,
    items: sectionItems,
  };
};

export const getEnabledPluginSidebarSections = () => (
  pluginRegistry
    .filter((plugin) => isPluginVisibleInSidebar(plugin.slug) && canAccessPlugin(plugin.slug))
    .map((plugin) => normalizePluginSidebarSection(plugin))
    .filter(Boolean)
    .sort((left, right) => {
      if (left.order !== right.order) return left.order - right.order;
      return left.label.localeCompare(right.label);
    })
);
