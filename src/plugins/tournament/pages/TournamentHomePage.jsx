import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/SupabaseAuthContext.jsx';
import { useTournamentList, useTournamentTemplates } from '@/plugins/tournament/hooks/useTournamentPlugin';
import TournamentCreateWizard from '@/plugins/tournament/components/TournamentCreateWizard';
import TournamentList from '@/plugins/tournament/components/TournamentList';
import { Loader2, Plus } from 'lucide-react';

const TournamentHomePage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const userId = user?.id;
  const isCreateRoute = location.pathname === '/plugins/tournament/create';
  const [showCreateWizard, setShowCreateWizard] = useState(isCreateRoute);

  const {
    data: templates = [],
    isLoading: isLoadingTemplates,
    isError: isTemplatesError,
    error: templatesError,
  } = useTournamentTemplates();

  const {
    data: tournaments = [],
    isLoading: isLoadingTournaments,
    isError: isTournamentsError,
    error: tournamentsError,
  } = useTournamentList(userId);

  const pageError = useMemo(
    () => templatesError?.message || tournamentsError?.message || '',
    [templatesError?.message, tournamentsError?.message]
  );

  useEffect(() => {
    setShowCreateWizard(isCreateRoute);
  }, [isCreateRoute]);

  const openCreateWizard = () => {
    setShowCreateWizard(true);
    if (!isCreateRoute) {
      navigate('/plugins/tournament/create');
    }
  };

  const closeCreateWizard = () => {
    setShowCreateWizard(false);
    if (location.pathname !== '/plugins/tournament') {
      navigate('/plugins/tournament');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="page-title">Tournament Manager</h1>
          <p className="text-sm text-muted-foreground">
            Premade template flow untuk create tournament pantas. Modul kekal terasing dari core RareBits.
          </p>
        </div>
        <Button
          type="button"
          className="brand-gradient brand-gradient-hover text-white"
          onClick={openCreateWizard}
        >
          <Plus className="mr-2 h-4 w-4" />
          Create New Tournament
        </Button>
      </div>

      {isLoadingTemplates || isLoadingTournaments ? (
        <Card>
          <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Memuatkan data tournament...
          </CardContent>
        </Card>
      ) : null}

      {!isLoadingTemplates && !isLoadingTournaments && (isTemplatesError || isTournamentsError) ? (
        <Card className="border-rose-300">
          <CardContent className="py-6 text-sm text-rose-700">
            Gagal memuatkan data tournament. {pageError || 'Sila cuba semula.'}
          </CardContent>
        </Card>
      ) : null}

      {!isLoadingTemplates && !isLoadingTournaments && !isTemplatesError && !isTournamentsError ? (
        <>
          {showCreateWizard ? (
            <TournamentCreateWizard
              userId={userId}
              templates={templates}
              onCancel={closeCreateWizard}
              onCreated={(createdTournament) => {
                setShowCreateWizard(false);
                if (createdTournament?.id) {
                  navigate(`/plugins/tournament/${createdTournament.id}`);
                }
              }}
            />
          ) : null}

          <TournamentList tournaments={tournaments} />
        </>
      ) : null}
    </div>
  );
};

export default TournamentHomePage;
