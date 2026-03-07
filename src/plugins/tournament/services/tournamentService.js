import { supabase } from '@/lib/customSupabaseClient';
import {
  buildBracketInputSnapshot,
  validateBracketPreparationReadiness,
} from '@/plugins/tournament/config/bracketPreparation';
import { generateSingleEliminationMatchSkeleton } from '@/plugins/tournament/config/bracketRunSkeleton';
import {
  MATCH_STATUS,
  buildResetMatchPayload,
  canAssignWinner,
  canResetMatch,
  canOverwriteDownstreamSlot,
  getPropagationTargetSlot,
  isDownstreamLockedForCorrection,
  resolveMatchStatus,
  resolveMatchWinnerPayload,
} from '@/plugins/tournament/config/matchProgression';
import {
  isManualWinnerAllowed,
  normalizeMatchFormat,
  resolveWinnerFromScore,
} from '@/plugins/tournament/config/matchScoring';
import {
  getRunCompletionSummary,
  isBracketRunCompletable,
  resolveRunChampion,
} from '@/plugins/tournament/config/runCompletion';
import { RUN_AUDIT_EVENT_TYPE } from '@/plugins/tournament/config/runAuditEvents';
import { RUN_STATUS, canTransitionRunStatus, isRunEditable, isRunFinalized } from '@/plugins/tournament/config/runStatuses';
import {
  buildAutoSeedAssignments,
  normalizeSeedNumberInput,
} from '@/plugins/tournament/config/seedingRules';
import { resolvePublicTournamentViewModel } from '@/plugins/tournament/config/publicSpectator';
import { deriveTournamentStatusFromRunStatus } from '@/plugins/tournament/config/tournamentStatus';

const sanitizeSlugPart = (value) => (
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
);

export const toTournamentSlug = (name, fallback = 'tournament') => {
  const base = sanitizeSlugPart(name);
  if (base) return base.slice(0, 90);
  return fallback;
};

const logRunAuditEvent = async ({
  tournamentId,
  userId,
  runId = null,
  snapshotId = null,
  eventType,
  eventNote = null,
  metadata = {},
}) => {
  const payload = {
    tournament_id: tournamentId,
    user_id: userId,
    run_id: runId,
    snapshot_id: snapshotId,
    event_type: String(eventType || '').trim(),
    event_note: eventNote ? String(eventNote) : null,
    metadata_json: metadata && typeof metadata === 'object' ? metadata : {},
  };

  const { error } = await supabase
    .from('tournament_run_audit_events')
    .insert(payload);

  if (error) throw error;
};

const logTournamentStatusSyncWarning = ({
  tournamentId,
  userId,
  source,
  runStatus,
  nextStatus,
  error,
}) => {
  console.warn('[TournamentStatusSync] Failed to sync tournaments.status after run transition.', {
    tournamentId,
    userId,
    source: source || 'unknown',
    runStatus: String(runStatus || '').trim() || null,
    nextStatus: String(nextStatus || '').trim() || null,
    message: error?.message || String(error || ''),
  });
};

const syncTournamentStatusFromRunTransition = async ({
  tournamentId,
  userId,
  runStatus,
  fallbackTournamentStatus,
}) => {
  const statusValue = deriveTournamentStatusFromRunStatus(runStatus, fallbackTournamentStatus);
  if (!statusValue) return null;

  const { data, error } = await supabase
    .from('tournaments')
    .update({ status: statusValue })
    .eq('id', tournamentId)
    .eq('user_id', userId)
    .select('id, status')
    .single();

  if (error) throw error;
  return data;
};

const archivePreparedRunRows = async ({
  tournamentId,
  userId,
  note,
  metadata,
}) => {
  const { data: preparedRuns, error: preparedRunsError } = await supabase
    .from('tournament_bracket_runs')
    .select('id, snapshot_id, status')
    .eq('tournament_id', tournamentId)
    .eq('user_id', userId)
    .eq('status', RUN_STATUS.PREPARED);
  if (preparedRunsError) throw preparedRunsError;

  const runs = Array.isArray(preparedRuns) ? preparedRuns : [];
  if (runs.length === 0) return [];

  const runIds = runs.map((run) => run.id);
  const { error: archiveRunsError } = await supabase
    .from('tournament_bracket_runs')
    .update({ status: RUN_STATUS.ARCHIVED })
    .in('id', runIds)
    .eq('tournament_id', tournamentId)
    .eq('user_id', userId);
  if (archiveRunsError) throw archiveRunsError;

  for (const run of runs) {
    await logRunAuditEvent({
      tournamentId,
      userId,
      runId: run.id,
      snapshotId: run.snapshot_id || null,
      eventType: RUN_AUDIT_EVENT_TYPE.RUN_ARCHIVED,
      eventNote: note || 'Run archived.',
      metadata: {
        archived_status_from: run.status || RUN_STATUS.PREPARED,
        ...(metadata || {}),
      },
    });
  }

  return runs;
};

export const fetchTournamentTemplates = async () => {
  const { data, error } = await supabase
    .from('tournament_templates')
    .select('*')
    .eq('is_active', true)
    .order('name', { ascending: true });

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  return rows.sort((left, right) => {
    if (left.slug === 'custom') return 1;
    if (right.slug === 'custom') return -1;
    return String(left.name || '').localeCompare(String(right.name || ''));
  });
};

