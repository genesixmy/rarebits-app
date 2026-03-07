import React, { useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  useAssignTournamentMatchWinner,
  useBracketRunMatches,
  useCanStartNewRunFromSnapshot,
  useCreateBracketRunFromSnapshot,
  useFinalizeTournamentBracketRun,
  useLatestTournamentBracketRun,
  useLatestTournamentBracketSnapshot,
  usePrepareTournamentBracketSnapshot,
  useRebuildBracketRunFromPreparedSnapshot,
  useResetTournamentMatchResult,
  useStartNewRunFromPreparedSnapshot,
  useTournamentParticipants,
} from '@/plugins/tournament/hooks/useTournamentPlugin';
import { validateBracketPreparationReadiness } from '@/plugins/tournament/config/bracketPreparation';
import { groupMatchesByRound } from '@/plugins/tournament/config/bracketRunSkeleton';
import { buildVisualBracketRounds } from '@/plugins/tournament/config/bracketVisualModel';
import { canAssignWinner, canResetMatch, getWinnerActionOptions } from '@/plugins/tournament/config/matchProgression';
import {
  evaluateMatchScoreState,
  getMatchFormatDisplayLabel,
  isManualWinnerAllowed,
  normalizeMatchFormat,
} from '@/plugins/tournament/config/matchScoring';
import { getRunCompletionSummary } from '@/plugins/tournament/config/runCompletion';
import { isRunFinalized } from '@/plugins/tournament/config/runStatuses';
import { getBracketTypeLabel } from '@/plugins/tournament/config/tournamentTemplates';
import { getDisplayTournamentStatus } from '@/plugins/tournament/config/tournamentStatus';
import { Loader2, ShieldAlert } from 'lucide-react';
import SingleEliminationBracketView from '@/plugins/tournament/components/bracket/SingleEliminationBracketView';

const readinessClassMap = {
  ready: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  warning: 'border-amber-300 bg-amber-50 text-amber-700',
  not_ready: 'border-rose-300 bg-rose-50 text-rose-700',
};

const toDateLabel = (value) => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return new Intl.DateTimeFormat('ms-MY', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
};

