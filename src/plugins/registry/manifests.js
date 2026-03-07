import { PLUGIN_STATUS } from '@/plugins/shared/pluginLifecycle';

export const rawPluginManifests = [
  {
    id: 'tournament',
    slug: 'tournament',
    name: 'Tournament Manager',
    description: 'Cipta tournament dengan premade template (Pokemon TCG, Beyblade X, Digimon, Custom) dalam modul terasing.',
    version: '0.2.0-v1-foundation',
    route: '/plugins/tournament',
    status: PLUGIN_STATUS.ENABLED,
    price: {
      amount: 0,
      currency: 'MYR',
      label: 'Included',
    },
    requiresSetup: true,
    capabilities: [
      'Create tournament wizard (template-driven)',
      'Bracket recommendation + editable override',
      'Tournament list + detail placeholder (Players/Bracket/Results)',
      'Isolated DB tables + RLS owner-only',
    ],
    category: 'operations',
    icon: 'trophy',
    comingSoon: false,
    purchaseRequired: false,
    featureFlags: {},
    sidebarSectionLabel: 'Tournament',
    sidebarSectionOrder: 100,
    sidebarItems: [
      {
        label: 'Create Tournament',
        route: '/plugins/tournament/create',
        icon: 'plus',
        order: 10,
      },
      {
        label: 'View Tournament',
        route: '/plugins/tournament',
        icon: 'trophy',
        order: 20,
      },
    ],
  },
];
