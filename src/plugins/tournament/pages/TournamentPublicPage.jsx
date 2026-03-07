import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { usePublicTournamentView } from '@/plugins/tournament/hooks/useTournamentPlugin';
import { buildVisualBracketRounds } from '@/plugins/tournament/config/bracketVisualModel';
import { getMatchFormatDisplayLabel } from '@/plugins/tournament/config/matchScoring';
import { getBracketTypeLabel } from '@/plugins/tournament/config/tournamentTemplates';
import { CalendarDays, Loader2, MapPin, Trophy, Users } from 'lucide-react';
import SingleEliminationBracketView from '@/plugins/tournament/components/bracket/SingleEliminationBracketView';

const statusClassMap = {
  ongoing: 'border-amber-300 bg-amber-50 text-amber-700',
  completed: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  unavailable: 'border-slate-300 bg-slate-100 text-slate-700',
};

const formatDateLabel = (value) => {
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

const TournamentPublicPage = () => {
  const { publicCode } = useParams();
  const {
    data: viewModel,
    isLoading,
    isError,
    error,
  } = usePublicTournamentView({ publicCode });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 md:p-8">
        <div className="mx-auto max-w-6xl">
          <Card>
            <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading tournament spectator view...
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 md:p-8">
        <div className="mx-auto max-w-6xl space-y-4">
          <Card className="border-rose-300">
            <CardContent className="py-8 text-sm text-rose-700">
              Failed to load public tournament view. {error?.message || 'Please retry later.'}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (!viewModel?.found) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 md:p-8">
        <div className="mx-auto max-w-6xl space-y-4">
          <Card className="border-dashed border-primary/30">
            <CardContent className="space-y-2 py-10 text-center">
              <p className="text-base font-semibold">Tournament tidak ditemui</p>
              <p className="text-sm text-muted-foreground">
                Public link tidak sah atau sudah tidak tersedia.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const tournament = viewModel.tournament;
  const displayRun = viewModel.displayRun;
  const summary = viewModel.summary;
  const groupedRounds = viewModel.groupedRounds || [];
  const visualRounds = buildVisualBracketRounds({
    groupedRounds,
    totalRounds: Number(displayRun?.total_rounds || 0),
  });
  const displayStatus = viewModel.displayStatus || 'unavailable';
  const statusClass = statusClassMap[displayStatus] || statusClassMap.unavailable;
  const championName = summary?.championName || displayRun?.champion_name || null;
  const isCompleted = displayStatus === 'completed';

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">RareBits Tournament Spectator</p>
            <h1 className="text-xl font-bold">{tournament?.name || 'Tournament'}</h1>
          </div>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClass}`}>
            {displayStatus.toUpperCase()}
          </span>
        </div>

        <Card className="border-primary/20">
          <CardContent className="grid gap-2 py-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-lg border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">Bracket</p>
              <p className="text-sm font-semibold">{getBracketTypeLabel(tournament?.bracket_type)}</p>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">Match Format</p>
              <p className="text-sm font-semibold">{getMatchFormatDisplayLabel(tournament?.match_format)}</p>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">Event Date</p>
              <p className="inline-flex items-center gap-1 text-sm font-semibold">
                <CalendarDays className="h-3.5 w-3.5 text-primary" />
                {formatDateLabel(tournament?.event_date)}
              </p>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">Venue</p>
              <p className="inline-flex items-center gap-1 text-sm font-semibold">
                <MapPin className="h-3.5 w-3.5 text-primary" />
                {tournament?.venue || '-'}
              </p>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">Participants</p>
              <p className="inline-flex items-center gap-1 text-sm font-semibold">
                <Users className="h-3.5 w-3.5 text-primary" />
                {summary?.participantCount ?? displayRun?.participant_count ?? tournament?.max_players ?? '-'}
              </p>
            </div>
          </CardContent>
        </Card>

        {isCompleted ? (
          <Card className="border-emerald-300 bg-emerald-50/60">
            <CardContent className="grid gap-2 py-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border bg-white/80 p-3">
                <p className="text-xs text-muted-foreground">Champion</p>
                <p className="text-sm font-semibold">{championName || '-'}</p>
              </div>
              <div className="rounded-lg border bg-white/80 p-3">
                <p className="text-xs text-muted-foreground">Runner-up</p>
                <p className="text-sm font-semibold">
                  {(() => {
                    const finalMatch = summary?.finalMatch;
                    if (!finalMatch?.winner_participant_name) return '-';
                    if (finalMatch.winner_participant_name === finalMatch.participant_a_name) {
                      return finalMatch.participant_b_name || '-';
                    }
                    if (finalMatch.winner_participant_name === finalMatch.participant_b_name) {
                      return finalMatch.participant_a_name || '-';
                    }
                    return '-';
                  })()}
                </p>
              </div>
              <div className="rounded-lg border bg-white/80 p-3">
                <p className="text-xs text-muted-foreground">Progress</p>
                <p className="text-sm font-semibold">{summary?.progressLabel || '-'}</p>
              </div>
              <div className="rounded-lg border bg-white/80 p-3">
                <p className="text-xs text-muted-foreground">Completed At</p>
                <p className="text-sm font-semibold">{formatDateLabel(summary?.completedAt || displayRun?.completed_at)}</p>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {!displayRun ? (
          <Card className="border-dashed border-primary/30">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Bracket belum tersedia untuk tontonan awam.
            </CardContent>
          </Card>
        ) : !viewModel.supportedBracket ? (
          <Card className="border-amber-300">
            <CardContent className="py-6 text-sm text-amber-700">
              Public bracket view currently supports Single Elimination only.
            </CardContent>
          </Card>
        ) : groupedRounds.length === 0 ? (
          <Card className="border-dashed border-primary/30">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Bracket structure belum dijana.
            </CardContent>
          </Card>
        ) : (
          <Card className="border-primary/20">
            <CardHeader>
              <CardTitle className="text-base">Live Bracket (Read-Only)</CardTitle>
              <CardDescription>
                Paparan bracket awam. Tiada tindakan edit dibenarkan.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SingleEliminationBracketView
                rounds={visualRounds}
                totalRounds={Number(displayRun.total_rounds || 0)}
                mode="readonly"
                isFinalized={isCompleted}
              />
            </CardContent>
          </Card>
        )}

        <div className="flex items-center justify-between gap-2 border-t pt-3">
          <p className="text-xs text-muted-foreground">
            Auto refresh setiap 15 saat.
          </p>
          <Button asChild size="sm" variant="outline">
            <Link to="/">Go to RareBits</Link>
          </Button>
        </div>
      </div>
    </div>
  );
};

export default TournamentPublicPage;
