export const MATCH_STATUS = Object.freeze({
  PENDING: 'pending',
  READY: 'ready',
  BYE: 'bye',
  COMPLETED: 'completed',
  LOCKED: 'locked',
});

const hasText = (value) => String(value || '').trim().length > 0;

export const getPropagationTargetSlot = (matchIndex) => (
  Number(matchIndex) % 2 === 1 ? 'A' : 'B'
);

export const getByeWinnerSide = (match) => {
  const hasA = hasText(match?.participant_a_name);
  const hasB = hasText(match?.participant_b_name);
  if (hasA && !hasB) return 'A';
  if (!hasA && hasB) return 'B';
  return null;
};

export const resolveMatchStatus = (match) => {
  if (hasText(match?.winner_participant_name)) return MATCH_STATUS.COMPLETED;

  const hasA = hasText(match?.participant_a_name);
  const hasB = hasText(match?.participant_b_name);

  if (hasA && hasB) return MATCH_STATUS.READY;

  if (hasA || hasB) {
    const isRoundOne = Number(match?.round_index) === 1;
    const hasSeedA = Number.isInteger(match?.seed_a);
    const hasSeedB = Number.isInteger(match?.seed_b);
    if (isRoundOne && hasSeedA && hasSeedB) return MATCH_STATUS.BYE;
    return MATCH_STATUS.PENDING;
  }

  return MATCH_STATUS.LOCKED;
};

export const canAssignWinner = (match) => {
  const status = String(match?.match_status || '');
  if (status === MATCH_STATUS.READY || status === MATCH_STATUS.BYE || status === MATCH_STATUS.COMPLETED) {
    return true;
  }
  return false;
};

export const canResetMatch = (match) => (
  String(match?.match_status || '').trim() === MATCH_STATUS.COMPLETED
  && hasText(match?.winner_participant_name)
);

export const getWinnerActionOptions = (match) => {
  const hasA = hasText(match?.participant_a_name);
  const hasB = hasText(match?.participant_b_name);
  const status = String(match?.match_status || '');
  const isBye = status === MATCH_STATUS.BYE;

  if (isBye) {
    const side = getByeWinnerSide(match);
    const name = side === 'A' ? match?.participant_a_name : match?.participant_b_name;
    if (!side || !name) return [];
    return [{
      value: 'BYE',
      label: `Advance BYE (${name})`,
    }];
  }

  const options = [];
  if (hasA) options.push({ value: 'A', label: `Set Winner A (${match.participant_a_name})` });
  if (hasB) options.push({ value: 'B', label: `Set Winner B (${match.participant_b_name})` });
  return options;
};

export const resolveMatchWinnerPayload = (match, selectedSide) => {
  const normalizedSide = String(selectedSide || '').trim().toUpperCase();
  let resolvedSide = normalizedSide;
  if (normalizedSide === 'BYE') {
    resolvedSide = getByeWinnerSide(match);
    if (!resolvedSide) throw new Error('Cannot resolve BYE winner side for this match.');
  }

  if (resolvedSide === 'A') {
    if (!hasText(match?.participant_a_name)) throw new Error('Participant A is missing.');
    return {
      winner_participant_name: match.participant_a_name,
      winner_seed_number: Number.isInteger(match?.seed_a) ? match.seed_a : null,
      winner_source_slot: normalizedSide === 'BYE' ? 'BYE' : 'A',
      winner_snapshot_ref: match?.participant_a_snapshot_ref || null,
    };
  }

  if (resolvedSide === 'B') {
    if (!hasText(match?.participant_b_name)) throw new Error('Participant B is missing.');
    return {
      winner_participant_name: match.participant_b_name,
      winner_seed_number: Number.isInteger(match?.seed_b) ? match.seed_b : null,
      winner_source_slot: normalizedSide === 'BYE' ? 'BYE' : 'B',
      winner_snapshot_ref: match?.participant_b_snapshot_ref || null,
    };
  }

  throw new Error('Selected winner side is invalid.');
};

export const canOverwriteDownstreamSlot = ({
  targetMatch,
  targetSlot,
  oldWinnerName,
  newWinnerName,
}) => {
  const slotField = targetSlot === 'A' ? 'participant_a_name' : 'participant_b_name';
  const existingValue = String(targetMatch?.[slotField] || '').trim();

  if (!existingValue) {
    return {
      canOverwrite: true,
      reason: '',
    };
  }

  if (existingValue === String(oldWinnerName || '').trim()) {
    return {
      canOverwrite: true,
      reason: '',
    };
  }

  if (existingValue === String(newWinnerName || '').trim()) {
    return {
      canOverwrite: true,
      reason: '',
    };
  }

  return {
    canOverwrite: false,
    reason: 'Downstream slot already contains a different participant.',
  };
};

export const isDownstreamLockedForCorrection = (targetMatch) => {
  const status = String(targetMatch?.match_status || '').trim();
  if (status === MATCH_STATUS.COMPLETED) return true;
  if (hasText(targetMatch?.winner_participant_name)) return true;
  return false;
};

export const buildResetMatchPayload = (match) => {
  const candidate = {
    ...match,
    score_a: null,
    score_b: null,
    winner_participant_name: null,
    winner_seed_number: null,
    winner_source_slot: null,
    winner_snapshot_ref: null,
    completed_at: null,
  };

  return {
    score_a: null,
    score_b: null,
    winner_participant_name: null,
    winner_seed_number: null,
    winner_source_slot: null,
    winner_snapshot_ref: null,
    completed_at: null,
    match_status: resolveMatchStatus(candidate),
  };
};
