import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/SupabaseAuthContext.jsx';
import { useLatestTournamentBracketRun, useTournamentDetail } from '@/plugins/tournament/hooks/useTournamentPlugin';
import TournamentParticipantsSection from '@/plugins/tournament/components/participants/TournamentParticipantsSection';
import TournamentBracketPreparationSection from '@/plugins/tournament/components/bracket/TournamentBracketPreparationSection';
import TournamentResultsSummarySection from '@/plugins/tournament/components/results/TournamentResultsSummarySection';
import { getMatchFormatDisplayLabel } from '@/plugins/tournament/config/matchScoring';
import { getBracketTypeLabel } from '@/plugins/tournament/config/tournamentTemplates';
import { getDisplayTournamentStatus } from '@/plugins/tournament/config/tournamentStatus';
import { ArrowLeft, CalendarDays, Copy, ExternalLink, Loader2, MapPin, Trophy } from 'lucide-react';

const statusClassMap = {
  draft: 'border-slate-300 bg-slate-100 text-slate-700',
  ready: 'border-cyan-300 bg-cyan-50 text-cyan-700',
  ongoing: 'border-amber-300 bg-amber-50 text-amber-700',
  completed: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  cancelled: 'border-rose-300 bg-rose-50 text-rose-700',
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

const TournamentDetailPage = () => {
  const { tournamentId } = useParams();
  const { user } = useAuth();
  const userId = user?.id;

  const {
    data: tournament,
    isLoading,
    isError,
    error,
  } = useTournamentDetail({ tournamentId, userId });
  const { data: latestBracketRun } = useLatestTournamentBracketRun({ tournamentId, userId });

  const statusKey = getDisplayTournamentStatus(tournament, latestBracketRun);
  const templateName = tournament?.tournament_templates?.name || tournament?.settings_json?.template_name || '-';
  const publicLink = tournament?.public_code
    ? `${window.location.origin}/tournament/${tournament.public_code}`
    : '';

  const handleCopyPublicLink = async () => {
    if (!publicLink) return;
    try {
      await navigator.clipboard.writeText(publicLink);
    } catch (_) {
      // No-op fallback for unsupported clipboard env.
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button asChild variant="outline" size="sm">
          <Link to="/plugins/tournament">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Kembali Ke Tournament
          </Link>
        </Button>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Memuatkan detail tournament...
          </CardContent>
        </Card>
      ) : null}

      {!isLoading && isError ? (
        <Card className="border-rose-300">
          <CardContent className="py-6 text-sm text-rose-700">
            Gagal memuatkan detail tournament. {error?.message || 'Sila cuba semula.'}
          </CardContent>
        </Card>
      ) : null}

      {!isLoading && !isError && !tournament ? (
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            Tournament tidak dijumpai.
          </CardContent>
        </Card>
      ) : null}

      {!isLoading && !isError && tournament ? (
        <div className="space-y-4">
          <Card className="border-primary/20">
            <CardContent className="space-y-4 py-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h1 className="text-xl font-bold">{tournament?.name || '-'}</h1>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1 rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-cyan-700">
                      <Trophy className="h-3 w-3" />
                      {templateName}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="h-3.5 w-3.5 text-primary" />
                      {formatDateLabel(tournament?.event_date)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5 text-primary" />
                      {tournament?.venue || '-'}
                    </span>
                    {publicLink ? (
                      <>
                        <a
                          href={publicLink}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-primary hover:bg-primary/15"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Public View
                        </a>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-full border border-border bg-white px-2 py-0.5 text-foreground hover:bg-muted"
                          onClick={handleCopyPublicLink}
                        >
                          <Copy className="h-3.5 w-3.5" />
                          Copy Link
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
                <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClassMap[statusKey] || statusClassMap.draft}`}>
                  {statusKey.toUpperCase()}
                </span>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">Bracket</p>
                  <p className="text-sm font-semibold">{getBracketTypeLabel(tournament?.bracket_type)}</p>
                </div>
                <div className="rounded-lg border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">Max Participants</p>
                  <p className="text-sm font-semibold">{tournament?.max_players ?? '-'}</p>
                </div>
                <div className="rounded-lg border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">Match Format</p>
                  <p className="text-sm font-semibold">{getMatchFormatDisplayLabel(tournament?.match_format)}</p>
                </div>
                <div className="rounded-lg border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">Round Time</p>
                  <p className="text-sm font-semibold">{tournament?.round_time_minutes ?? '-'} min</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Tabs defaultValue="participants" className="space-y-4">
            <TabsList className="h-auto w-full flex-wrap justify-start gap-2 rounded-xl bg-cyan-50/70 p-2">
              <TabsTrigger value="overview" className="rounded-full">Overview</TabsTrigger>
              <TabsTrigger value="participants" className="rounded-full">Participants</TabsTrigger>
              <TabsTrigger value="bracket" className="rounded-full">Bracket</TabsTrigger>
              <TabsTrigger value="results" className="rounded-full">Results</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-0 space-y-3">
              <Card className="border-primary/20">
                <CardContent className="space-y-3 py-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg border p-3">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Tournament Notes</p>
                      <p className="mt-1 text-sm">{tournament?.notes || '-'}</p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Entry Fee</p>
                      <p className="mt-1 text-sm font-semibold">RM {Number(tournament?.entry_fee || 0).toFixed(2)}</p>
                    </div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Settings Snapshot</p>
                    <pre className="mt-2 max-h-60 overflow-auto rounded-md bg-muted/30 p-3 text-xs">
                      {JSON.stringify(tournament?.settings_json || {}, null, 2)}
                    </pre>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="participants" className="mt-0">
              <TournamentParticipantsSection
                tournamentId={tournamentId}
                userId={userId}
                maxPlayers={tournament?.max_players}
              />
            </TabsContent>

            <TabsContent value="bracket" className="mt-0">
              <TournamentBracketPreparationSection
                tournament={tournament}
                tournamentId={tournamentId}
                userId={userId}
              />
            </TabsContent>

            <TabsContent value="results" className="mt-0">
              <TournamentResultsSummarySection
                tournamentId={tournamentId}
                userId={userId}
                tournament={tournament}
              />
            </TabsContent>
          </Tabs>
        </div>
      ) : null}
    </div>
  );
};

export default TournamentDetailPage;