const TournamentBracketPreparationSection = ({ tournament, tournamentId, userId }) => {
  const [isSnapshotConfirmOpen, setIsSnapshotConfirmOpen] = useState(false);
  const [isRunConfirmOpen, setIsRunConfirmOpen] = useState(false);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [isRebuildConfirmOpen, setIsRebuildConfirmOpen] = useState(false);
  const [isStartNewRunConfirmOpen, setIsStartNewRunConfirmOpen] = useState(false);
  const [resetTargetMatch, setResetTargetMatch] = useState(null);
  const [finalizeError, setFinalizeError] = useState('');
  const [scoreDrafts, setScoreDrafts] = useState({});
  const [scoreErrors, setScoreErrors] = useState({});
  const autoCommitInFlightRef = useRef({});

  const {
    data: participants = [],
    isLoading: isLoadingParticipants,
    isError: participantsError,
    error: participantsErrorData,
  } = useTournamentParticipants({ tournamentId, userId });

  const {
    data: latestSnapshot,
    isLoading: isLoadingSnapshot,
    isError: snapshotError,
    error: snapshotErrorData,
  } = useLatestTournamentBracketSnapshot({ tournamentId, userId });

  const {
    data: latestRun,
    isLoading: isLoadingRun,
    isError: runError,
    error: runErrorData,
  } = useLatestTournamentBracketRun({ tournamentId, userId });

  const {
    data: runMatches = [],
    isLoading: isLoadingRunMatches,
    isError: runMatchesError,
    error: runMatchesErrorData,
  } = useBracketRunMatches({ runId: latestRun?.id, userId });
  const {
    data: startNewRunEligibility,
  } = useCanStartNewRunFromSnapshot({ tournamentId, userId });

  const prepareSnapshotMutation = usePrepareTournamentBracketSnapshot({ tournamentId, userId });
  const createRunMutation = useCreateBracketRunFromSnapshot({ tournamentId, userId });
  const assignWinnerMutation = useAssignTournamentMatchWinner({
    tournamentId,
    userId,
    runId: latestRun?.id,
  });
  const resetMatchMutation = useResetTournamentMatchResult({
    tournamentId,
    userId,
    runId: latestRun?.id,
  });
  const rebuildRunMutation = useRebuildBracketRunFromPreparedSnapshot({
    tournamentId,
    userId,
  });
  const startNewRunMutation = useStartNewRunFromPreparedSnapshot({
    tournamentId,
    userId,
  });
  const finalizeRunMutation = useFinalizeTournamentBracketRun({
    tournamentId,
    userId,
    runId: latestRun?.id,
  });

  const readiness = useMemo(
    () => validateBracketPreparationReadiness({ tournament, participants }),
    [tournament, participants]
  );

  const readinessClass = readinessClassMap[readiness.level] || readinessClassMap.not_ready;
  const hasPreparedSnapshot = latestSnapshot?.snapshot_status === 'prepared';
  const groupedRounds = useMemo(() => groupMatchesByRound(runMatches), [runMatches]);
  const runMatchesById = useMemo(
    () => Object.fromEntries((Array.isArray(runMatches) ? runMatches : []).map((match) => [match.id, match])),
    [runMatches]
  );
  const visualRounds = useMemo(
    () => buildVisualBracketRounds({
      groupedRounds,
      totalRounds: Number(latestRun?.total_rounds || 0),
    }),
    [groupedRounds, latestRun?.total_rounds]
  );
  const completionSummary = useMemo(
    () => getRunCompletionSummary({ run: latestRun, matches: runMatches, participants }),
    [latestRun, runMatches, participants]
  );
  const runIsFinalized = isRunFinalized(latestRun);
  const canFinalizeRun = Boolean(latestRun?.id && completionSummary.canFinalize && !runIsFinalized);
  const canRebuildRun = Boolean(
    latestRun?.id
    && hasPreparedSnapshot
    && latestSnapshot?.snapshot_status === 'prepared'
    && !runIsFinalized
  );
  const canStartNewRun = Boolean(startNewRunEligibility?.canStart);
  const normalizedMatchFormat = normalizeMatchFormat(tournament?.match_format);
  const tournamentDisplayStatus = getDisplayTournamentStatus(tournament, latestRun);
  const bracketStatusLabel = useMemo(() => {
    if (!latestRun?.id) {
      if (hasPreparedSnapshot) return 'PREPARED';
      return 'NOT GENERATED';
    }

    const runStatus = String(latestRun?.status || '').trim().toLowerCase();
    if (runStatus === 'completed') return 'COMPLETED';
    if (runStatus === 'prepared' || runStatus === 'draft') {
      if (Number(completionSummary.completedMatchCount || 0) > 0) return 'ACTIVE';
      return 'PREPARED';
    }

    return String(runStatus || 'PREPARED').toUpperCase();
  }, [
    completionSummary.completedMatchCount,
    hasPreparedSnapshot,
    latestRun?.id,
    latestRun?.status,
  ]);

  const handlePrepareSnapshot = async (forceReprepare) => {
    try {
      await prepareSnapshotMutation.mutateAsync({
        tournament,
        forceReprepare,
      });
      toast.success(forceReprepare ? 'New bracket snapshot prepared.' : 'Bracket snapshot prepared.');
      setIsSnapshotConfirmOpen(false);
    } catch (mutationError) {
      const message = String(mutationError?.message || '').trim();
      toast.error(message || 'Failed to prepare bracket snapshot.');
    }
  };

  const handlePrepareClick = () => {
    if (hasPreparedSnapshot) {
      setIsSnapshotConfirmOpen(true);
      return;
    }
    handlePrepareSnapshot(false);
  };

  const handleGenerateRun = async (forceRegenerate) => {
    try {
      const result = await createRunMutation.mutateAsync({ forceRegenerate });
      if (result?.reused) {
        toast.success('Bracket structure already exists for latest snapshot.');
      } else {
        toast.success('Bracket structure generated.');
      }
      setIsRunConfirmOpen(false);
    } catch (mutationError) {
      const message = String(mutationError?.message || '').trim();
      toast.error(message || 'Failed to generate bracket structure.');
    }
  };

  const handleGenerateRunClick = () => {
    if (!latestSnapshot?.id || latestSnapshot.snapshot_status !== 'prepared') {
      toast.error('Prepare snapshot first.');
      return;
    }

    if (latestRun?.id && latestRun.status === 'prepared' && latestRun.snapshot_id !== latestSnapshot.id) {
      setIsRunConfirmOpen(true);
      return;
    }

    handleGenerateRun(false);
  };

  const clearLocalScoreState = (matchId) => {
    setScoreDrafts((prev) => {
      if (!prev?.[matchId]) return prev;
      const next = { ...(prev || {}) };
      delete next[matchId];
      return next;
    });
    setScoreErrors((prev) => {
      if (!prev?.[matchId]) return prev;
      const next = { ...(prev || {}) };
      delete next[matchId];
      return next;
    });
  };

  const handleAssignWinner = async ({
    matchId,
    selectedSide,
    scoreA,
    scoreB,
    silentSuccess = false,
  }) => {
    try {
      const result = await assignWinnerMutation.mutateAsync({
        matchId,
        selectedSide,
        scoreA,
        scoreB,
        matchFormat: tournament?.match_format,
      });
      if (result?.reused) {
        if (!silentSuccess) {
          toast.success('Winner already set for this match.');
        }
        return;
      }
      clearLocalScoreState(matchId);
      if (!silentSuccess) {
        toast.success('Winner saved and propagated.');
      }
    } catch (mutationError) {
      const message = String(mutationError?.message || '').trim();
      toast.error(message || 'Failed to assign match winner.');
    }
  };

  const getScoreDraft = (match) => {
    const draft = scoreDrafts?.[match.id] || {};
    return {
      scoreA: draft.scoreA ?? (Number.isInteger(match?.score_a) ? String(match.score_a) : ''),
      scoreB: draft.scoreB ?? (Number.isInteger(match?.score_b) ? String(match.score_b) : ''),
    };
  };

  const tryAutoCommitInlineScore = async ({ matchId, scoreA, scoreB }) => {
    const match = runMatchesById?.[matchId];
    if (!match || runIsFinalized) return;
    if (!canAssignWinner(match)) return;
    if (isManualWinnerAllowed(normalizedMatchFormat)) return;
    if (assignWinnerMutation.isPending) return;

    const evaluation = evaluateMatchScoreState({
      matchFormat: normalizedMatchFormat,
      scoreA,
      scoreB,
    });

    if (evaluation.state !== 'complete' || !evaluation.normalized) return;

    const signature = `${normalizedMatchFormat}:${evaluation.normalized.scoreA}-${evaluation.normalized.scoreB}`;
    if (autoCommitInFlightRef.current?.[matchId] === signature) return;

    const currentScoreA = Number.isInteger(match.score_a) ? match.score_a : null;
    const currentScoreB = Number.isInteger(match.score_b) ? match.score_b : null;
    const currentWinnerSide = String(match?.winner_source_slot || '').trim().toUpperCase();

    if (
      currentScoreA === evaluation.normalized.scoreA
      && currentScoreB === evaluation.normalized.scoreB
      && currentWinnerSide === evaluation.normalized.winnerSide
    ) {
      return;
    }

    autoCommitInFlightRef.current = {
      ...(autoCommitInFlightRef.current || {}),
      [matchId]: signature,
    };

    try {
      await handleAssignWinner({
        matchId,
        selectedSide: evaluation.normalized.winnerSide,
        scoreA: evaluation.normalized.scoreA,
        scoreB: evaluation.normalized.scoreB,
        silentSuccess: true,
      });
    } finally {
      const latest = { ...(autoCommitInFlightRef.current || {}) };
      if (latest[matchId] === signature) {
        delete latest[matchId];
        autoCommitInFlightRef.current = latest;
      }
    }
  };

  const handleScoreDraftChange = (matchId, fieldKey, nextValue) => {
    const match = runMatchesById?.[matchId];
    if (!match) return;
    const safeValue = String(nextValue || '').replace(/[^0-9]/g, '');
    const previousDraft = scoreDrafts?.[matchId] || {};
    const nextDraft = {
      ...previousDraft,
      [fieldKey]: safeValue,
    };

    const nextScoreA = nextDraft.scoreA ?? (Number.isInteger(match?.score_a) ? String(match.score_a) : '');
    const nextScoreB = nextDraft.scoreB ?? (Number.isInteger(match?.score_b) ? String(match.score_b) : '');
    const evaluation = evaluateMatchScoreState({
      matchFormat: normalizedMatchFormat,
      scoreA: nextScoreA,
      scoreB: nextScoreB,
    });

    setScoreDrafts((prev) => ({
      ...(prev || {}),
      [matchId]: nextDraft,
    }));

    setScoreErrors((prev) => {
      const next = { ...(prev || {}) };
      if (evaluation.state === 'invalid') {
        next[matchId] = evaluation.reason || 'Invalid score input.';
      } else {
        delete next[matchId];
      }
      return next;
    });

    if (evaluation.state === 'complete') {
      void tryAutoCommitInlineScore({
        matchId,
        scoreA: nextScoreA,
        scoreB: nextScoreB,
      });
    }
  };

  const handleResetMatch = async () => {
    if (!resetTargetMatch?.id) {
      setIsResetConfirmOpen(false);
      return;
    }

    try {
      await resetMatchMutation.mutateAsync({ matchId: resetTargetMatch.id });
      toast.success('Match reopened successfully.');
      clearLocalScoreState(resetTargetMatch.id);
      setResetTargetMatch(null);
      setIsResetConfirmOpen(false);
    } catch (mutationError) {
      const message = String(mutationError?.message || '').trim();
      toast.error(message || 'Failed to reopen match.');
    }
  };

  const handleRebuildRun = async () => {
    try {
      await rebuildRunMutation.mutateAsync();
      toast.success('Bracket rebuilt from latest prepared snapshot.');
      setIsRebuildConfirmOpen(false);
    } catch (mutationError) {
      const message = String(mutationError?.message || '').trim();
      toast.error(message || 'Failed to rebuild bracket run.');
    }
  };

  const handleFinalizeRun = async () => {
    setFinalizeError('');
    try {
      await finalizeRunMutation.mutateAsync();
      toast.success('Tournament run finalized and locked.');
    } catch (mutationError) {
      const message = String(mutationError?.message || '').trim();
      setFinalizeError(message || 'Failed to finalize tournament run.');
      toast.error(message || 'Failed to finalize tournament run.');
    }
  };

  const handleStartNewRun = async () => {
    try {
      await startNewRunMutation.mutateAsync();
      toast.success('New run started from latest prepared snapshot.');
      setIsStartNewRunConfirmOpen(false);
    } catch (mutationError) {
      const message = String(mutationError?.message || '').trim();
      toast.error(message || 'Failed to start new run.');
    }
  };

  const renderOrganizerInlineControls = (viewMatch) => {
    const match = runMatchesById?.[viewMatch?.id];
    if (!match) return null;

    const winnerOptions = getWinnerActionOptions(match);
    const matchSupportsManualWinner = isManualWinnerAllowed(normalizedMatchFormat);
    const supportsScoreInput = !matchSupportsManualWinner && String(match.match_status || '').trim() !== 'bye';
    const allowedWinnerOptions = winnerOptions.filter((option) => (
      matchSupportsManualWinner || option.value === 'BYE'
    ));
    const allowWinnerAction = !runIsFinalized && canAssignWinner(match) && allowedWinnerOptions.length > 0;
    const allowScoreEntry = !runIsFinalized && canAssignWinner(match) && supportsScoreInput;
    const allowResetAction = !runIsFinalized && canResetMatch(match);
    const isUpdatingThisMatch = assignWinnerMutation.isPending
      && assignWinnerMutation.variables?.matchId === match.id;
    const isResettingThisMatch = resetMatchMutation.isPending
      && resetMatchMutation.variables?.matchId === match.id;
    const scoreDraft = getScoreDraft(match);
    const scoreError = scoreErrors?.[match.id] || '';
    const scoreEvaluation = evaluateMatchScoreState({
      matchFormat: normalizedMatchFormat,
      scoreA: scoreDraft.scoreA,
      scoreB: scoreDraft.scoreB,
    });
    const showIncompleteHint = allowScoreEntry
      && !scoreError
      && (scoreEvaluation.state === 'incomplete' || scoreEvaluation.state === 'empty');

    return (
      <div className="space-y-2">
        {allowWinnerAction ? (
          <div className="flex flex-wrap gap-1.5">
            {allowedWinnerOptions.map((option) => (
              <Button
                key={`${match.id}-${option.value}`}
                type="button"
                size="sm"
                variant={option.value === 'BYE' ? 'default' : 'outline'}
                className={option.value === 'BYE' ? 'brand-gradient brand-gradient-hover text-white' : undefined}
                disabled={assignWinnerMutation.isPending}
                onClick={() => handleAssignWinner({ matchId: match.id, selectedSide: option.value })}
              >
                {isUpdatingThisMatch ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Saving...
                  </>
                ) : option.label}
              </Button>
            ))}
          </div>
        ) : null}

        {allowScoreEntry ? (
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              className="h-8 rounded-md border border-input bg-white px-2 text-sm"
              value={scoreDraft.scoreA}
              onChange={(event) => handleScoreDraftChange(match.id, 'scoreA', event.target.value)}
              disabled={assignWinnerMutation.isPending}
              aria-label={`Score ${match.participant_a_name || 'Participant A'}`}
            />
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              className="h-8 rounded-md border border-input bg-white px-2 text-sm"
              value={scoreDraft.scoreB}
              onChange={(event) => handleScoreDraftChange(match.id, 'scoreB', event.target.value)}
              disabled={assignWinnerMutation.isPending}
              aria-label={`Score ${match.participant_b_name || 'Participant B'}`}
            />
          </div>
        ) : null}

        {scoreError ? (
          <p className="text-[11px] text-rose-700">{scoreError}</p>
        ) : null}

        {showIncompleteHint ? (
          <p className="text-[11px] text-muted-foreground">
            {scoreEvaluation.reason || 'Enter complete result to auto-commit.'}
          </p>
        ) : null}

        {allowResetAction ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            disabled={resetMatchMutation.isPending || assignWinnerMutation.isPending}
            onClick={() => {
              setResetTargetMatch(match);
              setIsResetConfirmOpen(true);
            }}
          >
            {isResettingThisMatch ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Reopening...
              </>
            ) : (
              'Reopen Match'
            )}
          </Button>
        ) : null}

        {!allowWinnerAction && !allowResetAction && !allowScoreEntry ? (
          <p className="text-[11px] text-muted-foreground">
            {runIsFinalized
              ? 'Run finalized. Match edits are locked.'
              : 'Match is not ready yet.'}
          </p>
        ) : null}
      </div>
    );
  };

  const isLoading = isLoadingParticipants || isLoadingSnapshot || isLoadingRun;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading bracket preparation data...
        </CardContent>
      </Card>
    );
  }

  if (participantsError || snapshotError || runError || runMatchesError) {
    return (
      <Card className="border-rose-300">
        <CardContent className="py-6 text-sm text-rose-700">
          Failed to load bracket preparation state. {' '}
          {participantsErrorData?.message || snapshotErrorData?.message || runErrorData?.message || runMatchesErrorData?.message || ''}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-primary/20">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Bracket Preparation</CardTitle>
              <CardDescription>
                Step 1: Freeze participant + seed input. Step 2: Generate bracket structure. Step 3: Assign winners and reopen safely when needed.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                className="brand-gradient brand-gradient-hover text-white"
                disabled={!readiness.supportedBracket || prepareSnapshotMutation.isPending || runIsFinalized}
                onClick={handlePrepareClick}
              >
                {prepareSnapshotMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Preparing...
                  </>
                ) : (
                  'Prepare Snapshot'
                )}
              </Button>

              <Button
                type="button"
                variant="outline"
                disabled={
                  !readiness.supportedBracket
                  || !hasPreparedSnapshot
                  || createRunMutation.isPending
                  || latestSnapshot?.snapshot_status !== 'prepared'
                  || runIsFinalized
                }
                onClick={handleGenerateRunClick}
              >
                {createRunMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  'Generate Bracket Structure'
                )}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className={`rounded-lg border px-3 py-2 text-sm font-medium ${readinessClass}`}>
            {readiness.message}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-lg border bg-muted/20 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Bracket Type</p>
              <p className="text-sm font-semibold">{getBracketTypeLabel(tournament?.bracket_type)}</p>
            </div>
            <div className="rounded-lg border bg-muted/20 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Active</p>
              <p className="text-sm font-semibold">{readiness.activeCount}</p>
            </div>
            <div className="rounded-lg border bg-muted/20 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Seeded</p>
              <p className="text-sm font-semibold">{readiness.seededCount}</p>
            </div>
            <div className="rounded-lg border bg-muted/20 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Unseeded</p>
              <p className="text-sm font-semibold">{readiness.unseededCount}</p>
            </div>
            <div className="rounded-lg border bg-muted/20 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Duplicate Seeds</p>
              <p className="text-sm font-semibold">{readiness.duplicateSeeds.length}</p>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-lg border bg-muted/20 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Tournament Status</p>
              <p className="text-sm font-semibold">{String(tournamentDisplayStatus || '-').toUpperCase()}</p>
            </div>
            <div className="rounded-lg border bg-muted/20 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Bracket Status</p>
              <p className="text-sm font-semibold">{bracketStatusLabel}</p>
            </div>
            <div className="rounded-lg border bg-muted/20 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Match Format</p>
              <p className="text-sm font-semibold">{getMatchFormatDisplayLabel(tournament?.match_format)}</p>
            </div>
          </div>

          {!readiness.supportedBracket ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-700">
              Current bracket type is not yet supported for run generation. Supported in this phase: Single Elimination.
            </div>
          ) : null}
        </CardContent>
      </Card>

      {runIsFinalized ? (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          Run is finalized and locked. Winner edits, reopen actions, and rebuild are disabled.
        </div>
      ) : null}

      {latestSnapshot ? (
        <Card className="border-primary/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Latest Snapshot</CardTitle>
            <CardDescription>
              Created: {toDateLabel(latestSnapshot.created_at)} | Status: {latestSnapshot.snapshot_status}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-lg border bg-muted/20 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Participants</p>
              <p className="text-sm font-semibold">{latestSnapshot.participant_count}</p>
            </div>
            <div className="rounded-lg border bg-muted/20 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Seeded</p>
              <p className="text-sm font-semibold">{latestSnapshot.seeded_count}</p>
            </div>
            <div className="rounded-lg border bg-muted/20 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Bracket Type</p>
              <p className="text-sm font-semibold">{getBracketTypeLabel(latestSnapshot.bracket_type)}</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-dashed border-primary/30">
          <CardContent className="py-8 text-center">
            <ShieldAlert className="mx-auto h-6 w-6 text-primary/70" />
            <p className="mt-2 text-sm font-semibold">No snapshot prepared yet</p>
            <p className="text-sm text-muted-foreground">
              Prepare snapshot after seeding is complete before generating bracket structure.
            </p>
          </CardContent>
        </Card>
      )}

      {latestRun ? (
        <Card className="border-primary/20">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">Bracket Run</CardTitle>
                <CardDescription>
                  Created: {toDateLabel(latestRun.created_at)} | Status: {latestRun.status}
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canRebuildRun || rebuildRunMutation.isPending}
                  onClick={() => setIsRebuildConfirmOpen(true)}
                >
                  {rebuildRunMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                      Rebuilding...
                    </>
                  ) : (
                    'Rebuild From Snapshot'
                  )}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canStartNewRun || startNewRunMutation.isPending}
                  onClick={() => setIsStartNewRunConfirmOpen(true)}
                >
                  {startNewRunMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                      Starting...
                    </>
                  ) : (
                    'Start New Run'
                  )}
                </Button>

                <Button
                  type="button"
                  size="sm"
                  className="brand-gradient brand-gradient-hover text-white"
                  disabled={!canFinalizeRun || finalizeRunMutation.isPending}
                  onClick={handleFinalizeRun}
                >
                  {finalizeRunMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                      Finalizing...
                    </>
                  ) : (
                    'Finalize Tournament'
                  )}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <div className="rounded-lg border bg-muted/20 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Completion</p>
                <p className="text-sm font-semibold">{completionSummary.progressLabel}</p>
              </div>
              <div className="rounded-lg border bg-muted/20 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Champion</p>
                <p className="text-sm font-semibold">{completionSummary.championName || '-'}</p>
              </div>
              <div className="rounded-lg border bg-muted/20 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Completed At</p>
                <p className="text-sm font-semibold">{completionSummary.completedAt ? toDateLabel(completionSummary.completedAt) : '-'}</p>
              </div>
              <div className="rounded-lg border bg-muted/20 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Round Count</p>
                <p className="text-sm font-semibold">{latestRun.total_rounds}</p>
              </div>
              <div className="rounded-lg border bg-muted/20 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Participants</p>
                <p className="text-sm font-semibold">{latestRun.participant_count}</p>
              </div>
              <div className="rounded-lg border bg-muted/20 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Bracket Type</p>
                <p className="text-sm font-semibold">{getBracketTypeLabel(latestRun.bracket_type)}</p>
              </div>
            </div>

            {!runIsFinalized && !completionSummary.canFinalize ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                {completionSummary.finalizeReason || 'Run is not ready for finalization yet.'}
              </div>
            ) : null}

            {finalizeError ? (
              <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {finalizeError}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <Card className="border-dashed border-primary/30">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No bracket run generated yet. Use "Generate Bracket Structure" after snapshot is prepared.
          </CardContent>
        </Card>
      )}

      {latestRun ? (
        <div className="rounded-lg border border-cyan-200 bg-cyan-50/40 px-3 py-3 text-sm">
          <p className="font-semibold text-cyan-800">Run Actions</p>
          <p className="mt-1 text-cyan-700">
            <span className="font-medium">Match Result Mode</span>: {isManualWinnerAllowed(normalizedMatchFormat)
              ? 'BO1 quick winner buttons enabled.'
              : `${normalizedMatchFormat.toUpperCase()} score entry enabled (winner auto-derived).`}
          </p>
          <p className="mt-1 text-cyan-700">
            <span className="font-medium">Rebuild From Snapshot</span>: correction flow for current run context.
          </p>
          <p className="text-cyan-700">
            <span className="font-medium">Start New Run</span>: creates a fresh run and preserves existing run history.
          </p>
          {startNewRunEligibility?.reason ? (
            <p className="mt-1 text-xs text-cyan-700">{startNewRunEligibility.reason}</p>
          ) : null}
        </div>
      ) : null}

      {latestRun?.id && latestSnapshot?.id && latestRun.snapshot_id !== latestSnapshot.id && !runIsFinalized ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          Current prepared run uses an older snapshot. Use "Generate Bracket Structure" to refresh structure from latest snapshot.
        </div>
      ) : null}

      {latestRun ? (
        <Card className="border-primary/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Playable Bracket Flow</CardTitle>
            <CardDescription>
              Organizer actions are now inline inside each bracket card.
              BO3/BO5 auto-commits when score reaches a valid complete result.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingRunMatches ? (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading run matches...
              </div>
            ) : groupedRounds.length === 0 ? (
              <div className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
                No match skeleton generated.
              </div>
            ) : (
              <div className="space-y-4">
                <SingleEliminationBracketView
                  rounds={visualRounds}
                  totalRounds={Number(latestRun.total_rounds || 0)}
                  mode="organizer"
                  isFinalized={runIsFinalized}
                  renderOrganizerControls={renderOrganizerInlineControls}
                />
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      <AlertDialog open={isSnapshotConfirmOpen} onOpenChange={setIsSnapshotConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Create a fresh snapshot?</AlertDialogTitle>
            <AlertDialogDescription>
              A prepared snapshot already exists. Continuing will archive the current snapshot and generate a new one from latest seeding.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => handlePrepareSnapshot(true)}
              disabled={prepareSnapshotMutation.isPending}
            >
              {prepareSnapshotMutation.isPending ? 'Preparing...' : 'Create New Snapshot'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isRunConfirmOpen} onOpenChange={setIsRunConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regenerate bracket structure?</AlertDialogTitle>
            <AlertDialogDescription>
              A prepared bracket run already exists from an older snapshot. Continuing will archive existing prepared run and generate a new structure from latest snapshot.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => handleGenerateRun(true)}
              disabled={createRunMutation.isPending}
            >
              {createRunMutation.isPending ? 'Generating...' : 'Regenerate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={isResetConfirmOpen}
        onOpenChange={(open) => {
          setIsResetConfirmOpen(open);
          if (!open) {
            setResetTargetMatch(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reopen this match result?</AlertDialogTitle>
            <AlertDialogDescription>
              This will clear the winner on this match and remove propagated downstream slot only if it is still safe.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleResetMatch}
              disabled={resetMatchMutation.isPending}
            >
              {resetMatchMutation.isPending ? 'Reopening...' : 'Reopen Match'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isRebuildConfirmOpen} onOpenChange={setIsRebuildConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rebuild bracket from snapshot?</AlertDialogTitle>
            <AlertDialogDescription>
              This will archive current prepared run and generate a fresh run from the latest prepared snapshot.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRebuildRun}
              disabled={rebuildRunMutation.isPending}
            >
              {rebuildRunMutation.isPending ? 'Rebuilding...' : 'Rebuild Run'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isStartNewRunConfirmOpen} onOpenChange={setIsStartNewRunConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start new run from prepared snapshot?</AlertDialogTitle>
            <AlertDialogDescription>
              This creates a fresh run from the latest prepared snapshot and keeps previous run history intact.
              {startNewRunEligibility?.willArchivePreparedRun ? ' Current prepared run will be archived first.' : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleStartNewRun}
              disabled={startNewRunMutation.isPending}
            >
              {startNewRunMutation.isPending ? 'Starting...' : 'Start New Run'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default TournamentBracketPreparationSection;