export const fetchTournamentsByUser = async (userId) => {
  const { data, error } = await supabase
    .from('tournaments')
    .select(`
      id,
      user_id,
      template_id,
      name,
      slug,
      public_code,
      short_code,
      category,
      bracket_type,
      status,
      event_date,
      venue,
      entry_fee,
      max_players,
      match_format,
      round_time_minutes,
      settings_json,
      notes,
      created_at,
      updated_at,
      tournament_templates (
        id,
        slug,
        name,
        category
      )
    `)
    .eq('user_id', userId)
    .order('event_date', { ascending: true });

  if (error) throw error;
  return Array.isArray(data) ? data : [];
};

export const fetchTournamentById = async ({ tournamentId, userId }) => {
  const { data, error } = await supabase
    .from('tournaments')
    .select(`
      id,
      user_id,
      template_id,
      name,
      slug,
      public_code,
      short_code,
      category,
      bracket_type,
      status,
      event_date,
      venue,
      entry_fee,
      max_players,
      match_format,
      round_time_minutes,
      settings_json,
      notes,
      created_at,
      updated_at,
      tournament_templates (
        id,
        slug,
        name,
        category,
        description,
        config_json
      )
    `)
    .eq('id', tournamentId)
    .eq('user_id', userId)
    .single();

  if (error) throw error;
  return data;
};

export const fetchPublicTournamentViewByCode = async ({ publicCode }) => {
  const normalizedPublicCode = String(publicCode || '').trim().toLowerCase();
  if (!normalizedPublicCode) {
    throw new Error('Invalid tournament public code.');
  }

  const { data, error } = await supabase
    .rpc('get_tournament_public_view', { p_public_code: normalizedPublicCode });

  if (error) throw error;

  return resolvePublicTournamentViewModel(data, normalizedPublicCode);
};

export const fetchTournamentParticipants = async ({ tournamentId, userId }) => {
  const { data, error } = await supabase
    .from('tournament_participants')
    .select(`
      id,
      tournament_id,
      user_id,
      display_name,
      phone_number,
      participant_code,
      registration_status,
      payment_status,
      check_in_status,
      seed_number,
      notes,
      created_at,
      updated_at
    `)
    .eq('tournament_id', tournamentId)
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return Array.isArray(data) ? data : [];
};

