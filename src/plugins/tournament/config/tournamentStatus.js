import { RUN_STATUS } from '@/plugins/tournament/config/runStatuses';

export const TOURNAMENT_STATUS = Object.freeze({
  DRAFT: 'draft',
  READY: 'ready',
  ONGOING: 'ongoing',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
});

const RUN_TO_TOURNAMENT_STATUS = Object.freeze({
  [RUN_STATUS.DRAFT]: TOURNAMENT_STATUS.ONGOING,
  [RUN_STATUS.PREPARED]: TOURNAMENT_STATUS.ONGOING,
  [RUN_STATUS.COMPLETED]: TOURNAMENT_STATUS.COMPLETED,
});

const isKnownTournamentStatus = (status) => (
  Object.values(TOURNAMENT_STATUS).includes(status)
);

export const normalizeTournamentStatus = (status, fallback = TOURNAMENT_STATUS.DRAFT) => {
  const normalized = String(status || '').trim().toLowerCase();
  if (isKnownTournamentStatus(normalized)) return normalized;
  return isKnownTournamentStatus(fallback) ? fallback : TOURNAMENT_STATUS.DRAFT;
};

export const deriveTournamentStatusFromRunStatus = (runStatus, fallbackStatus = TOURNAMENT_STATUS.DRAFT) => {
  const normalizedRunStatus = String(runStatus || '').trim().toLowerCase();
  const mappedStatus = RUN_TO_TOURNAMENT_STATUS[normalizedRunStatus];
  if (mappedStatus) return mappedStatus;
  return normalizeTournamentStatus(fallbackStatus, TOURNAMENT_STATUS.DRAFT);
};

export const getDisplayTournamentStatus = (tournament, latestRun) => {
  const tournamentStatus = normalizeTournamentStatus(tournament?.status, TOURNAMENT_STATUS.DRAFT);
  return deriveTournamentStatusFromRunStatus(latestRun?.status, tournamentStatus);
};
