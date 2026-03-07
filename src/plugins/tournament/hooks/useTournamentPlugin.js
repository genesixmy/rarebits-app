import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import {
  assignTournamentMatchWinner,
  autoAssignTournamentSeeds,
  bulkAssignTournamentSeeds,
  clearTournamentSeeds,
  createBracketRunFromSnapshot,
  createTournament,
  createTournamentParticipant,
  deleteTournamentParticipant,
  fetchPublicTournamentViewByCode,
  fetchBracketRunMatches,
  fetchTournamentBracketRunsHistory,
  fetchTournamentRunAuditEvents,
  canStartNewRunFromSnapshot,
  fetchLatestTournamentBracketRun,
  fetchLatestTournamentBracketSnapshot,
  fetchTournamentById,
  fetchTournamentRunCompletionSummary,
  fetchTournamentParticipants,
  fetchTournamentTemplates,
  fetchTournamentsByUser,
  finalizeTournamentBracketRun,
  prepareTournamentBracketSnapshot,
  rebuildBracketRunFromPreparedSnapshot,
  resetTournamentMatchResult,
  startNewRunFromPreparedSnapshot,
  updateTournamentParticipant,
} from '@/plugins/tournament/services/tournamentService';

export const useTournamentTemplates = () => (
  useQuery({
    queryKey: queryKeys.tournament.templates(),
    queryFn: fetchTournamentTemplates,
    staleTime: 1000 * 60 * 10,
  })
);

export const useTournamentList = (userId) => (
  useQuery({
    queryKey: queryKeys.tournament.listByUser(userId),
    queryFn: () => fetchTournamentsByUser(userId),
    enabled: Boolean(userId),
  })
);

export const useTournamentDetail = ({ tournamentId, userId }) => (
  useQuery({
    queryKey: queryKeys.tournament.detailById(tournamentId),
    queryFn: () => fetchTournamentById({ tournamentId, userId }),
    enabled: Boolean(tournamentId && userId),
  })
);

export const useTournamentParticipants = ({ tournamentId, userId }) => (
  useQuery({
    queryKey: queryKeys.tournament.participantsByTournament(tournamentId, userId),
    queryFn: () => fetchTournamentParticipants({ tournamentId, userId }),
    enabled: Boolean(tournamentId && userId),
  })
);

export const useLatestTournamentBracketSnapshot = ({ tournamentId, userId }) => (
  useQuery({
    queryKey: queryKeys.tournament.bracketSnapshotByTournament(tournamentId, userId),
    queryFn: () => fetchLatestTournamentBracketSnapshot({ tournamentId, userId }),
    enabled: Boolean(tournamentId && userId),
  })
);

export const useLatestTournamentBracketRun = ({ tournamentId, userId }) => (
  useQuery({
    queryKey: queryKeys.tournament.bracketRunByTournament(tournamentId, userId),
    queryFn: () => fetchLatestTournamentBracketRun({ tournamentId, userId }),
    enabled: Boolean(tournamentId && userId),
  })
);

export const useTournamentBracketRunsHistory = ({ tournamentId, userId }) => (
  useQuery({
    queryKey: queryKeys.tournament.runHistoryByTournament(tournamentId, userId),
    queryFn: () => fetchTournamentBracketRunsHistory({ tournamentId, userId }),
    enabled: Boolean(tournamentId && userId),
    refetchOnMount: 'always',
  })
);

export const useTournamentRunAuditEvents = ({ tournamentId, userId, limit = 30 }) => (
  useQuery({
    queryKey: queryKeys.tournament.runAuditEventsByTournament(tournamentId, userId, limit),
    queryFn: () => fetchTournamentRunAuditEvents({ tournamentId, userId, limit }),
    enabled: Boolean(tournamentId && userId),
    refetchOnMount: 'always',
  })
);

export const useCanStartNewRunFromSnapshot = ({ tournamentId, userId }) => (
  useQuery({
    queryKey: queryKeys.tournament.canStartNewRunFromSnapshot(tournamentId, userId),
    queryFn: () => canStartNewRunFromSnapshot({ tournamentId, userId }),
    enabled: Boolean(tournamentId && userId),
  })
);

export const useBracketRunMatches = ({ runId, userId }) => (
  useQuery({
    queryKey: queryKeys.tournament.bracketMatchesByRun(runId, userId),
    queryFn: () => fetchBracketRunMatches({ runId, userId }),
    enabled: Boolean(runId && userId),
  })
);

export const useTournamentRunCompletionSummary = ({ tournamentId, userId }) => (
  useQuery({
    queryKey: queryKeys.tournament.runCompletionSummary(tournamentId, userId),
    queryFn: () => fetchTournamentRunCompletionSummary({ tournamentId, userId }),
    enabled: Boolean(tournamentId && userId),
    refetchOnMount: 'always',
  })
);

export const usePublicTournamentView = ({ publicCode }) => (
  useQuery({
    queryKey: queryKeys.tournament.publicView(publicCode),
    queryFn: () => fetchPublicTournamentViewByCode({ publicCode }),
    enabled: Boolean(String(publicCode || '').trim()),
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: 15000,
  })
);

export const useCreateTournament = (userId) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ template, baseValues, dynamicSettings, recommendationMeta }) => createTournament({
      userId,
      template,
      baseValues,
      dynamicSettings,
      recommendationMeta,
    }),
    onSuccess: async (createdTournament) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.listByUser(userId) });
      if (createdTournament?.id) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.detailById(createdTournament.id) });
      }
    },
  });
};

