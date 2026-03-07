import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  useTournamentBracketRunsHistory,
  useTournamentRunAuditEvents,
  useTournamentRunCompletionSummary,
} from '@/plugins/tournament/hooks/useTournamentPlugin';
import { isRunFinalized } from '@/plugins/tournament/config/runStatuses';
import { getBracketTypeLabel } from '@/plugins/tournament/config/tournamentTemplates';
import { Activity, History, Loader2, Trophy } from 'lucide-react';

const AUDIT_EVENT_LABELS = Object.freeze({
  run_created: 'Run created',
  run_archived: 'Run archived',
  run_completed: 'Run completed',
  run_rebuilt_from_snapshot: 'Run rebuilt from snapshot',
  new_run_started_from_snapshot: 'New run started from snapshot',
});

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

const getRunnerUpName = (finalMatch, championName) => {
  const champion = String(championName || '').trim();
  const a = String(finalMatch?.participant_a_name || '').trim();
  const b = String(finalMatch?.participant_b_name || '').trim();
  if (!champion || !a || !b) return null;
  if (champion === a) return b || null;
  if (champion === b) return a || null;
  return null;
};

const getAuditEventLabel = (eventType) => (
  AUDIT_EVENT_LABELS[String(eventType || '').trim()] || String(eventType || '').replaceAll('_', ' ')
);

const getRunStatusClassName = (status) => {
  const normalized = String(status || '').trim();
  if (normalized === 'completed') return 'border-emerald-300 bg-emerald-50 text-emerald-700';
  if (normalized === 'prepared') return 'border-cyan-300 bg-cyan-50 text-cyan-700';
  if (normalized === 'draft') return 'border-amber-300 bg-amber-50 text-amber-700';
  return 'border-slate-300 bg-slate-100 text-slate-700';
};

