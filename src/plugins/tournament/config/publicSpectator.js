import { getRunCompletionSummary } from '@/plugins/tournament/config/runCompletion';

const hasText = (value) => String(value || '').trim().length > 0;

const toNormalizedMatch = (match) => ({
  round_index: Number(match?.round_index || 0),
  match_index: Number(match?.match_index || 0),
  seed_a: Number.isInteger(match?.seed_a) ? match.seed_a : null,
  seed_b: Number.isInteger(match?.seed_b) ? match.seed_b : null,
  participant_a_name: hasText(match?.participant_a_name) ? String(match.participant_a_name).trim() : null,
  participant_b_name: hasText(match?.participant_b_name) ? String(match.participant_b_name).trim() : null,
  match_status: String(match?.match_status || 'pending').trim().toLowerCase(),
  score_a: Number.isInteger(match?.score_a) ? match.score_a : null,
  score_b: Number.isInteger(match?.score_b) ? match.score_b : null,
  winner_participant_name: hasText(match?.winner_participant_name) ? String(match.winner_participant_name).trim() : null,
  winner_seed_number: Number.isInteger(match?.winner_seed_number) ? match.winner_seed_number : null,
  winner_source_slot: hasText(match?.winner_source_slot) ? String(match.winner_source_slot).trim().toUpperCase() : null,
  completed_at: match?.completed_at || null,
});

const toNormalizedRun = (run) => {
  if (!run || typeof run !== 'object') return null;
  return {
    ...run,
    id: run.id || '__public_run__',
    status: String(run.status || '').trim().toLowerCase(),
    total_rounds: Number(run.total_rounds || 0),
    participant_count: Number(run.participant_count || 0),
    created_at: run.created_at || null,
    updated_at: run.updated_at || null,
    completed_at: run.completed_at || null,
  };
};

const runPriorityWeight = (run) => {
  const status = String(run?.status || '').trim().toLowerCase();
  if (status === 'prepared' || status === 'draft') return 0;
  if (status === 'completed') return 1;
  return 2;
};

export const resolvePublicDisplayRun = (runs = []) => {
  const safeRuns = (Array.isArray(runs) ? runs : [])
    .map(toNormalizedRun)
    .filter(Boolean);

  if (safeRuns.length === 0) return null;

  return safeRuns
    .slice()
    .sort((left, right) => {
      const statusWeightDiff = runPriorityWeight(left) - runPriorityWeight(right);
      if (statusWeightDiff !== 0) return statusWeightDiff;
      const leftUpdated = new Date(left.updated_at || left.created_at || 0).getTime();
      const rightUpdated = new Date(right.updated_at || right.created_at || 0).getTime();
      return rightUpdated - leftUpdated;
    })[0];
};

export const groupPublicMatchesByRound = (matches = []) => {
  const grouped = new Map();
  for (const match of Array.isArray(matches) ? matches : []) {
    const roundIndex = Number(match?.round_index || 0);
    if (!Number.isFinite(roundIndex) || roundIndex < 1) continue;
    if (!grouped.has(roundIndex)) grouped.set(roundIndex, []);
    grouped.get(roundIndex).push(match);
  }

  return Array.from(grouped.entries())
    .sort(([leftRound], [rightRound]) => leftRound - rightRound)
    .map(([roundIndex, roundMatches]) => ({
      roundIndex,
      matches: roundMatches.sort((left, right) => Number(left.match_index || 0) - Number(right.match_index || 0)),
    }));
};

export const getPublicDisplayStatus = ({ tournament, run }) => {
  const runStatus = String(run?.status || '').trim().toLowerCase();
  if (runStatus === 'completed') return 'completed';
  if (runStatus === 'prepared' || runStatus === 'draft') return 'ongoing';

  const tournamentStatus = String(tournament?.status || '').trim().toLowerCase();
  if (tournamentStatus === 'completed') return 'completed';
  if (tournamentStatus === 'ongoing' || tournamentStatus === 'ready' || tournamentStatus === 'draft') return 'ongoing';
  return 'unavailable';
};

export const resolvePublicTournamentViewModel = (rawPayload, requestedCode) => {
  const payload = rawPayload && typeof rawPayload === 'object' ? rawPayload : null;
  const tournament = payload?.tournament && typeof payload.tournament === 'object'
    ? payload.tournament
    : null;

  if (!tournament) {
    return {
      found: false,
      requestedCode: String(requestedCode || '').trim(),
      tournament: null,
      displayRun: null,
      matches: [],
      groupedRounds: [],
      displayStatus: 'not_found',
      supportedBracket: false,
      summary: null,
    };
  }

  const candidateRuns = Array.isArray(payload?.runs)
    ? payload.runs
    : (payload?.display_run ? [payload.display_run] : []);
  const displayRun = resolvePublicDisplayRun(candidateRuns);

  const matches = (Array.isArray(payload?.matches) ? payload.matches : [])
    .map(toNormalizedMatch)
    .filter((match) => match.round_index > 0 && match.match_index > 0);

  const groupedRounds = groupPublicMatchesByRound(matches);
  const displayStatus = getPublicDisplayStatus({ tournament, run: displayRun });
  const supportedBracket = String(displayRun?.bracket_type || tournament?.bracket_type || '').trim() === 'single_elimination';
  const summary = displayRun
    ? getRunCompletionSummary({
      run: displayRun,
      matches,
      participants: Array.from({ length: Math.max(Number(displayRun.participant_count || 0), 0) }).map(() => ({})),
    })
    : null;

  return {
    found: true,
    requestedCode: String(requestedCode || '').trim(),
    tournament,
    displayRun,
    matches,
    groupedRounds,
    displayStatus,
    supportedBracket,
    summary,
  };
};
