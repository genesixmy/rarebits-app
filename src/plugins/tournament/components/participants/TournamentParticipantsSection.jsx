import React, { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { AnimatePresence, motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import toast from 'react-hot-toast';
import ParticipantFormCard from '@/plugins/tournament/components/participants/ParticipantFormCard';
import {
  CHECK_IN_STATUS,
  PAYMENT_STATUS,
  REGISTRATION_STATUS,
  getStatusLabel,
  statusBadgeClass,
} from '@/plugins/tournament/config/participantStatuses';
import {
  MIN_ACTIVE_PARTICIPANTS,
  getEligibleParticipantsForBracket,
  getParticipantsSortedBySeed,
  isParticipantActiveForSeeding,
  normalizeSeedNumberInput,
  validateTournamentSeedingReadiness,
} from '@/plugins/tournament/config/seedingRules';
import {
  useAutoAssignTournamentSeeds,
  useClearTournamentSeeds,
  useCreateTournamentParticipant,
  useDeleteTournamentParticipant,
  useTournamentParticipants,
  useUpdateTournamentParticipant,
} from '@/plugins/tournament/hooks/useTournamentPlugin';
import { Eraser, Hash, Loader2, MoreVertical, Plus, Search, UserPlus, Wand2, X } from 'lucide-react';

const toDateLabel = (value) => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return format(parsed, 'dd MMM yyyy, HH:mm');
};

const toFriendlyError = (error, fallback) => {
  const message = String(error?.message || '').trim();
  if (!message) return fallback;
  if (message.includes('idx_tournament_participants_tournament_seed_unique') || message.includes('duplicate key')) {
    return 'Seed number sudah digunakan oleh peserta lain.';
  }
  return message;
};

const StatusActionPill = ({ label, valueClassName, onClick, disabled }) => (
  <button
    type="button"
    className={`rounded-full border px-2 py-1 text-[11px] font-semibold transition-colors hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-60 ${valueClassName}`}
    onClick={onClick}
    disabled={disabled}
  >
    {label}
  </button>
);

const readinessClassMap = {
  ready: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  warning: 'border-amber-300 bg-amber-50 text-amber-700',
  not_ready: 'border-rose-300 bg-rose-50 text-rose-700',
};

const TournamentParticipantsSection = ({ tournamentId, userId, maxPlayers }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [registrationFilter, setRegistrationFilter] = useState('all');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingParticipant, setEditingParticipant] = useState(null);
  const [deletingParticipant, setDeletingParticipant] = useState(null);
  const [seedDraftByParticipantId, setSeedDraftByParticipantId] = useState({});
  const [seedActionDialog, setSeedActionDialog] = useState({ open: false, type: null });

  const {
    data: participants = [],
    isLoading,
    isError,
    error,
  } = useTournamentParticipants({ tournamentId, userId });

  const createParticipantMutation = useCreateTournamentParticipant({ tournamentId, userId });
  const updateParticipantMutation = useUpdateTournamentParticipant({ tournamentId, userId });
  const deleteParticipantMutation = useDeleteTournamentParticipant({ tournamentId, userId });
  const autoAssignSeedsMutation = useAutoAssignTournamentSeeds({ tournamentId, userId });
  const clearSeedsMutation = useClearTournamentSeeds({ tournamentId, userId });

  const summary = useMemo(() => {
    const rows = Array.isArray(participants) ? participants : [];
    const activeCount = rows.filter((item) => item.registration_status === REGISTRATION_STATUS.REGISTERED).length;
    const droppedCount = rows.filter((item) => item.registration_status === REGISTRATION_STATUS.DROPPED).length;
    const paidCount = rows.filter((item) => item.payment_status === PAYMENT_STATUS.PAID).length;
    const checkedInCount = rows.filter((item) => item.check_in_status === CHECK_IN_STATUS.CHECKED_IN).length;

    return {
      total: rows.length,
      active: activeCount,
      dropped: droppedCount,
      paid: paidCount,
      checkedIn: checkedInCount,
      readyToStart: activeCount >= MIN_ACTIVE_PARTICIPANTS,
    };
  }, [participants]);

  const normalizedMaxPlayers = useMemo(() => {
    const parsed = Number.parseInt(maxPlayers, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
  }, [maxPlayers]);

  const seedingReadiness = useMemo(
    () => validateTournamentSeedingReadiness(participants, { minActive: MIN_ACTIVE_PARTICIPANTS }),
    [participants]
  );

  const seededParticipants = useMemo(
    () => getParticipantsSortedBySeed(participants),
    [participants]
  );

  const eligibleParticipants = useMemo(
    () => getEligibleParticipantsForBracket(participants),
    [participants]
  );

  const filteredParticipants = useMemo(() => {
    const normalizedSearch = String(searchTerm || '').trim().toLowerCase();
    return participants.filter((participant) => {
      const matchesSearch = !normalizedSearch
        || String(participant.display_name || '').toLowerCase().includes(normalizedSearch)
        || String(participant.phone_number || '').toLowerCase().includes(normalizedSearch)
        || String(participant.participant_code || '').toLowerCase().includes(normalizedSearch);

      const matchesRegistration = registrationFilter === 'all'
        || participant.registration_status === registrationFilter;

      return matchesSearch && matchesRegistration;
    });
  }, [participants, searchTerm, registrationFilter]);

  const getSeedDraftValue = (participant) => {
    const key = participant.id;
    if (Object.prototype.hasOwnProperty.call(seedDraftByParticipantId, key)) {
      return seedDraftByParticipantId[key];
    }
    return participant.seed_number ? String(participant.seed_number) : '';
  };

  const setSeedDraftValue = (participantId, value) => {
    const nextValue = String(value || '').replace(/\D/g, '').slice(0, 4);
    setSeedDraftByParticipantId((prev) => ({
      ...prev,
      [participantId]: nextValue,
    }));
  };

  const clearSeedDraftValue = (participantId) => {
    setSeedDraftByParticipantId((prev) => {
      const next = { ...prev };
      delete next[participantId];
      return next;
    });
  };

  const handleCreateParticipant = async (values) => {
    try {
      await createParticipantMutation.mutateAsync(values);
      toast.success('Participant ditambah.');
      setIsCreateOpen(false);
    } catch (mutationError) {
      toast.error(toFriendlyError(mutationError, 'Gagal tambah participant.'));
    }
  };

  const handleSaveEdit = async (values) => {
    if (!editingParticipant?.id) return;
    try {
      await updateParticipantMutation.mutateAsync({
        participantId: editingParticipant.id,
        values,
      });
      toast.success('Participant dikemaskini.');
      setEditingParticipant(null);
      clearSeedDraftValue(editingParticipant.id);
    } catch (mutationError) {
      toast.error(toFriendlyError(mutationError, 'Gagal kemaskini participant.'));
    }
  };

  const handleDelete = async () => {
    if (!deletingParticipant?.id) return;
    try {
      await deleteParticipantMutation.mutateAsync(deletingParticipant.id);
      toast.success('Participant dibuang.');
      clearSeedDraftValue(deletingParticipant.id);
      setDeletingParticipant(null);
    } catch (mutationError) {
      toast.error(toFriendlyError(mutationError, 'Gagal buang participant.'));
    }
  };

  const handleToggleStatus = async (participant, fieldName, nextValue) => {
    const payload = { [fieldName]: nextValue };
    if (fieldName === 'registration_status' && nextValue === REGISTRATION_STATUS.DROPPED) {
      payload.seed_number = null;
    }

    try {
      await updateParticipantMutation.mutateAsync({
        participantId: participant.id,
        values: payload,
      });
      if (fieldName === 'registration_status' && nextValue === REGISTRATION_STATUS.DROPPED) {
        clearSeedDraftValue(participant.id);
      }
    } catch (mutationError) {
      toast.error(toFriendlyError(mutationError, 'Gagal kemaskini status participant.'));
    }
  };

  const handleSaveSeed = async (participant) => {
    if (!isParticipantActiveForSeeding(participant)) {
      toast.error('Hanya participant aktif boleh ditetapkan seed.');
      return;
    }

    const draftValue = getSeedDraftValue(participant);
    const normalized = normalizeSeedNumberInput(draftValue);
    if (!normalized.isValid || normalized.value === null) {
      toast.error(normalized.reason || 'Seed number tidak sah.');
      return;
    }

    try {
      await updateParticipantMutation.mutateAsync({
        participantId: participant.id,
        values: { seed_number: normalized.value },
      });
      toast.success(`Seed #${normalized.value} disimpan.`);
      clearSeedDraftValue(participant.id);
    } catch (mutationError) {
      toast.error(toFriendlyError(mutationError, 'Gagal simpan seed.'));
    }
  };

  const handleClearSeed = async (participant) => {
    try {
      await updateParticipantMutation.mutateAsync({
        participantId: participant.id,
        values: { seed_number: null },
      });
      toast.success('Seed dikosongkan.');
      clearSeedDraftValue(participant.id);
    } catch (mutationError) {
      toast.error(toFriendlyError(mutationError, 'Gagal kosongkan seed.'));
    }
  };

  const handleConfirmSeedAction = async () => {
    if (seedActionDialog.type === 'auto') {
      try {
        const result = await autoAssignSeedsMutation.mutateAsync();
        toast.success(`Auto seed siap (${result?.updatedCount || 0} peserta).`);
      } catch (mutationError) {
        toast.error(toFriendlyError(mutationError, 'Gagal auto assign seed.'));
      }
    }

    if (seedActionDialog.type === 'clear') {
      try {
        await clearSeedsMutation.mutateAsync();
        toast.success('Semua seed dikosongkan.');
        setSeedDraftByParticipantId({});
      } catch (mutationError) {
        toast.error(toFriendlyError(mutationError, 'Gagal kosongkan semua seed.'));
      }
    }

    setSeedActionDialog({ open: false, type: null });
  };

  const isSeedActionLoading = autoAssignSeedsMutation.isPending || clearSeedsMutation.isPending;
  const readinessClass = readinessClassMap[seedingReadiness.level] || readinessClassMap.not_ready;
  const isCreateSubmitting = createParticipantMutation.isPending;

  const handleCloseCreateModal = () => {
    if (isCreateSubmitting) return;
    setIsCreateOpen(false);
  };

  return (
    <div className="space-y-4">
      <Card className="border-primary/20">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Participants</CardTitle>
              <CardDescription>
                Urus pendaftaran peserta sebelum bracket generation.
              </CardDescription>
            </div>
            <Button
              type="button"
              className="brand-gradient brand-gradient-hover text-white"
              onClick={() => {
                setEditingParticipant(null);
                setIsCreateOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Participant
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-lg border bg-muted/30 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total</p>
              <p className="text-lg font-semibold">{summary.total}</p>
            </div>
            <div className="rounded-lg border bg-muted/30 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Active</p>
              <p className="text-lg font-semibold">{summary.active}</p>
            </div>
            <div className="rounded-lg border bg-muted/30 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Paid</p>
              <p className="text-lg font-semibold">{summary.paid}</p>
            </div>
            <div className="rounded-lg border bg-muted/30 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Checked In</p>
              <p className="text-lg font-semibold">{summary.checkedIn}</p>
            </div>
            <div className="rounded-lg border bg-muted/30 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Readiness</p>
              <p className={`text-sm font-semibold ${summary.readyToStart ? 'text-emerald-700' : 'text-amber-700'}`}>
                {summary.readyToStart ? 'Ready (min 2 active)' : 'Need >= 2 active'}
              </p>
            </div>
          </div>

          <div className="text-xs text-muted-foreground">
            Tournament capacity: {summary.active}/{normalizedMaxPlayers ?? '-'}
          </div>
        </CardContent>
      </Card>

      <Card className="border-primary/20">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Seeding Preparation</CardTitle>
              <CardDescription>
                Tetapkan seed untuk peserta aktif sebagai persediaan bracket generation.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setSeedActionDialog({ open: true, type: 'auto' })}
                disabled={isSeedActionLoading || eligibleParticipants.length === 0}
              >
                <Wand2 className="mr-2 h-4 w-4" />
                Auto Assign Seeds
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setSeedActionDialog({ open: true, type: 'clear' })}
                disabled={isSeedActionLoading || seededParticipants.length === 0}
              >
                <Eraser className="mr-2 h-4 w-4" />
                Clear All Seeds
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className={`rounded-lg border px-3 py-2 text-sm font-medium ${readinessClass}`}>
            {seedingReadiness.message}
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-lg border bg-muted/20 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Active</p>
              <p className="text-base font-semibold">{seedingReadiness.activeCount}</p>
            </div>
            <div className="rounded-lg border bg-muted/20 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Seeded</p>
              <p className="text-base font-semibold">{seedingReadiness.seededCount}</p>
            </div>
            <div className="rounded-lg border bg-muted/20 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Unseeded</p>
              <p className="text-base font-semibold">{seedingReadiness.unseededCount}</p>
            </div>
            <div className="rounded-lg border bg-muted/20 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Duplicate Seeds</p>
              <p className="text-base font-semibold">{seedingReadiness.duplicateSeeds.length}</p>
            </div>
            <div className="rounded-lg border bg-muted/20 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Ready for Bracket</p>
              <p className="text-base font-semibold">
                {seedingReadiness.level === 'ready' ? 'Yes' : seedingReadiness.level === 'warning' ? 'Warning' : 'No'}
              </p>
            </div>
          </div>

          {seedingReadiness.duplicateSeeds.length > 0 ? (
            <p className="text-xs font-medium text-rose-700">
              Duplicate seed dikesan: #{seedingReadiness.duplicateSeeds.join(', #')}
            </p>
          ) : null}

          <div className="rounded-lg border bg-muted/10 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current Seed Order</p>
            {seededParticipants.length === 0 ? (
              <p className="text-sm text-muted-foreground">Belum ada seed ditetapkan.</p>
            ) : (
              <div className="grid gap-1 sm:grid-cols-2">
                {seededParticipants.map((participant) => (
                  <div key={`seed-order-${participant.id}`} className="flex items-center gap-2 rounded border bg-white px-2 py-1 text-sm">
                    <span className="inline-flex min-w-[44px] items-center justify-center rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                      #{participant.seed_number}
                    </span>
                    <span className="truncate">{participant.display_name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <AnimatePresence>
        {isCreateOpen ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-2 backdrop-blur-sm sm:p-4"
            onClick={handleCloseCreateModal}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              transition={{ duration: 0.16 }}
              className="relative w-full max-w-3xl"
              onClick={(event) => event.stopPropagation()}
            >
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-2 top-2 z-10 h-8 w-8 rounded-full bg-white/90 hover:bg-white"
                onClick={handleCloseCreateModal}
                disabled={isCreateSubmitting}
              >
                <X className="h-4 w-4" />
              </Button>
              <ParticipantFormCard
                mode="create"
                initialValues={null}
                onCancel={handleCloseCreateModal}
                onSubmit={handleCreateParticipant}
                isSubmitting={isCreateSubmitting}
                className="max-h-[92vh] overflow-y-auto border-primary/30 shadow-xl"
              />
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {editingParticipant ? (
        <ParticipantFormCard
          key={`edit-participant-${editingParticipant.id}`}
          mode="edit"
          initialValues={editingParticipant}
          onCancel={() => setEditingParticipant(null)}
          onSubmit={handleSaveEdit}
          isSubmitting={updateParticipantMutation.isPending}
        />
      ) : null}

      <Card className="border-primary/20">
        <CardHeader className="pb-3">
          <div className="grid gap-3 md:grid-cols-[1fr_220px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-500" />
              <Input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="pl-10"
                placeholder="Cari participant (nama, telefon, kod)..."
              />
            </div>
            <Select
              value={registrationFilter}
              onChange={(event) => setRegistrationFilter(event.target.value)}
            >
              <option value="all">All Registration</option>
              <option value={REGISTRATION_STATUS.REGISTERED}>Registered</option>
              <option value={REGISTRATION_STATUS.DROPPED}>Dropped</option>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Memuatkan participant...
            </div>
          ) : null}

          {!isLoading && isError ? (
            <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              Gagal memuatkan participant. {error?.message || 'Sila cuba semula.'}
            </div>
          ) : null}

          {!isLoading && !isError && filteredParticipants.length === 0 ? (
            <div className="rounded-lg border border-dashed border-primary/30 bg-primary/5 px-4 py-8 text-center">
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                <UserPlus className="h-5 w-5" />
              </div>
              <p className="text-sm font-semibold">
                {participants.length === 0 ? 'Belum ada participant' : 'Tiada participant menepati carian'}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {participants.length === 0
                  ? 'Klik Add Participant untuk mula pendaftaran peserta.'
                  : 'Cuba ubah kata carian atau penapis registration.'}
              </p>
              {participants.length === 0 ? (
                <Button
                  type="button"
                  className="mt-4 brand-gradient brand-gradient-hover text-white"
                  onClick={() => setIsCreateOpen(true)}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Participant
                </Button>
              ) : null}
            </div>
          ) : null}

          {!isLoading && !isError && filteredParticipants.length > 0 ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Showing {filteredParticipants.length} of {participants.length} participant(s)
              </p>

              {filteredParticipants.map((participant) => {
                const paymentIsPaid = participant.payment_status === PAYMENT_STATUS.PAID;
                const checkedIn = participant.check_in_status === CHECK_IN_STATUS.CHECKED_IN;
                const isDropped = participant.registration_status === REGISTRATION_STATUS.DROPPED;
                const isSeedEligible = isParticipantActiveForSeeding(participant);
                const seedDraft = getSeedDraftValue(participant);

                return (
                  <div key={participant.id} className="rounded-lg border border-primary/20 bg-white p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">{participant.display_name}</p>
                        <p className="text-xs text-muted-foreground">
                          Code: {participant.participant_code || '-'}
                          {participant.phone_number ? ` | ${participant.phone_number}` : ''}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          Added: {toDateLabel(participant.created_at)}
                        </p>
                      </div>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button type="button" variant="outline" size="icon" className="h-8 w-8">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => { setIsCreateOpen(false); setEditingParticipant(participant); }}>
                            Edit Participant
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleToggleStatus(
                              participant,
                              'registration_status',
                              isDropped ? REGISTRATION_STATUS.REGISTERED : REGISTRATION_STATUS.DROPPED
                            )}
                          >
                            {isDropped ? 'Restore Participant' : 'Mark Dropped'}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => setDeletingParticipant(participant)}
                            className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                          >
                            Remove Participant
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <StatusActionPill
                        label={`Payment: ${getStatusLabel('payment_status', participant.payment_status)}`}
                        valueClassName={statusBadgeClass.payment_status[participant.payment_status] || 'border-slate-300 bg-slate-100 text-slate-700'}
                        onClick={() => handleToggleStatus(
                          participant,
                          'payment_status',
                          paymentIsPaid ? PAYMENT_STATUS.UNPAID : PAYMENT_STATUS.PAID
                        )}
                        disabled={updateParticipantMutation.isPending}
                      />
                      <StatusActionPill
                        label={`Check-In: ${getStatusLabel('check_in_status', participant.check_in_status)}`}
                        valueClassName={statusBadgeClass.check_in_status[participant.check_in_status] || 'border-slate-300 bg-slate-100 text-slate-700'}
                        onClick={() => handleToggleStatus(
                          participant,
                          'check_in_status',
                          checkedIn ? CHECK_IN_STATUS.NOT_CHECKED_IN : CHECK_IN_STATUS.CHECKED_IN
                        )}
                        disabled={updateParticipantMutation.isPending}
                      />
                      <StatusActionPill
                        label={`Registration: ${getStatusLabel('registration_status', participant.registration_status)}`}
                        valueClassName={statusBadgeClass.registration_status[participant.registration_status] || 'border-slate-300 bg-slate-100 text-slate-700'}
                        onClick={() => handleToggleStatus(
                          participant,
                          'registration_status',
                          isDropped ? REGISTRATION_STATUS.REGISTERED : REGISTRATION_STATUS.DROPPED
                        )}
                        disabled={updateParticipantMutation.isPending}
                      />
                    </div>

                    <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Seed Number
                        </p>
                        {participant.seed_number ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-white px-2 py-0.5 text-xs font-semibold text-primary">
                            <Hash className="h-3 w-3" />
                            #{participant.seed_number}
                          </span>
                        ) : null}
                      </div>

                      {isSeedEligible ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Input
                            value={seedDraft}
                            onChange={(event) => setSeedDraftValue(participant.id, event.target.value)}
                            placeholder="Seed"
                            className="h-9 w-24"
                            inputMode="numeric"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleSaveSeed(participant)}
                            disabled={updateParticipantMutation.isPending}
                          >
                            Save Seed
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleClearSeed(participant)}
                            disabled={updateParticipantMutation.isPending || participant.seed_number === null}
                          >
                            Clear
                          </Button>
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-muted-foreground">
                          Participant dropped. Restore participant dahulu untuk menetapkan seed.
                        </p>
                      )}
                    </div>

                    {participant.notes ? (
                      <div className="mt-3 rounded bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                        {participant.notes}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <AlertDialog
        open={Boolean(deletingParticipant)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setDeletingParticipant(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove participant?</AlertDialogTitle>
            <AlertDialogDescription>
              Participant akan dipadam dari tournament ini. Bracket engine belum aktif, jadi pemadaman kekal adalah selamat untuk fasa semasa.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
              disabled={deleteParticipantMutation.isPending}
            >
              {deleteParticipantMutation.isPending ? 'Removing...' : 'Remove'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={seedActionDialog.open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setSeedActionDialog({ open: false, type: null });
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {seedActionDialog.type === 'auto' ? 'Auto assign seed?' : 'Clear all seeds?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {seedActionDialog.type === 'auto'
                ? 'Semua participant aktif akan diberi seed secara turutan berdasarkan tarikh daftar.'
                : 'Semua seed number akan dikosongkan untuk tournament ini.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmSeedAction}
              disabled={isSeedActionLoading}
              className={seedActionDialog.type === 'clear'
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                : undefined}
            >
              {isSeedActionLoading
                ? 'Processing...'
                : seedActionDialog.type === 'auto'
                  ? 'Auto Assign'
                  : 'Clear All'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default TournamentParticipantsSection;
