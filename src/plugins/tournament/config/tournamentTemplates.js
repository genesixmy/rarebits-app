export const BRACKET_TYPE_OPTIONS = [
  { value: 'swiss', label: 'Swiss' },
  { value: 'single_elimination', label: 'Single Elimination' },
  { value: 'double_elimination', label: 'Double Elimination' },
  { value: 'round_robin', label: 'Round Robin' },
];

export const TOURNAMENT_STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'ready', label: 'Ready' },
  { value: 'ongoing', label: 'Ongoing' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

export const TOURNAMENT_CREATE_STEPS = [
  { id: 1, title: 'Choose Template' },
  { id: 2, title: 'Tournament Details' },
  { id: 3, title: 'Review & Create' },
];

export const normalizeTemplateConfig = (template) => {
  const raw = template?.config_json && typeof template.config_json === 'object'
    ? template.config_json
    : {};

  const allowedBracketTypes = Array.isArray(raw.allowed_bracket_types)
    ? raw.allowed_bracket_types.filter((value) => typeof value === 'string' && value.trim())
    : [];

  const dynamicFormFields = Array.isArray(raw.dynamic_form_fields)
    ? raw.dynamic_form_fields.filter((field) => field && typeof field === 'object' && field.key)
    : [];

  const recommendedParticipantSizes = Array.isArray(raw.recommended_participant_sizes)
    ? raw.recommended_participant_sizes
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isFinite(value) && value > 0)
    : [];

  const defaultSettings = raw.default_settings && typeof raw.default_settings === 'object'
    ? raw.default_settings
    : {};

  return {
    recommendedBracketType: raw.recommended_bracket_type || 'single_elimination',
    allowedBracketTypes: allowedBracketTypes.length > 0 ? allowedBracketTypes : ['single_elimination'],
    defaultMatchFormat: raw.default_match_format || 'Best of 1',
    defaultRoundTimeMinutes: Number.isFinite(Number(raw.default_round_time_minutes))
      ? Math.max(Number(raw.default_round_time_minutes), 1)
      : 20,
    recommendedParticipantSizes,
    dynamicFormFields,
    defaultSettings,
  };
};

export const getRecommendedBracketType = (templateSlug, maxPlayers, fallback = 'single_elimination') => {
  const players = Number.parseInt(maxPlayers, 10);
  if (!Number.isFinite(players) || players <= 0) {
    return fallback;
  }

  switch (String(templateSlug || '').toLowerCase()) {
    case 'pokemon_tcg':
      if (players <= 8) return 'round_robin';
      return 'swiss';
    case 'beyblade_x':
      if (players <= 8) return 'round_robin';
      return 'double_elimination';
    case 'digimon':
      if (players <= 6) return 'round_robin';
      return 'single_elimination';
    default:
      return fallback;
  }
};

export const getBracketTypeLabel = (value) => (
  BRACKET_TYPE_OPTIONS.find((option) => option.value === value)?.label || value || '-'
);

