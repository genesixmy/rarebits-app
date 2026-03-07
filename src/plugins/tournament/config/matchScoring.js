export const MATCH_FORMAT = Object.freeze({
  BO1: 'bo1',
  BO3: 'bo3',
  BO5: 'bo5',
});

export const MATCH_FORMAT_OPTIONS = Object.freeze([
  { value: MATCH_FORMAT.BO1, label: 'BO1 (Best of 1)' },
  { value: MATCH_FORMAT.BO3, label: 'BO3 (Best of 3)' },
  { value: MATCH_FORMAT.BO5, label: 'BO5 (Best of 5)' },
]);

const MATCH_FORMAT_LABEL_MAP = Object.freeze(
  MATCH_FORMAT_OPTIONS.reduce((acc, option) => {
    acc[option.value] = option.label;
    return acc;
  }, {})
);

const MATCH_FORMAT_ALIASES = Object.freeze({
  bo1: MATCH_FORMAT.BO1,
  bestof1: MATCH_FORMAT.BO1,
  best_of_1: MATCH_FORMAT.BO1,
  'best of 1': MATCH_FORMAT.BO1,
  '1': MATCH_FORMAT.BO1,

  bo3: MATCH_FORMAT.BO3,
  bestof3: MATCH_FORMAT.BO3,
  best_of_3: MATCH_FORMAT.BO3,
  'best of 3': MATCH_FORMAT.BO3,
  '3': MATCH_FORMAT.BO3,

  bo5: MATCH_FORMAT.BO5,
  bestof5: MATCH_FORMAT.BO5,
  best_of_5: MATCH_FORMAT.BO5,
  'best of 5': MATCH_FORMAT.BO5,
  '5': MATCH_FORMAT.BO5,
});