export const useCreateTournamentParticipant = ({ tournamentId, userId }) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (values) => createTournamentParticipant({ tournamentId, userId, values }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.participantsByTournament(tournamentId, userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.detailById(tournamentId) });
    },
  });
};

export const useUpdateTournamentParticipant = ({ tournamentId, userId }) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ participantId, values }) => updateTournamentParticipant({ participantId, userId, values, tournamentId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.participantsByTournament(tournamentId, userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.detailById(tournamentId) });
    },
  });
};

export const useBulkAssignTournamentSeeds = ({ tournamentId, userId }) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (assignments) => bulkAssignTournamentSeeds({ tournamentId, userId, assignments }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.participantsByTournament(tournamentId, userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.detailById(tournamentId) });
    },
  });
};

export const useAutoAssignTournamentSeeds = ({ tournamentId, userId }) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => autoAssignTournamentSeeds({ tournamentId, userId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.participantsByTournament(tournamentId, userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.detailById(tournamentId) });
    },
  });
};

export const useClearTournamentSeeds = ({ tournamentId, userId }) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => clearTournamentSeeds({ tournamentId, userId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.participantsByTournament(tournamentId, userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.detailById(tournamentId) });
    },
  });
};

export const usePrepareTournamentBracketSnapshot = ({ tournamentId, userId }) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ tournament, forceReprepare }) => prepareTournamentBracketSnapshot({
      tournamentId,
      userId,
      tournament,
      forceReprepare,
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.bracketSnapshotByTournament(tournamentId, userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.participantsByTournament(tournamentId, userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.detailById(tournamentId) });
    },
  });
};

export const useCreateBracketRunFromSnapshot = ({ tournamentId, userId }) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ forceRegenerate }) => createBracketRunFromSnapshot({
      tournamentId,
      userId,
      forceRegenerate,
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.bracketRunByTournament(tournamentId, userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.runHistoryByTournament(tournamentId, userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.runAuditEventsRoot(tournamentId, userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.canStartNewRunFromSnapshot(tournamentId, userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.bracketSnapshotByTournament(tournamentId, userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.bracketMatchesRoot() });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.runCompletionSummary(tournamentId, userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.participantsByTournament(tournamentId, userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.detailById(tournamentId) });
    },
  });
};

export const useAssignTournamentMatchWinner = ({ tournamentId, userId, runId }) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ matchId, selectedSide, scoreA, scoreB, matchFormat }) => assignTournamentMatchWinner({
      runId,
      tournamentId,
      userId,
      matchId,
      selectedSide,
      scoreA,
      scoreB,
      matchFormat,
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.bracketRunByTournament(tournamentId, userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.bracketMatchesByRun(runId, userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.bracketSnapshotByTournament(tournamentId, userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.runCompletionSummary(tournamentId, userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.detailById(tournamentId) });
    },
  });
};

export const useResetTournamentMatchResult = ({ tournamentId, userId, runId }) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ matchId }) => resetTournamentMatchResult({
      runId,
      tournamentId,
      userId,
      matchId,
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.bracketRunByTournament(tournamentId, userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.bracketMatchesByRun(runId, userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.bracketSnapshotByTournament(tournamentId, userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.runCompletionSummary(tournamentId, userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.detailById(tournamentId) });
    },
  });
};

export const useRebuildBracketRunFromPreparedSnapshot = ({ tournamentId, userId }) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => rebuildBracketRunFromPreparedSnapshot({
      tournamentId,
      userId,
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.bracketRunByTournament(tournamentId, userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.runHistoryByTournament(tournamentId, userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.runAuditEventsRoot(tournamentId, userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.canStartNewRunFromSnapshot(tournamentId, userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.bracketSnapshotByTournament(tournamentId, userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.bracketMatchesRoot() });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.runCompletionSummary(tournamentId, userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.participantsByTournament(tournamentId, userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.detailById(tournamentId) });
    },
  });
};

export const useStartNewRunFromPreparedSnapshot = ({ tournamentId, userId }) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => startNewRunFromPreparedSnapshot({
      tournamentId,
      userId,
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.bracketRunByTournament(tournamentId, userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.runHistoryByTournament(tournamentId, userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.runAuditEventsRoot(tournamentId, userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.canStartNewRunFromSnapshot(tournamentId, userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.bracketSnapshotByTournament(tournamentId, userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.bracketMatchesRoot() });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.runCompletionSummary(tournamentId, userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.participantsByTournament(tournamentId, userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.detailById(tournamentId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.listByUser(userId) });
    },
  });
};

export const useFinalizeTournamentBracketRun = ({ tournamentId, userId, runId }) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => finalizeTournamentBracketRun({
      runId,
      tournamentId,
      userId,
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.bracketRunByTournament(tournamentId, userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.runHistoryByTournament(tournamentId, userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.runAuditEventsRoot(tournamentId, userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.canStartNewRunFromSnapshot(tournamentId, userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.bracketSnapshotByTournament(tournamentId, userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.bracketMatchesRoot() });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.runCompletionSummary(tournamentId, userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.participantsByTournament(tournamentId, userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.detailById(tournamentId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.listByUser(userId) });
    },
  });
};

export const useDeleteTournamentParticipant = ({ tournamentId, userId }) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (participantId) => deleteTournamentParticipant({ participantId, userId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.participantsByTournament(tournamentId, userId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament.detailById(tournamentId) });
    },
  });
};
