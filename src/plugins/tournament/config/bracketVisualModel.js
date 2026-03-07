const toInt = (value, fallback = 0) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toTextOrNull = (value) => {
  const normalized = String(value || '').trim();
  return normalized.length > 0 ? normalized : null;
};

export const getBracketRoundDisplayLabel = (roundIndex, totalRounds) => {
  const round = toInt(roundIndex, 0);
  const rounds = Math.max(toInt(totalRounds, 0), round);
  if (round <= 0 || rounds <= 0) return '-';
  if (round === rounds) return 'Final';
  if (round === rounds - 1) return 'Semi Final';
  if (round === rounds - 2) return 'Quarter Final';
  return `Round ${round}`;
};

export const mapMatchToBracketCardViewModel = (match = {}, fallbackKey) => {
  const participantAName = toTextOrNull(match.participant_a_name);
  const participantBName = toTextOrNull(match.participant_b_name);
  const winnerName = toTextOrNull(match.winner_participant_name);
  const normalizedStatus = String(match.match_status || 'locked').trim().toLowerCase();

  const derivedKey = fallbackKey
    || `${toInt(match.round_index, 0)}-${toInt(match.match_index, 0)}`;

  return {
    id: match.id || derivedKey,
    roundIndex: toInt(match.round_index, 0),
    matchIndex: toInt(match.match_index, 0),
    seedA: Number.isInteger(match.seed_a) ? match.seed_a : null,
    seedB: Number.isInteger(match.seed_b) ? match.seed_b : null,
    scoreA: Number.isInteger(match.score_a) ? match.score_a : null,
    scoreB: Number.isInteger(match.score_b) ? match.score_b : null,
    participantAName,
    participantBName,
    winnerName,
    winnerSeedNumber: Number.isInteger(match.winner_seed_number) ? match.winner_seed_number : null,
    winnerSourceSlot: toTextOrNull(match.winner_source_slot),
    status: normalizedStatus || 'locked',
    completedAt: match.completed_at || null,
    isBye: normalizedStatus === 'bye',
    isPending: normalizedStatus === 'pending',
    isReady: normalizedStatus === 'ready',
    isCompleted: normalizedStatus === 'completed',
    isLocked: normalizedStatus === 'locked',
    slotAIsWinner: Boolean(winnerName && participantAName && winnerName === participantAName),
    slotBIsWinner: Boolean(winnerName && participantBName && winnerName === participantBName),
  };
};

export const buildVisualBracketRounds = ({ groupedRounds = [], totalRounds }) => {
  const grouped = Array.isArray(groupedRounds) ? groupedRounds : [];
  const byRound = new Map(
    grouped.map((round) => [toInt(round?.roundIndex, 0), Array.isArray(round?.matches) ? round.matches : []])
  );

  const maxExistingRound = grouped.reduce((maxRound, round) => {
    const roundIndex = toInt(round?.roundIndex, 0);
    return Math.max(maxRound, roundIndex);
  }, 0);

  const roundsCount = Math.max(toInt(totalRounds, 0), maxExistingRound, 0);
  if (roundsCount <= 0) return [];

  return Array.from({ length: roundsCount }).map((_, index) => {
    const roundIndex = index + 1;
    const sourceMatches = byRound.get(roundIndex) || [];
    const matches = sourceMatches
      .slice()
      .sort((left, right) => toInt(left?.match_index, 0) - toInt(right?.match_index, 0))
      .map((match, matchIndex) => mapMatchToBracketCardViewModel(match, `${roundIndex}-${matchIndex + 1}`));

    return {
      roundIndex,
      label: getBracketRoundDisplayLabel(roundIndex, roundsCount),
      matches,
    };
  });
};