export const fetchLatestTournamentBracketSnapshot = async ({ tournamentId, userId }) => {
  const { data, error } = await supabase
    .from('tournament_bracket_snapshots')
    .select(`
      id,
      tournament_id,
      user_id,
      bracket_type,
      snapshot_status,
      participant_count,
      seeded_count,
      snapshot_json,
      created_at,
      updated_at
    `)
    .eq('tournament_id', tournamentId)
    .eq('user_id', userId)
    .in('snapshot_status', ['prepared', 'draft'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
};

export const fetchLatestTournamentBracketRun = async ({ tournamentId, userId }) => {
  const { data, error } = await supabase
    .from('tournament_bracket_runs')
    .select(`
      id,
      tournament_id,
      user_id,
      snapshot_id,
      bracket_type,
      status,
      total_rounds,
      participant_count,
      champion_name,
      champion_seed_number,
      champion_snapshot_ref,
      final_match_id,
      completed_at,
      created_at,
      updated_at
    `)
    .eq('tournament_id', tournamentId)
    .eq('user_id', userId)
    .in('status', ['prepared', 'draft', 'completed'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
};

export const fetchTournamentBracketRunsHistory = async ({ tournamentId, userId }) => {
  const { data, error } = await supabase
    .from('tournament_bracket_runs')
    .select(`
      id,
      tournament_id,
      user_id,
      snapshot_id,
      bracket_type,
      status,
      total_rounds,
      participant_count,
      champion_name,
      champion_seed_number,
      champion_snapshot_ref,
      final_match_id,
      completed_at,
      created_at,
      updated_at
    `)
    .eq('tournament_id', tournamentId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return Array.isArray(data) ? data : [];
};

export const fetchTournamentRunAuditEvents = async ({
  tournamentId,
  userId,
  limit = 30,
}) => {
  const safeLimit = Number.isFinite(Number(limit)) ? Math.max(Math.min(Number(limit), 100), 1) : 30;

  const { data, error } = await supabase
    .from('tournament_run_audit_events')
    .select(`
      id,
      tournament_id,
      user_id,
      run_id,
      snapshot_id,
      event_type,
      event_note,
      metadata_json,
      created_at
    `)
    .eq('tournament_id', tournamentId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(safeLimit);

  if (error) throw error;
  return Array.isArray(data) ? data : [];
};

export const fetchBracketRunMatches = async ({ runId, userId }) => {
  const { data, error } = await supabase
    .from('tournament_bracket_matches')
    .select(`
      id,
      run_id,
      tournament_id,
      user_id,
      round_index,
      match_index,
      bracket_side,
      source_snapshot_id,
      seed_a,
      seed_b,
      participant_a_name,
      participant_b_name,
      participant_a_snapshot_ref,
      participant_b_snapshot_ref,
      match_status,
      score_a,
      score_b,
      winner_participant_name,
      winner_seed_number,
      winner_source_slot,
      winner_snapshot_ref,
      completed_at,
      winner_slot_target_id,
      loser_slot_target_id,
      created_at,
      updated_at
    `)
    .eq('run_id', runId)
    .eq('user_id', userId)
    .order('round_index', { ascending: true })
    .order('match_index', { ascending: true });

  if (error) throw error;
  return Array.isArray(data) ? data : [];
};

export const createTournament = async ({
  userId,
  template,
  baseValues,
  dynamicSettings,
  recommendationMeta,
}) => {
  const tournamentName = String(baseValues?.name || '').trim();
  const eventDate = baseValues?.event_date ? new Date(baseValues.event_date) : null;
  if (!tournamentName) throw new Error('Nama tournament wajib diisi.');
  if (!eventDate || Number.isNaN(eventDate.getTime())) throw new Error('Tarikh event tidak sah.');

  const maxPlayers = Number.parseInt(baseValues?.max_players, 10);
  const roundTimeMinutes = Number.parseInt(baseValues?.round_time_minutes, 10);
  const entryFee = Number.parseFloat(baseValues?.entry_fee || 0);

  const payload = {
    user_id: userId,
    template_id: template?.id || null,
    name: tournamentName,
    slug: toTournamentSlug(tournamentName),
    category: String(baseValues?.category || template?.category || 'General').trim() || 'General',
    bracket_type: String(baseValues?.bracket_type || '').trim(),
    status: 'draft',
    event_date: eventDate.toISOString(),
    venue: String(baseValues?.venue || '').trim(),
    entry_fee: Number.isFinite(entryFee) ? Math.max(entryFee, 0) : 0,
    max_players: Number.isFinite(maxPlayers) ? Math.max(maxPlayers, 2) : 8,
    match_format: normalizeMatchFormat(baseValues?.match_format),
    round_time_minutes: Number.isFinite(roundTimeMinutes) ? Math.max(roundTimeMinutes, 1) : 20,
    notes: String(baseValues?.notes || '').trim() || null,
    settings_json: {
      template_slug: template?.slug || 'custom',
      template_name: template?.name || 'Custom',
      dynamic_settings: dynamicSettings || {},
      bracket_recommendation: recommendationMeta || null,
      recommended_participant_sizes: baseValues?.recommended_participant_sizes || [],
    },
  };

  const { data, error } = await supabase
    .from('tournaments')
    .insert(payload)
    .select(`
      id,
      user_id,
      template_id,
      name,
      slug,
      public_code,
      short_code,
      category,
      bracket_type,
      status,
      event_date,
      venue,
      entry_fee,
      max_players,
      match_format,
      round_time_minutes,
      settings_json,
      notes,
      created_at,
      updated_at
    `)
    .single();

  if (error) throw error;
  return data;
};

export const createTournamentParticipant = async ({
  tournamentId,
  userId,
  values,
}) => {
  const payload = {
    tournament_id: tournamentId,
    user_id: userId,
    display_name: String(values?.display_name || '').trim(),
    phone_number: String(values?.phone_number || '').trim() || null,
    registration_status: String(values?.registration_status || 'registered'),
    payment_status: String(values?.payment_status || 'unpaid'),
    check_in_status: String(values?.check_in_status || 'not_checked_in'),
    notes: String(values?.notes || '').trim() || null,
  };

  if (!payload.display_name) throw new Error('Nama peserta wajib diisi.');

  const { data, error } = await supabase
    .from('tournament_participants')
    .insert(payload)
    .select(`
      id,
      tournament_id,
      user_id,
      display_name,
      phone_number,
      participant_code,
      registration_status,
      payment_status,
      check_in_status,
      seed_number,
      notes,
      created_at,
      updated_at
    `)
    .single();

  if (error) throw error;
  return data;
};

export const updateTournamentParticipant = async ({
  participantId,
  userId,
  values,
  tournamentId,
}) => {
  const payload = {};

  if (values?.display_name !== undefined) {
    const trimmed = String(values.display_name || '').trim();
    if (!trimmed) throw new Error('Nama peserta wajib diisi.');
    payload.display_name = trimmed;
  }

  if (values?.phone_number !== undefined) {
    payload.phone_number = String(values.phone_number || '').trim() || null;
  }

  if (values?.registration_status !== undefined) {
    payload.registration_status = String(values.registration_status || '').trim() || 'registered';
    if (payload.registration_status === 'dropped') {
      payload.seed_number = null;
    }
  }

  if (values?.payment_status !== undefined) {
    payload.payment_status = String(values.payment_status || '').trim() || 'unpaid';
  }

  if (values?.check_in_status !== undefined) {
    payload.check_in_status = String(values.check_in_status || '').trim() || 'not_checked_in';
  }

  if (values?.seed_number !== undefined) {
    if (values.seed_number === null || values.seed_number === '') {
      payload.seed_number = null;
    } else {
      const normalized = normalizeSeedNumberInput(values.seed_number);
      if (!normalized.isValid) {
        throw new Error(normalized.reason || 'Seed number tidak sah.');
      }
      payload.seed_number = normalized.value;
    }
  }

  if (values?.notes !== undefined) {
    payload.notes = String(values.notes || '').trim() || null;
  }

  const { data, error } = await supabase
    .from('tournament_participants')
    .update(payload)
    .eq('id', participantId)
    .eq('user_id', userId)
    .eq('tournament_id', tournamentId)
    .select(`
      id,
      tournament_id,
      user_id,
      display_name,
      phone_number,
      participant_code,
      registration_status,
      payment_status,
      check_in_status,
      seed_number,
      notes,
      created_at,
      updated_at
    `)
    .single();

  if (error) throw error;
  return data;
};

export const bulkAssignTournamentSeeds = async ({
  tournamentId,
  userId,
  assignments,
}) => {
  if (!Array.isArray(assignments) || assignments.length === 0) {
    return { updatedCount: 0 };
  }

  for (const assignment of assignments) {
    const normalized = normalizeSeedNumberInput(assignment?.seedNumber);
    if (!normalized.isValid || normalized.value === null) {
      throw new Error(normalized.reason || 'Seed number tidak sah.');
    }

    const { error } = await supabase
      .from('tournament_participants')
      .update({ seed_number: normalized.value })
      .eq('id', assignment.participantId)
      .eq('tournament_id', tournamentId)
      .eq('user_id', userId)
      .eq('registration_status', 'registered');

    if (error) throw error;
  }

  return { updatedCount: assignments.length };
};

export const autoAssignTournamentSeeds = async ({
  tournamentId,
  userId,
}) => {
  const participants = await fetchTournamentParticipants({ tournamentId, userId });
  const assignments = buildAutoSeedAssignments(participants);
  return bulkAssignTournamentSeeds({
    tournamentId,
    userId,
    assignments,
  });
};

export const clearTournamentSeeds = async ({
  tournamentId,
  userId,
}) => {
  const { error } = await supabase
    .from('tournament_participants')
    .update({ seed_number: null })
    .eq('tournament_id', tournamentId)
    .eq('user_id', userId);

  if (error) throw error;
  return true;
};

export const prepareTournamentBracketSnapshot = async ({
  tournamentId,
  userId,
  tournament,
  forceReprepare = false,
}) => {
  const participants = await fetchTournamentParticipants({ tournamentId, userId });
  const readiness = validateBracketPreparationReadiness({ tournament, participants });

  if (!readiness.supportedBracket) {
    throw new Error('Bracket draft preview currently supports Single Elimination only.');
  }

  if (!readiness.canPrepare) {
    throw new Error(readiness.message || 'Bracket input is not ready.');
  }

  const existingSnapshot = await fetchLatestTournamentBracketSnapshot({ tournamentId, userId });
  if (existingSnapshot?.id && existingSnapshot.snapshot_status === 'prepared' && !forceReprepare) {
    throw new Error('Prepared snapshot already exists. Confirm to create a new snapshot.');
  }

  if (existingSnapshot?.id && existingSnapshot.snapshot_status === 'prepared') {
    const { error: archiveError } = await supabase
      .from('tournament_bracket_snapshots')
      .update({ snapshot_status: 'archived' })
      .eq('tournament_id', tournamentId)
      .eq('user_id', userId)
      .eq('snapshot_status', 'prepared');
    if (archiveError) throw archiveError;
  }

  const snapshotData = buildBracketInputSnapshot({ tournament, participants });
  const preparedPayload = {
    tournament_id: tournamentId,
    user_id: userId,
    bracket_type: String(tournament?.bracket_type || 'single_elimination'),
    snapshot_status: 'prepared',
    participant_count: Number(snapshotData?.readiness?.active_count || 0),
    seeded_count: Number(snapshotData?.readiness?.seeded_count || 0),
    snapshot_json: snapshotData,
  };

  const { data, error } = await supabase
    .from('tournament_bracket_snapshots')
    .insert(preparedPayload)
    .select(`
      id,
      tournament_id,
      user_id,
      bracket_type,
      snapshot_status,
      participant_count,
      seeded_count,
      snapshot_json,
      created_at,
      updated_at
    `)
    .single();

  if (error) throw error;
  return data;
};

const createBracketRunFromPreparedSnapshot = async ({
  tournamentId,
  userId,
  snapshot,
  auditContext = {},
}) => {
  const skeleton = generateSingleEliminationMatchSkeleton(snapshot);

  const { data: createdRun, error: createRunError } = await supabase
    .from('tournament_bracket_runs')
    .insert({
      tournament_id: tournamentId,
      user_id: userId,
      snapshot_id: snapshot.id,
      bracket_type: snapshot.bracket_type,
      status: RUN_STATUS.PREPARED,
      total_rounds: skeleton.total_rounds,
      participant_count: skeleton.participant_count,
    })
    .select(`
      id,
      tournament_id,
      user_id,
      snapshot_id,
      bracket_type,
      status,
      total_rounds,
      participant_count,
      created_at,
      updated_at
    `)
    .single();
  if (createRunError) throw createRunError;

  const matchRows = skeleton.matches.map((match) => ({
    run_id: createdRun.id,
    tournament_id: tournamentId,
    user_id: userId,
    round_index: match.round_index,
    match_index: match.match_index,
    bracket_side: null,
    source_snapshot_id: snapshot.id,
    seed_a: match.seed_a,
    seed_b: match.seed_b,
    participant_a_name: match.participant_a_name,
    participant_b_name: match.participant_b_name,
    participant_a_snapshot_ref: match.participant_a_snapshot_ref,
    participant_b_snapshot_ref: match.participant_b_snapshot_ref,
    match_status: match.match_status,
  }));

  const { data: insertedMatches, error: insertMatchesError } = await supabase
    .from('tournament_bracket_matches')
    .insert(matchRows)
    .select(`
      id,
      round_index,
      match_index
    `);
  if (insertMatchesError) throw insertMatchesError;

  const matchIdByPosition = new Map(
    (Array.isArray(insertedMatches) ? insertedMatches : []).map((match) => [
      `${match.round_index}:${match.match_index}`,
      match.id,
    ])
  );

  for (const match of skeleton.matches) {
    if (!match.next_round_index || !match.next_match_index) continue;
    const matchId = matchIdByPosition.get(`${match.round_index}:${match.match_index}`);
    const winnerTargetId = matchIdByPosition.get(`${match.next_round_index}:${match.next_match_index}`);
    if (!matchId || !winnerTargetId) continue;

    const { error: updateTargetError } = await supabase
      .from('tournament_bracket_matches')
      .update({ winner_slot_target_id: winnerTargetId })
      .eq('id', matchId)
      .eq('run_id', createdRun.id)
      .eq('user_id', userId);
    if (updateTargetError) throw updateTargetError;
  }

  await logRunAuditEvent({
    tournamentId,
    userId,
    runId: createdRun.id,
    snapshotId: snapshot.id,
    eventType: RUN_AUDIT_EVENT_TYPE.RUN_CREATED,
    eventNote: auditContext.runCreatedNote || 'Run created from prepared snapshot.',
    metadata: {
      bracket_type: snapshot.bracket_type,
      total_rounds: createdRun.total_rounds,
      participant_count: createdRun.participant_count,
      source: auditContext.source || 'run_generation',
      ...(auditContext.metadata || {}),
    },
  });

  try {
    await syncTournamentStatusFromRunTransition({
      tournamentId,
      userId,
      runStatus: createdRun?.status || RUN_STATUS.PREPARED,
    });
  } catch (syncError) {
    logTournamentStatusSyncWarning({
      tournamentId,
      userId,
      source: auditContext.source || 'run_generation',
      runStatus: createdRun?.status || RUN_STATUS.PREPARED,
      nextStatus: 'ongoing',
      error: syncError,
    });
  }

  return createdRun;
};

export const createBracketRunFromSnapshot = async ({
  tournamentId,
  userId,
  forceRegenerate = false,
  forceRebuild = false,
}) => {
  const snapshot = await fetchLatestTournamentBracketSnapshot({ tournamentId, userId });
  if (!snapshot?.id || snapshot.snapshot_status !== 'prepared') {
    throw new Error('Prepared snapshot not found. Prepare snapshot first.');
  }

  if (snapshot.bracket_type !== 'single_elimination') {
    throw new Error('Bracket run foundation currently supports Single Elimination only.');
  }

  const existingLatestRun = await fetchLatestTournamentBracketRun({ tournamentId, userId });
  if (existingLatestRun?.id && isRunFinalized(existingLatestRun)) {
    throw new Error('Run already finalized and locked. New rebuild is disabled for this tournament.');
  }

  if (existingLatestRun?.id && String(existingLatestRun.status || '') === RUN_STATUS.PREPARED) {
    const isSameSnapshot = existingLatestRun.snapshot_id === snapshot.id;
    if (isSameSnapshot && !forceRebuild) {
      return { run: existingLatestRun, reused: true };
    }

    if (!isSameSnapshot && !forceRegenerate && !forceRebuild) {
      throw new Error('Prepared bracket run already exists. Confirm to regenerate from latest snapshot.');
    }

    await archivePreparedRunRows({
      tournamentId,
      userId,
      note: 'Prepared run archived before generating replacement run.',
      metadata: {
        source: forceRebuild ? 'rebuild_run' : 'generate_run',
      },
    });
  }

  const run = await createBracketRunFromPreparedSnapshot({
    tournamentId,
    userId,
    snapshot,
    auditContext: {
      source: forceRebuild ? 'rebuild_run' : 'generate_run',
      runCreatedNote: forceRebuild
        ? 'Run created from prepared snapshot (rebuild flow).'
        : 'Run created from prepared snapshot.',
    },
  });

  return { run, reused: false };
};

export const rebuildBracketRunFromPreparedSnapshot = async ({
  tournamentId,
  userId,
}) => {
  const result = await createBracketRunFromSnapshot({
    tournamentId,
    userId,
    forceRegenerate: true,
    forceRebuild: true,
  });

  if (result?.run?.id) {
    await logRunAuditEvent({
      tournamentId,
      userId,
      runId: result.run.id,
      snapshotId: result.run.snapshot_id || null,
      eventType: RUN_AUDIT_EVENT_TYPE.RUN_REBUILT_FROM_SNAPSHOT,
      eventNote: 'Run rebuilt from latest prepared snapshot.',
      metadata: {
        source: 'rebuild_run',
      },
    });
  }

  return result;
};

export const canStartNewRunFromSnapshot = async ({
  tournamentId,
  userId,
}) => {
  const snapshot = await fetchLatestTournamentBracketSnapshot({ tournamentId, userId });
  if (!snapshot?.id || snapshot.snapshot_status !== 'prepared') {
    return {
      canStart: false,
      reason: 'Prepared snapshot not found. Prepare snapshot first.',
      snapshot: null,
      currentRun: null,
      willArchivePreparedRun: false,
    };
  }

  if (snapshot.bracket_type !== 'single_elimination') {
    return {
      canStart: false,
      reason: 'Start new run currently supports Single Elimination only.',
      snapshot,
      currentRun: null,
      willArchivePreparedRun: false,
    };
  }

  const currentRun = await fetchLatestTournamentBracketRun({ tournamentId, userId });
  const currentStatus = String(currentRun?.status || '').trim();

  if (currentRun?.id && currentStatus === RUN_STATUS.DRAFT) {
    return {
      canStart: false,
      reason: 'Current run is still draft. Complete setup first before starting a fresh run.',
      snapshot,
      currentRun,
      willArchivePreparedRun: false,
    };
  }

  if (currentRun?.id && currentStatus === RUN_STATUS.PREPARED) {
    return {
      canStart: true,
      reason: 'Current prepared run will be archived before starting the new run.',
      snapshot,
      currentRun,
      willArchivePreparedRun: true,
    };
  }

  return {
    canStart: true,
    reason: '',
    snapshot,
    currentRun: currentRun || null,
    willArchivePreparedRun: false,
  };
};

export const startNewRunFromPreparedSnapshot = async ({
  tournamentId,
  userId,
}) => {
  const eligibility = await canStartNewRunFromSnapshot({ tournamentId, userId });
  if (!eligibility.canStart) {
    throw new Error(eligibility.reason || 'Cannot start new run from snapshot.');
  }

  if (eligibility.willArchivePreparedRun) {
    await archivePreparedRunRows({
      tournamentId,
      userId,
      note: 'Prepared run archived before starting a new run.',
      metadata: {
        source: 'start_new_run',
      },
    });
  }

  const run = await createBracketRunFromPreparedSnapshot({
    tournamentId,
    userId,
    snapshot: eligibility.snapshot,
    auditContext: {
      source: 'start_new_run',
      runCreatedNote: 'Run created from prepared snapshot (start new run flow).',
      metadata: {
        previous_run_id: eligibility.currentRun?.id || null,
        previous_run_status: eligibility.currentRun?.status || null,
      },
    },
  });

  await logRunAuditEvent({
    tournamentId,
    userId,
    runId: run.id,
    snapshotId: eligibility.snapshot.id,
    eventType: RUN_AUDIT_EVENT_TYPE.NEW_RUN_STARTED_FROM_SNAPSHOT,
    eventNote: 'New run started from prepared snapshot.',
    metadata: {
      previous_run_id: eligibility.currentRun?.id || null,
      previous_run_status: eligibility.currentRun?.status || null,
      source: 'start_new_run',
    },
  });

  return {
    run,
    started: true,
    previousRunId: eligibility.currentRun?.id || null,
    previousRunStatus: eligibility.currentRun?.status || null,
  };
};

const getMatchNotReadyMessage = (matchStatus) => {
  const normalized = String(matchStatus || '').trim();
  if (normalized === MATCH_STATUS.LOCKED) {
    return 'Match is locked for a future round.';
  }
  if (normalized === MATCH_STATUS.PENDING) {
    return 'Match is not ready. Participant slots are incomplete.';
  }
  return 'Match is not eligible for winner assignment.';
};

const getTargetSlotFields = (targetSlot) => (
  targetSlot === 'A'
    ? {
      nameField: 'participant_a_name',
      seedField: 'seed_a',
      refField: 'participant_a_snapshot_ref',
    }
    : {
      nameField: 'participant_b_name',
      seedField: 'seed_b',
      refField: 'participant_b_snapshot_ref',
    }
);

const fetchEditableBracketRunOrThrow = async ({
  runId,
  tournamentId,
  userId,
}) => {
  const { data: run, error: runError } = await supabase
    .from('tournament_bracket_runs')
    .select(`
      id,
      tournament_id,
      user_id,
      snapshot_id,
      bracket_type,
      status,
      total_rounds
    `)
    .eq('id', runId)
    .eq('tournament_id', tournamentId)
    .eq('user_id', userId)
    .single();
  if (runError) throw runError;

  if (!run?.id) {
    throw new Error('Bracket run not found.');
  }

  if (run.bracket_type !== 'single_elimination') {
    throw new Error('Bracket progression currently supports Single Elimination only.');
  }

  if (!isRunEditable(run)) {
    throw new Error('Bracket run is not in an editable state.');
  }

  return run;
};

const getResetBlockedMessage = ({
  hasCurrentWinner,
  slotExistingName,
  currentWinnerName,
  targetMatch,
}) => {
  if (!hasCurrentWinner) {
    return 'Match has no winner result to reopen.';
  }

  if (!targetMatch) {
    return '';
  }

  if (!slotExistingName && isDownstreamLockedForCorrection(targetMatch)) {
    return 'Downstream match already depends on this progression. Rebuild bracket from snapshot.';
  }

  if (slotExistingName && slotExistingName !== currentWinnerName) {
    return 'Downstream slot no longer matches this winner. Rebuild bracket from snapshot.';
  }

  if (slotExistingName === currentWinnerName && isDownstreamLockedForCorrection(targetMatch)) {
    return 'Cannot reopen match because downstream match already has confirmed progression.';
  }

  return '';
};

export const assignTournamentMatchWinner = async ({
  runId,
  tournamentId,
  userId,
  matchId,
  selectedSide,
  scoreA,
  scoreB,
  matchFormat,
}) => {
  const run = await fetchEditableBracketRunOrThrow({ runId, tournamentId, userId });

  const matches = await fetchBracketRunMatches({ runId: run.id, userId });
  const currentMatch = matches.find((match) => match.id === matchId);
  if (!currentMatch) {
    throw new Error('Match not found in current run.');
  }

  if (!canAssignWinner(currentMatch)) {
    throw new Error(getMatchNotReadyMessage(currentMatch.match_status));
  }

  const normalizedMatchFormat = normalizeMatchFormat(matchFormat);
  const normalizedSelectedSide = String(selectedSide || '').trim().toUpperCase();
  const hasScoreInput = (
    scoreA !== undefined
    || scoreB !== undefined
  );

  let winnerPayload = null;
  let nextScoreA = null;
  let nextScoreB = null;

  if (normalizedSelectedSide === 'BYE') {
    winnerPayload = resolveMatchWinnerPayload(currentMatch, 'BYE');
  } else if (hasScoreInput) {
    const scoreResolution = resolveWinnerFromScore({
      match: currentMatch,
      matchFormat: normalizedMatchFormat,
      scoreA,
      scoreB,
    });
    winnerPayload = scoreResolution.winnerPayload;
    nextScoreA = scoreResolution.normalizedScoreA;
    nextScoreB = scoreResolution.normalizedScoreB;
  } else {
    if (!isManualWinnerAllowed(normalizedMatchFormat)) {
      throw new Error('Score input is required for BO3/BO5 matches.');
    }
    winnerPayload = resolveMatchWinnerPayload(currentMatch, normalizedSelectedSide);
    if (winnerPayload.winner_source_slot === 'A') {
      nextScoreA = 1;
      nextScoreB = 0;
    } else if (winnerPayload.winner_source_slot === 'B') {
      nextScoreA = 0;
      nextScoreB = 1;
    }
  }

  const oldWinnerName = String(currentMatch.winner_participant_name || '').trim();
  const oldScoreA = Number.isInteger(currentMatch.score_a) ? currentMatch.score_a : null;
  const oldScoreB = Number.isInteger(currentMatch.score_b) ? currentMatch.score_b : null;
  const nextWinnerName = String(winnerPayload.winner_participant_name || '').trim();

  if (
    oldWinnerName
    && oldWinnerName === nextWinnerName
    && oldScoreA === nextScoreA
    && oldScoreB === nextScoreB
  ) {
    return {
      updated: false,
      reused: true,
      matchId: currentMatch.id,
      winner: winnerPayload,
      score: { scoreA: oldScoreA, scoreB: oldScoreB },
    };
  }

  let targetMatch = null;
  let targetSlot = null;
  let targetUpdatePayload = null;
  let previousTargetPayload = null;

  if (currentMatch.winner_slot_target_id) {
    targetMatch = matches.find((match) => match.id === currentMatch.winner_slot_target_id);
    if (!targetMatch) {
      throw new Error('Next round match target is missing. Regenerate bracket structure.');
    }

    targetSlot = getPropagationTargetSlot(currentMatch.match_index);
    const { nameField, seedField, refField } = getTargetSlotFields(targetSlot);
    const slotExistingName = String(targetMatch?.[nameField] || '').trim();

    if (
      isDownstreamLockedForCorrection(targetMatch)
      && slotExistingName !== nextWinnerName
    ) {
      throw new Error('Cannot assign winner because next-round progression already depends on this match.');
    }

    const overwriteDecision = canOverwriteDownstreamSlot({
      targetMatch,
      targetSlot,
      oldWinnerName,
      newWinnerName: winnerPayload.winner_participant_name,
    });

    if (!overwriteDecision.canOverwrite) {
      throw new Error(overwriteDecision.reason || 'Downstream slot is not safe to overwrite.');
    }

    previousTargetPayload = {
      [nameField]: targetMatch[nameField],
      [seedField]: targetMatch[seedField],
      [refField]: targetMatch[refField],
      match_status: targetMatch.match_status,
    };

    const candidateTarget = {
      ...targetMatch,
      [nameField]: winnerPayload.winner_participant_name,
      [seedField]: winnerPayload.winner_seed_number,
      [refField]: winnerPayload.winner_snapshot_ref,
    };

    targetUpdatePayload = {
      [nameField]: winnerPayload.winner_participant_name,
      [seedField]: winnerPayload.winner_seed_number,
      [refField]: winnerPayload.winner_snapshot_ref,
      match_status: resolveMatchStatus(candidateTarget),
    };

    const { error: updateTargetError } = await supabase
      .from('tournament_bracket_matches')
      .update(targetUpdatePayload)
      .eq('id', targetMatch.id)
      .eq('run_id', run.id)
      .eq('tournament_id', tournamentId)
      .eq('user_id', userId);

    if (updateTargetError) {
      throw updateTargetError;
    }
  }

  const currentMatchUpdatePayload = {
    score_a: Number.isInteger(nextScoreA) ? nextScoreA : null,
    score_b: Number.isInteger(nextScoreB) ? nextScoreB : null,
    winner_participant_name: winnerPayload.winner_participant_name,
    winner_seed_number: winnerPayload.winner_seed_number,
    winner_source_slot: winnerPayload.winner_source_slot,
    winner_snapshot_ref: winnerPayload.winner_snapshot_ref,
    completed_at: new Date().toISOString(),
    match_status: MATCH_STATUS.COMPLETED,
  };

  const { error: updateCurrentError } = await supabase
    .from('tournament_bracket_matches')
    .update(currentMatchUpdatePayload)
    .eq('id', currentMatch.id)
    .eq('run_id', run.id)
    .eq('tournament_id', tournamentId)
    .eq('user_id', userId);

  if (updateCurrentError) {
    if (targetMatch?.id && targetUpdatePayload && previousTargetPayload) {
      await supabase
        .from('tournament_bracket_matches')
        .update(previousTargetPayload)
        .eq('id', targetMatch.id)
        .eq('run_id', run.id)
        .eq('tournament_id', tournamentId)
        .eq('user_id', userId);
    }
    throw updateCurrentError;
  }

  return {
    updated: true,
    reused: false,
    matchId: currentMatch.id,
    winner: winnerPayload,
    score: {
      scoreA: currentMatchUpdatePayload.score_a,
      scoreB: currentMatchUpdatePayload.score_b,
    },
    propagated: Boolean(targetMatch?.id),
    targetMatchId: targetMatch?.id || null,
    targetSlot,
  };
};

export const resetTournamentMatchResult = async ({
  runId,
  tournamentId,
  userId,
  matchId,
}) => {
  const run = await fetchEditableBracketRunOrThrow({ runId, tournamentId, userId });

  const matches = await fetchBracketRunMatches({ runId: run.id, userId });
  const currentMatch = matches.find((match) => match.id === matchId);
  if (!currentMatch) {
    throw new Error('Match not found in current run.');
  }

  if (!canResetMatch(currentMatch)) {
    throw new Error('Only completed matches can be reopened.');
  }

  const currentWinnerName = String(currentMatch.winner_participant_name || '').trim();
  const hasCurrentWinner = currentWinnerName.length > 0;

  let targetMatch = null;
  let targetSlot = null;
  let targetUpdatePayload = null;
  let previousTargetPayload = null;

  if (currentMatch.winner_slot_target_id) {
    targetMatch = matches.find((match) => match.id === currentMatch.winner_slot_target_id);
    if (!targetMatch) {
      throw new Error('Downstream match target is missing. Rebuild bracket from snapshot.');
    }

    targetSlot = getPropagationTargetSlot(currentMatch.match_index);
    const { nameField, seedField, refField } = getTargetSlotFields(targetSlot);
    const slotExistingName = String(targetMatch?.[nameField] || '').trim();
    const blockedMessage = getResetBlockedMessage({
      hasCurrentWinner,
      slotExistingName,
      currentWinnerName,
      targetMatch,
    });
    if (blockedMessage) {
      throw new Error(blockedMessage);
    }

    if (slotExistingName === currentWinnerName) {
      previousTargetPayload = {
        [nameField]: targetMatch[nameField],
        [seedField]: targetMatch[seedField],
        [refField]: targetMatch[refField],
        match_status: targetMatch.match_status,
      };

      const candidateTarget = {
        ...targetMatch,
        [nameField]: null,
        [seedField]: null,
        [refField]: null,
      };

      targetUpdatePayload = {
        [nameField]: null,
        [seedField]: null,
        [refField]: null,
        match_status: resolveMatchStatus(candidateTarget),
      };

      const { error: updateTargetError } = await supabase
        .from('tournament_bracket_matches')
        .update(targetUpdatePayload)
        .eq('id', targetMatch.id)
        .eq('run_id', run.id)
        .eq('tournament_id', tournamentId)
        .eq('user_id', userId);
      if (updateTargetError) throw updateTargetError;
    }
  }

  const currentResetPayload = buildResetMatchPayload(currentMatch);

  const { error: updateCurrentError } = await supabase
    .from('tournament_bracket_matches')
    .update(currentResetPayload)
    .eq('id', currentMatch.id)
    .eq('run_id', run.id)
    .eq('tournament_id', tournamentId)
    .eq('user_id', userId);

  if (updateCurrentError) {
    if (targetMatch?.id && targetUpdatePayload && previousTargetPayload) {
      await supabase
        .from('tournament_bracket_matches')
        .update(previousTargetPayload)
        .eq('id', targetMatch.id)
        .eq('run_id', run.id)
        .eq('tournament_id', tournamentId)
        .eq('user_id', userId);
    }
    throw updateCurrentError;
  }

  return {
    updated: true,
    matchId: currentMatch.id,
    reopened: true,
    clearedDownstream: Boolean(targetUpdatePayload),
    targetMatchId: targetMatch?.id || null,
    targetSlot,
  };
};

export const fetchTournamentRunCompletionSummary = async ({
  tournamentId,
  userId,
}) => {
  const run = await fetchLatestTournamentBracketRun({ tournamentId, userId });
  const participants = await fetchTournamentParticipants({ tournamentId, userId });

  if (!run?.id) {
    return {
      run: null,
      summary: getRunCompletionSummary({
        run: null,
        matches: [],
        participants,
      }),
    };
  }

  const matches = await fetchBracketRunMatches({ runId: run.id, userId });
  return {
    run,
    summary: getRunCompletionSummary({
      run,
      matches,
      participants,
    }),
  };
};

export const finalizeTournamentBracketRun = async ({
  runId,
  tournamentId,
  userId,
}) => {
  const run = await fetchEditableBracketRunOrThrow({ runId, tournamentId, userId });
  if (!canTransitionRunStatus(run.status, RUN_STATUS.COMPLETED)) {
    throw new Error('Run status is not eligible for completion.');
  }
  const matches = await fetchBracketRunMatches({ runId: run.id, userId });
  const completionCheck = isBracketRunCompletable({ run, matches });
  if (!completionCheck.canFinalize) {
    throw new Error(completionCheck.reason || 'Run is not ready for finalization.');
  }

  const champion = resolveRunChampion({ run, matches });
  if (!champion?.champion_name) {
    throw new Error('Champion cannot be resolved from final match.');
  }

  const finalizedAt = new Date().toISOString();
  const finalizePayload = {
    status: RUN_STATUS.COMPLETED,
    champion_name: champion.champion_name,
    champion_seed_number: champion.champion_seed_number,
    champion_snapshot_ref: champion.champion_snapshot_ref,
    final_match_id: champion.final_match_id,
    completed_at: finalizedAt,
  };

  const { data, error } = await supabase
    .from('tournament_bracket_runs')
    .update(finalizePayload)
    .eq('id', run.id)
    .eq('tournament_id', tournamentId)
    .eq('user_id', userId)
    .select(`
      id,
      tournament_id,
      user_id,
      snapshot_id,
      bracket_type,
      status,
      total_rounds,
      participant_count,
      champion_name,
      champion_seed_number,
      champion_snapshot_ref,
      final_match_id,
      completed_at,
      created_at,
      updated_at
    `)
    .single();

  if (error) throw error;

  await logRunAuditEvent({
    tournamentId,
    userId,
    runId: data.id,
    snapshotId: data.snapshot_id || null,
    eventType: RUN_AUDIT_EVENT_TYPE.RUN_COMPLETED,
    eventNote: 'Run finalized and locked.',
    metadata: {
      champion_name: data.champion_name || null,
      champion_seed_number: data.champion_seed_number ?? null,
      completed_at: data.completed_at || finalizedAt,
      source: 'finalize_run',
    },
  });

  try {
    await syncTournamentStatusFromRunTransition({
      tournamentId,
      userId,
      runStatus: RUN_STATUS.COMPLETED,
    });
  } catch (syncError) {
    logTournamentStatusSyncWarning({
      tournamentId,
      userId,
      source: 'finalize_run',
      runStatus: RUN_STATUS.COMPLETED,
      nextStatus: 'completed',
      error: syncError,
    });
  }

  return data;
};

export const deleteTournamentParticipant = async ({
  participantId,
  userId,
}) => {
  const { error } = await supabase
    .from('tournament_participants')
    .delete()
    .eq('id', participantId)
    .eq('user_id', userId);

  if (error) throw error;
  return true;
};
