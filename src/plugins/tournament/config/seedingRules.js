import { REGISTRATION_STATUS } from '@/plugins/tournament/config/participantStatuses';

export const MIN_ACTIVE_PARTICIPANTS = 2;
export const MAX_SEED_NUMBER = 4096;

const normalizeDateMs = (value) => {
  const parsed = new Date(value || '');
  const time = parsed.getTime();
  return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
};

export const isParticipantActiveForSeeding = (participant) => (
  String(participant?.registration_status || '') === REGISTRATION_STATUS.REGISTERED
);

export const normalizeSeedNumberInput = (value) => {
  if (value === null || value === undefined || value === '') {
    return { value: null, isValid: true, reason: '' };
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return { value: null, isValid: false, reason: 'Seed mesti nombor bulat.' };
  }

  if (parsed < 1 || parsed > MAX_SEED_NUMBER) {
    return { value: null, isValid: false, reason: `Seed mesti antara 1 hingga ${MAX_SEED_NUMBER}.` };
  }

  return { value: parsed, isValid: true, reason: '' };
};

export const getEligibleParticipantsForBracket = (participants = []) => (
  (Array.isArray(participants) ? participants : [])
    .filter((participant) => isParticipantActiveForSeeding(participant))
);

export const getParticipantsSortedBySeed = (participants = []) => (
  getEligibleParticipantsForBracket(participants)
    .filter((participant) => Number.isInteger(participant.seed_number) && participant.seed_number > 0)
    .sort((left, right) => {
      if (left.seed_number !== right.seed_number) return left.seed_number - right.seed_number;
      return normalizeDateMs(left.created_at) - normalizeDateMs(right.created_at);
    })
);

const getDuplicateSeedNumbers = (participants = []) => {
  const counter = new Map();
  getEligibleParticipantsForBracket(participants).forEach((participant) => {
    if (!Number.isInteger(participant.seed_number) || participant.seed_number <= 0) return;
    counter.set(participant.seed_number, (counter.get(participant.seed_number) || 0) + 1);
  });

  return Array.from(counter.entries())
    .filter(([, count]) => count > 1)
    .map(([seed]) => seed)
    .sort((left, right) => left - right);
};

export const buildAutoSeedAssignments = (participants = []) => (
  getEligibleParticipantsForBracket(participants)
    .slice()
    .sort((left, right) => {
      const byDate = normalizeDateMs(left.created_at) - normalizeDateMs(right.created_at);
      if (byDate !== 0) return byDate;
      return String(left.id || '').localeCompare(String(right.id || ''));
    })
    .map((participant, index) => ({
      participantId: participant.id,
      seedNumber: index + 1,
    }))
);

export const validateTournamentSeedingReadiness = (participants = [], options = {}) => {
  const minActive = Number.isFinite(Number(options.minActive))
    ? Math.max(Number(options.minActive), 1)
    : MIN_ACTIVE_PARTICIPANTS;

  const eligible = getEligibleParticipantsForBracket(participants);
  const seeded = eligible.filter((participant) => Number.isInteger(participant.seed_number) && participant.seed_number > 0);
  const duplicateSeeds = getDuplicateSeedNumbers(participants);
  const droppedWithSeed = (Array.isArray(participants) ? participants : []).filter(
    (participant) => !isParticipantActiveForSeeding(participant) && Number.isInteger(participant.seed_number) && participant.seed_number > 0
  );
  const unseededCount = Math.max(eligible.length - seeded.length, 0);

  let level = 'ready';
  let message = `${eligible.length} peserta aktif, semua seed sah.`;

  if (eligible.length < minActive) {
    level = 'not_ready';
    message = `Perlu sekurang-kurangnya ${minActive} peserta aktif.`;
  } else if (duplicateSeeds.length > 0) {
    level = 'not_ready';
    message = `Seed bertindih dikesan: #${duplicateSeeds.join(', #')}.`;
  } else if (droppedWithSeed.length > 0) {
    level = 'not_ready';
    message = 'Ada peserta dropped masih mempunyai seed.';
  } else if (unseededCount > 0) {
    level = 'warning';
    message = `${unseededCount} peserta aktif belum ada seed.`;
  }

  return {
    level,
    message,
    minActive,
    activeCount: eligible.length,
    seededCount: seeded.length,
    unseededCount,
    duplicateSeeds,
    droppedWithSeedCount: droppedWithSeed.length,
  };
};