const toNormalizedAliasKey = (rawValue) => (
  String(rawValue || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
);

export const normalizeMatchFormat = (rawValue, fallback = MATCH_FORMAT.BO1) => {
  const source = String(rawValue || '').trim().toLowerCase();
  if (!source) return fallback;

  if (MATCH_FORMAT_ALIASES[source]) return MATCH_FORMAT_ALIASES[source];

  const aliasKey = toNormalizedAliasKey(source);
  if (MATCH_FORMAT_ALIASES[aliasKey]) return MATCH_FORMAT_ALIASES[aliasKey];

  return fallback;
};

export const getSeriesWinTarget = (rawFormat) => {
  const format = normalizeMatchFormat(rawFormat);
  if (format === MATCH_FORMAT.BO5) return 3;
  if (format === MATCH_FORMAT.BO3) return 2;
  return 1;
};

export const getSeriesMaxGames = (rawFormat) => {
  const format = normalizeMatchFormat(rawFormat);
  if (format === MATCH_FORMAT.BO5) return 5;
  if (format === MATCH_FORMAT.BO3) return 3;
  return 1;
};

export const isManualWinnerAllowed = (rawFormat) => (
  normalizeMatchFormat(rawFormat) === MATCH_FORMAT.BO1
);

export const getMatchFormatDisplayLabel = (rawFormat) => {
  const normalized = normalizeMatchFormat(rawFormat);
  return MATCH_FORMAT_LABEL_MAP[normalized] || MATCH_FORMAT_LABEL_MAP[MATCH_FORMAT.BO1];
};

const parseScoreValue = (rawValue) => {
  if (rawValue === '' || rawValue === null || rawValue === undefined) return null;
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
};

export const evaluateMatchScoreState = ({
  matchFormat,
  scoreA,
  scoreB,
}) => {
  const format = normalizeMatchFormat(matchFormat);
  const parsedScoreA = parseScoreValue(scoreA);
  const parsedScoreB = parseScoreValue(scoreB);

  if (parsedScoreA === null && parsedScoreB === null) {
    return {
      state: 'empty',
      reason: '',
      normalized: null,
      format,
    };
  }

  if (!Number.isInteger(parsedScoreA) || !Number.isInteger(parsedScoreB)) {
    return {
      state: 'incomplete',
      reason: 'Enter both scores to continue.',
      normalized: null,
      format,
    };
  }

  if (parsedScoreA < 0 || parsedScoreB < 0) {
    return {
      state: 'invalid',
      reason: 'Scores cannot be negative.',
      normalized: null,
      format,
    };
  }

  const target = getSeriesWinTarget(format);
  const maxGames = getSeriesMaxGames(format);
  const totalGames = parsedScoreA + parsedScoreB;

  if (format === MATCH_FORMAT.BO1) {
    const isValidBo1 = (
      (parsedScoreA === 1 && parsedScoreB === 0)
      || (parsedScoreA === 0 && parsedScoreB === 1)
    );

    if (isValidBo1) {
      return {
        state: 'complete',
        reason: '',
        normalized: {
          format,
          scoreA: parsedScoreA,
          scoreB: parsedScoreB,
          winnerSide: parsedScoreA > parsedScoreB ? 'A' : 'B',
        },
        format,
      };
    }

    if (
      parsedScoreA <= target
      && parsedScoreB <= target
      && totalGames <= maxGames
      && parsedScoreA === parsedScoreB
      && parsedScoreA < target
    ) {
      return {
        state: 'incomplete',
        reason: 'BO1 needs a final 1-0 result.',
        normalized: null,
        format,
      };
    }

    return {
      state: 'invalid',
      reason: 'BO1 only allows 1-0 or 0-1.',
      normalized: null,
      format,
    };
  }

  const reachedTargetA = parsedScoreA === target;
  const reachedTargetB = parsedScoreB === target;
  const reachedAnyTarget = reachedTargetA || reachedTargetB;

  if (parsedScoreA > target || parsedScoreB > target) {
    return {
      state: 'invalid',
      reason: `Scores cannot exceed ${target} for ${format.toUpperCase()}.`,
      normalized: null,
      format,
    };
  }

  if (totalGames > maxGames) {
    return {
      state: 'invalid',
      reason: `Total games exceed ${format.toUpperCase()} maximum (${maxGames}).`,
      normalized: null,
      format,
    };
  }

  if (!reachedAnyTarget) {
    return {
      state: 'incomplete',
      reason: `${format.toUpperCase()} requires first to ${target}.`,
      normalized: null,
      format,
    };
  }

  if (reachedTargetA && reachedTargetB) {
    return {
      state: 'invalid',
      reason: 'Both players cannot reach win target.',
      normalized: null,
      format,
    };
  }

  if (parsedScoreA === parsedScoreB) {
    return {
      state: 'invalid',
      reason: 'Tie score is not allowed.',
      normalized: null,
      format,
    };
  }

  return {
    state: 'complete',
    reason: '',
    normalized: {
      format,
      scoreA: parsedScoreA,
      scoreB: parsedScoreB,
      winnerSide: parsedScoreA > parsedScoreB ? 'A' : 'B',
    },
    format,
  };
};

export const isScoreComplete = ({
  matchFormat,
  scoreA,
  scoreB,
}) => (
  evaluateMatchScoreState({
    matchFormat,
    scoreA,
    scoreB,
  }).state === 'complete'
);

export const validateMatchScore = ({
  matchFormat,
  scoreA,
  scoreB,
}) => {
  const evaluation = evaluateMatchScoreState({
    matchFormat,
    scoreA,
    scoreB,
  });

  if (evaluation.state !== 'complete') {
    return {
      isValid: false,
      reason: evaluation.reason || 'Invalid score input.',
      normalized: null,
    };
  }

  return {
    isValid: true,
    reason: '',
    normalized: evaluation.normalized,
  };
};

export const resolveWinnerFromScore = ({
  match,
  matchFormat,
  scoreA,
  scoreB,
}) => {
  const validation = validateMatchScore({
    matchFormat,
    scoreA,
    scoreB,
  });

  if (!validation.isValid || !validation.normalized) {
    throw new Error(validation.reason || 'Invalid match score.');
  }

  const { winnerSide, scoreA: normalizedScoreA, scoreB: normalizedScoreB } = validation.normalized;
  const winnerName = winnerSide === 'A' ? match?.participant_a_name : match?.participant_b_name;

  if (!String(winnerName || '').trim()) {
    throw new Error('Cannot resolve winner because participant slot is incomplete.');
  }

  return {
    winnerSide,
    winnerPayload: {
      winner_participant_name: winnerName,
      winner_seed_number: winnerSide === 'A'
        ? (Number.isInteger(match?.seed_a) ? match.seed_a : null)
        : (Number.isInteger(match?.seed_b) ? match.seed_b : null),
      winner_source_slot: winnerSide,
      winner_snapshot_ref: winnerSide === 'A'
        ? (match?.participant_a_snapshot_ref || null)
        : (match?.participant_b_snapshot_ref || null),
    },
    normalizedScoreA,
    normalizedScoreB,
  };
};
