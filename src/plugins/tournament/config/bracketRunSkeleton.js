import { MATCH_STATUS } from '@/plugins/tournament/config/matchProgression';

const toInt = (value, fallback = 0) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getMatchStatus = (match) => {
  const hasA = Boolean(match?.participant_a);
  const hasB = Boolean(match?.participant_b);
  if (hasA && hasB) return MATCH_STATUS.READY;
  if (hasA || hasB) return MATCH_STATUS.BYE;
  return MATCH_STATUS.LOCKED;
};

export const generateSingleEliminationMatchSkeleton = (snapshot) => {
  const snapshotJson = snapshot?.snapshot_json || {};
  const draft = snapshotJson?.bracket_draft || {};
  const firstRoundMatches = Array.isArray(draft.first_round_matches) ? draft.first_round_matches : [];

  if (firstRoundMatches.length === 0) {
    throw new Error('Snapshot draft is missing first-round match data.');
  }

  const bracketSize = Math.max(toInt(draft.bracket_size, firstRoundMatches.length * 2), 2);
  const totalRounds = Math.max(toInt(draft.rounds_count, Math.log2(bracketSize)), 1);
  const participantCount = toInt(snapshot?.participant_count, 0);

  const roundMatches = [];
  const matches = [];
  for (let roundIndex = 1; roundIndex <= totalRounds; roundIndex += 1) {
    const count = bracketSize / (2 ** roundIndex);
    roundMatches.push(Math.max(toInt(count, 0), 1));
  }

  for (let roundIndex = 1; roundIndex <= totalRounds; roundIndex += 1) {
    const currentCount = roundMatches[roundIndex - 1];
    for (let matchIndex = 1; matchIndex <= currentCount; matchIndex += 1) {
      if (roundIndex === 1) {
        const source = firstRoundMatches[matchIndex - 1] || {};
        matches.push({
          round_index: roundIndex,
          match_index: matchIndex,
          seed_a: source?.seed_a ?? null,
          seed_b: source?.seed_b ?? null,
          participant_a_name: source?.participant_a?.display_name || null,
          participant_b_name: source?.participant_b?.display_name || null,
          participant_a_snapshot_ref: source?.participant_a?.id || null,
          participant_b_snapshot_ref: source?.participant_b?.id || null,
          match_status: getMatchStatus(source),
          next_round_index: roundIndex < totalRounds ? roundIndex + 1 : null,
          next_match_index: roundIndex < totalRounds ? Math.ceil(matchIndex / 2) : null,
        });
      } else {
        matches.push({
          round_index: roundIndex,
          match_index: matchIndex,
          seed_a: null,
          seed_b: null,
          participant_a_name: null,
          participant_b_name: null,
          participant_a_snapshot_ref: null,
          participant_b_snapshot_ref: null,
          match_status: MATCH_STATUS.LOCKED,
          next_round_index: roundIndex < totalRounds ? roundIndex + 1 : null,
          next_match_index: roundIndex < totalRounds ? Math.ceil(matchIndex / 2) : null,
        });
      }
    }
  }

  return {
    bracket_type: snapshot?.bracket_type || 'single_elimination',
    total_rounds: totalRounds,
    participant_count: participantCount,
    matches,
  };
};

export const groupMatchesByRound = (matches = []) => {
  const buckets = new Map();

  (Array.isArray(matches) ? matches : []).forEach((match) => {
    const roundIndex = toInt(match?.round_index, 0);
    if (roundIndex < 1) return;
    if (!buckets.has(roundIndex)) {
      buckets.set(roundIndex, []);
    }
    buckets.get(roundIndex).push(match);
  });

  return Array.from(buckets.entries())
    .sort(([leftRound], [rightRound]) => leftRound - rightRound)
    .map(([roundIndex, roundMatches]) => ({
      roundIndex,
      matches: roundMatches.sort((left, right) => toInt(left.match_index, 0) - toInt(right.match_index, 0)),
    }));
};
