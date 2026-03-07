import { RUN_STATUS, isRunFinalized } from '@/plugins/tournament/config/runStatuses';

const hasText = (value) => String(value || '').trim().length > 0;

const sortByRoundThenIndex = (left, right) => {
  const leftRound = Number(left?.round_index || 0);
  const rightRound = Number(right?.round_index || 0);
  if (leftRound !== rightRound) return leftRound - rightRound;
  return Number(left?.match_index || 0) - Number(right?.match_index || 0);
};

const resolveEffectiveTotalRounds = ({ run, matches = [] }) => {
  const declaredRoundCount = Number(run?.total_rounds || 0);
  if (Number.isFinite(declaredRoundCount) && declaredRoundCount > 0) {
    return declaredRoundCount;
  }

  const computedRoundCount = (Array.isArray(matches) ? matches : []).reduce((maxRound, match) => {
    const roundIndex = Number(match?.round_index || 0);
    if (!Number.isFinite(roundIndex) || roundIndex < 1) return maxRound;
    return Math.max(maxRound, roundIndex);
  }, 0);

  return computedRoundCount > 0 ? computedRoundCount : 0;
};

const getRelevantMatches = ({ run, matches = [] }) => {
  const list = Array.isArray(matches) ? matches : [];
  const effectiveTotalRounds = resolveEffectiveTotalRounds({ run, matches: list });
  return list
    .filter((match) => (
      Number(match?.round_index || 0) <= effectiveTotalRounds
      && (
        hasText(match?.participant_a_name)
        || hasText(match?.participant_b_name)
        || Number(match?.round_index || 0) === effectiveTotalRounds
      )
    ))
    .sort(sortByRoundThenIndex);
};

export const getFinalMatchForRun = ({ run, matches = [] }) => {
  if (!run?.id) return null;
  const finalRound = resolveEffectiveTotalRounds({ run, matches });
  if (!Number.isFinite(finalRound) || finalRound < 1) return null;

  const finalMatch = (Array.isArray(matches) ? matches : []).find((match) => (
    Number(match?.round_index || 0) === finalRound
    && Number(match?.match_index || 0) === 1
  ));

  if (finalMatch) return finalMatch;

  return (Array.isArray(matches) ? matches : [])
    .filter((match) => Number(match?.round_index || 0) === finalRound)
    .sort(sortByRoundThenIndex)[0] || null;
};

export const resolveRunChampion = ({ run, matches = [] }) => {
  const finalMatch = getFinalMatchForRun({ run, matches });
  const winnerName = String(finalMatch?.winner_participant_name || '').trim();
  if (!winnerName) return null;

  return {
    champion_name: winnerName,
    champion_seed_number: Number.isInteger(finalMatch?.winner_seed_number)
      ? finalMatch.winner_seed_number
      : null,
    champion_snapshot_ref: finalMatch?.winner_snapshot_ref || null,
    final_match_id: finalMatch?.id || null,
    final_match: finalMatch,
  };
};

export const isBracketRunCompletable = ({ run, matches = [] }) => {
  if (!run?.id) {
    return {
      canFinalize: false,
      reason: 'Bracket run not found.',
    };
  }

  if (String(run?.bracket_type || '').trim() !== 'single_elimination') {
    return {
      canFinalize: false,
      reason: 'Finalization currently supports Single Elimination only.',
    };
  }

  if (isRunFinalized(run)) {
    return {
      canFinalize: false,
      reason: 'Run is already finalized.',
    };
  }

  if (String(run?.status || '').trim() !== RUN_STATUS.PREPARED) {
    return {
      canFinalize: false,
      reason: 'Run must be in prepared state before finalization.',
    };
  }

  const relevantMatches = getRelevantMatches({ run, matches });
  if (relevantMatches.length === 0) {
    return {
      canFinalize: false,
      reason: 'No relevant matches found for finalization.',
    };
  }

  const finalMatch = getFinalMatchForRun({ run, matches: relevantMatches });
  if (!finalMatch) {
    return {
      canFinalize: false,
      reason: 'Final match is missing.',
    };
  }

  if (!hasText(finalMatch?.winner_participant_name)) {
    return {
      canFinalize: false,
      reason: 'Final match is not completed yet.',
    };
  }

  const unresolvedMatches = relevantMatches.filter((match) => (
    !hasText(match?.winner_participant_name)
    && (hasText(match?.participant_a_name) || hasText(match?.participant_b_name))
  ));

  if (unresolvedMatches.length > 0) {
    return {
      canFinalize: false,
      reason: 'There are unresolved matches before finalization.',
    };
  }

  return {
    canFinalize: true,
    reason: '',
  };
};

export const getRunCompletionSummary = ({ run, matches = [], participants = [] }) => {
  const relevantMatches = getRelevantMatches({ run, matches });
  const completedMatchCount = relevantMatches.filter((match) => hasText(match?.winner_participant_name)).length;
  const totalRelevantMatches = relevantMatches.length;
  const finalMatch = getFinalMatchForRun({ run, matches: relevantMatches });
  const champion = resolveRunChampion({ run, matches: relevantMatches });
  const completionCheck = isBracketRunCompletable({ run, matches: relevantMatches });
  const totalRounds = resolveEffectiveTotalRounds({ run, matches: relevantMatches });

  return {
    isFinalized: isRunFinalized(run),
    canFinalize: completionCheck.canFinalize,
    finalizeReason: completionCheck.reason,
    championName: champion?.champion_name || run?.champion_name || null,
    championSeedNumber: champion?.champion_seed_number ?? run?.champion_seed_number ?? null,
    completedAt: run?.completed_at || null,
    participantCount: Number(run?.participant_count || participants?.length || 0),
    totalRounds,
    totalRelevantMatches,
    completedMatchCount,
    finalMatch,
    progressLabel: `${completedMatchCount}/${totalRelevantMatches}`,
  };
};
