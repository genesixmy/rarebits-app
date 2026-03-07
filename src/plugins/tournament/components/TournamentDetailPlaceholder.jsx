import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getBracketTypeLabel } from '@/plugins/tournament/config/tournamentTemplates';

const statusClassMap = {
  draft: 'border-slate-300 bg-slate-100 text-slate-700',
  ready: 'border-cyan-300 bg-cyan-50 text-cyan-700',
  ongoing: 'border-amber-300 bg-amber-50 text-amber-700',
  completed: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  cancelled: 'border-rose-300 bg-rose-50 text-rose-700',
};

const SectionPlaceholder = ({ title, description }) => (
  <Card className="border-dashed border-primary/30">
    <CardHeader>
      <CardTitle className="text-base">{title}</CardTitle>
      <CardDescription>{description}</CardDescription>
    </CardHeader>
    <CardContent>
      <div className="rounded-lg bg-muted/40 p-4 text-sm text-muted-foreground">Coming next</div>
    </CardContent>
  </Card>
);

const TournamentDetailPlaceholder = ({ tournament }) => {
  const statusKey = String(tournament?.status || 'draft').toLowerCase();
  const settings = tournament?.settings_json || {};
  return (
    <div className="space-y-4">
      <Card className="border-primary/20">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>{tournament?.name}</CardTitle>
              <CardDescription className="mt-1">
                Template: {tournament?.tournament_templates?.name || settings?.template_name || '-'}
              </CardDescription>
            </div>
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClassMap[statusKey] || statusClassMap.draft}`}>
              {statusKey.toUpperCase()}
            </span>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Bracket</p>
            <p className="font-semibold">{getBracketTypeLabel(tournament?.bracket_type)}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Max Players</p>
            <p className="font-semibold">{tournament?.max_players ?? '-'}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Round Time</p>
            <p className="font-semibold">{tournament?.round_time_minutes ?? '-'} min</p>
          </div>
          <div className="rounded-lg border p-3 sm:col-span-2 lg:col-span-3">
            <p className="text-xs text-muted-foreground">Settings Snapshot</p>
            <pre className="mt-2 overflow-x-auto rounded bg-muted/40 p-3 text-xs">
              {JSON.stringify(settings, null, 2)}
            </pre>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-3">
        <SectionPlaceholder title="Players" description="Pendaftaran peserta akan dibina pada task seterusnya." />
        <SectionPlaceholder title="Bracket" description="Bracket generation engine akan dibina selepas flow creation stabil." />
        <SectionPlaceholder title="Results" description="Result entry dan standings akan dibina selepas bracket module." />
      </div>
    </div>
  );
};

export default TournamentDetailPlaceholder;