const TournamentResultsSummarySection = ({ tournamentId, userId, tournament }) => {
  const {
    data,
    isLoading,
    isError,
    error,
  } = useTournamentRunCompletionSummary({ tournamentId, userId });
  const {
    data: runHistory = [],
    isLoading: isRunHistoryLoading,
    isError: isRunHistoryError,
    error: runHistoryError,
  } = useTournamentBracketRunsHistory({ tournamentId, userId });
  const {
    data: runAuditEvents = [],
    isLoading: isRunAuditLoading,
    isError: isRunAuditError,
    error: runAuditError,
  } = useTournamentRunAuditEvents({ tournamentId, userId, limit: 20 });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading results summary...
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className="border-rose-300">
        <CardContent className="py-6 text-sm text-rose-700">
          Failed to load tournament results summary. {error?.message || 'Please retry.'}
        </CardContent>
      </Card>
    );
  }

  const run = data?.run || null;
  const summary = data?.summary || null;
  const finalMatch = summary?.finalMatch || null;
  const championName = summary?.championName || null;
  const runnerUpName = getRunnerUpName(finalMatch, championName);
  const finalized = isRunFinalized(run);
  const currentRunId = run?.id || runHistory?.[0]?.id || null;

  return (
    <div className="space-y-4">
      {!run?.id ? (
        <Card className="border-dashed border-primary/30">
          <CardContent className="space-y-2 py-8 text-center">
            <Trophy className="mx-auto h-6 w-6 text-primary/70" />
            <p className="text-sm font-semibold">No bracket run available yet</p>
            <p className="text-sm text-muted-foreground">
              Generate bracket structure and progress matches before results can be summarized.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="border-primary/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Tournament Results Summary</CardTitle>
              <CardDescription>
                Completion state for current bracket run.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">Champion</p>
                <p className="text-sm font-semibold">{championName || '-'}</p>
              </div>
              <div className="rounded-lg border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">Runner-up</p>
                <p className="text-sm font-semibold">{runnerUpName || '-'}</p>
              </div>
              <div className="rounded-lg border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">Run Status</p>
                <p className="text-sm font-semibold">{String(run?.status || '-').toUpperCase()}</p>
              </div>
              <div className="rounded-lg border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">Completed At</p>
                <p className="text-sm font-semibold">{toDateLabel(summary?.completedAt)}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-primary/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Bracket Summary</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">Bracket Type</p>
                <p className="text-sm font-semibold">{getBracketTypeLabel(run?.bracket_type || tournament?.bracket_type)}</p>
              </div>
              <div className="rounded-lg border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">Participants</p>
                <p className="text-sm font-semibold">{summary?.participantCount ?? '-'}</p>
              </div>
              <div className="rounded-lg border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">Total Rounds</p>
                <p className="text-sm font-semibold">{summary?.totalRounds ?? '-'}</p>
              </div>
              <div className="rounded-lg border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">Progress</p>
                <p className="text-sm font-semibold">{summary?.progressLabel || '-'}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-primary/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Final Match</CardTitle>
              <CardDescription>
                {finalized ? 'Tournament run is finalized and locked.' : 'Tournament run is not finalized yet.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="rounded-lg border bg-muted/20 p-3">
                <p>
                  <span className="text-muted-foreground">Match:</span>{' '}
                  {finalMatch ? `Round ${finalMatch.round_index} - Match ${finalMatch.match_index}` : '-'}
                </p>
                <p>
                  <span className="text-muted-foreground">Participants:</span>{' '}
                  {finalMatch ? `${finalMatch.participant_a_name || 'TBD'} vs ${finalMatch.participant_b_name || 'TBD'}` : '-'}
                </p>
                <p>
                  <span className="text-muted-foreground">Winner:</span>{' '}
                  {finalMatch?.winner_participant_name || '-'}
                </p>
                <p>
                  <span className="text-muted-foreground">Score:</span>{' '}
                  {Number.isInteger(finalMatch?.score_a) && Number.isInteger(finalMatch?.score_b)
                    ? `${finalMatch.score_a}-${finalMatch.score_b}`
                    : '-'}
                </p>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <Card className="border-primary/20">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4 text-primary" />
            Run History
          </CardTitle>
          <CardDescription>Historical runs are preserved. Latest run is marked as current.</CardDescription>
        </CardHeader>
        <CardContent>
          {isRunHistoryLoading ? (
            <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading run history...
            </div>
          ) : isRunHistoryError ? (
            <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              Failed to load run history. {runHistoryError?.message || ''}
            </div>
          ) : runHistory.length === 0 ? (
            <div className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
              No run history available yet.
            </div>
          ) : (
            <div className="space-y-2">
              {runHistory.map((historyRun) => {
                const isCurrent = historyRun.id === currentRunId;
                return (
                  <div key={historyRun.id} className="rounded-lg border bg-muted/10 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${getRunStatusClassName(historyRun.status)}`}>
                          {String(historyRun.status || '').toUpperCase()}
                        </span>
                        {isCurrent ? (
                          <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                            CURRENT
                          </span>
                        ) : null}
                        <span className="text-xs text-muted-foreground">Run ID: {String(historyRun.id).slice(0, 8)}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Created {toDateLabel(historyRun.created_at)}
                      </p>
                    </div>
                    <div className="mt-1 grid gap-1 text-xs text-muted-foreground sm:grid-cols-3">
                      <p>Champion: <span className="font-medium text-foreground">{historyRun.champion_name || '-'}</span></p>
                      <p>Bracket: <span className="font-medium text-foreground">{getBracketTypeLabel(historyRun.bracket_type)}</span></p>
                      <p>Completed: <span className="font-medium text-foreground">{toDateLabel(historyRun.completed_at)}</span></p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-primary/20">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-primary" />
            Recent Run Lifecycle Events
          </CardTitle>
          <CardDescription>Minimal audit trail for run transitions and lifecycle actions.</CardDescription>
        </CardHeader>
        <CardContent>
          {isRunAuditLoading ? (
            <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading audit trail...
            </div>
          ) : isRunAuditError ? (
            <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              Failed to load run audit events. {runAuditError?.message || ''}
            </div>
          ) : runAuditEvents.length === 0 ? (
            <div className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
              No run lifecycle events logged yet.
            </div>
          ) : (
            <div className="space-y-2">
              {runAuditEvents.map((event) => (
                <div key={event.id} className="rounded-lg border bg-muted/10 px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{getAuditEventLabel(event.event_type)}</p>
                    <p className="text-xs text-muted-foreground">{toDateLabel(event.created_at)}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {event.event_note || '-'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default TournamentResultsSummarySection;
