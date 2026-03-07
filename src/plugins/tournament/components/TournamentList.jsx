import React from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CalendarDays, MapPin, Users, Trophy } from 'lucide-react';
import { format } from 'date-fns';
import { getBracketTypeLabel } from '@/plugins/tournament/config/tournamentTemplates';

const statusBadgeClass = {
  draft: 'border-slate-300 bg-slate-100 text-slate-700',
  ready: 'border-cyan-300 bg-cyan-50 text-cyan-700',
  ongoing: 'border-amber-300 bg-amber-50 text-amber-700',
  completed: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  cancelled: 'border-rose-300 bg-rose-50 text-rose-700',
};

const formatEventDate = (value) => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return format(parsed, 'dd MMM yyyy, HH:mm');
};

const TournamentList = ({ tournaments }) => {
  if (!Array.isArray(tournaments) || tournaments.length === 0) {
    return (
      <Card className="border-dashed border-primary/30">
        <CardContent className="py-10 text-center">
          <p className="text-base font-semibold">Belum ada tournament</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Klik Create New Tournament untuk mula setup event pertama anda.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-3">
      {tournaments.map((tournament) => {
        const templateName = tournament?.tournament_templates?.name || tournament?.category || 'General';
        const statusKey = String(tournament?.status || 'draft').toLowerCase();
        return (
          <Link key={tournament.id} to={`/plugins/tournament/${tournament.id}`}>
            <Card className="border-primary/20 transition-all hover:border-primary/40 hover:shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">{tournament.name}</CardTitle>
                    <CardDescription className="mt-1 flex items-center gap-2">
                      <Trophy className="h-3.5 w-3.5" />
                      {templateName}
                    </CardDescription>
                  </div>
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusBadgeClass[statusKey] || statusBadgeClass.draft}`}>
                    {statusKey.toUpperCase()}
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
                  <div className="flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-primary" />
                    <span>{formatEventDate(tournament.event_date)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-primary" />
                    <span>{tournament.venue || '-'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-primary" />
                    <span>Max {tournament.max_players}</span>
                  </div>
                  <div className="font-medium text-foreground">
                    {getBracketTypeLabel(tournament.bracket_type)}
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
};

export default TournamentList;

