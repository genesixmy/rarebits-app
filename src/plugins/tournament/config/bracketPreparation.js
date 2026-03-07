import {
  MIN_ACTIVE_PARTICIPANTS,
  getEligibleParticipantsForBracket,
  getParticipantsSortedBySeed,
  validateTournamentSeedingReadiness,
} from '@/plugins/tournament/config/seedingRules';

const SUPPORTED_BRACKET_TYPES = Object.freeze(['single_elimination']);

const isSupportedBracketType = (bracketType) => (
  SUPPORTED_BRACKET_TYPES.includes(String(bracketType || '').trim())
);

const toNextPowerOfTwo = (value) => {
  const normalized = Math.max(Number(value) || 0, 1);
  return 2 ** Math.ceil(Math.log2(normalized));
};

const buildSeedPlacementOrder = (bracketSize) => {
  if (bracketSize <= 1) return [1];
  const previous = buildSeedPlacementOrder(Math.floor(bracketSize / 2));
  const output = [];
  previous.forEach((seed) => {
    output.push(seed);
    output.push((bracketSize + 1) - seed);
  });
  return output;
};

const toParticipantSnapshot = (participant) => ({
  id: participant.id,
  display_name: participant.display_name,
  participant_code: participant.participant_code || null,
  seed_number: participant.seed_number,
  registration_status: participant.registration_status,
  payment_status: participant.payment_status,
  check_in_status: participant.check_in_status,
});

export const getBracketEligibleParticipants = (participants = []) => (
  getEligibleParticipantsForBracket(participants)
);

export const validateBracketPreparationReadiness = ({ tournament, participants }) => {
  const bracketType = String(tournament?.bracket_type || '').trim();
  const supportedBracket = isSupportedBracketType(bracketType);
  const seedingReadiness = validateTournamentSeedingReadiness(participants, {
    minActive: MIN_ACTIVE_PARTICIPANTS,
  });

  const errors = [];
  const warnings = [];

  if (!supportedBracket) {
    errors.push('Bracket draft preview currently supports Single Elimination only.');
  }

  if (seedingReadiness.activeCount < MIN_ACTIVE_PARTICIPANTS) {
    errors.push(`Need at least ${MIN_ACTIVE_PARTICIPANTS} active participants.`);
  }

  if (seedingReadiness.duplicateSeeds.length > 0) {
    errors.push(`Duplicate seeds detected: #${seedingReadiness.duplicateSeeds.join(', #')}.`);
  }

  if (seedingReadiness.droppedWithSeedCount > 0) {
    errors.push('Dropped participants still have seeds assigned.');
  }

  if (seedingReadiness.unseededCount > 0) {
    warnings.push(`${seedingReadiness.unseededCount} active participants are still unseeded.`);
  }

  const canPrepare = errors.length === 0 && warnings.length === 0;
  const level = errors.length > 0 ? 'not_ready' : (warnings.length > 0 ? 'warning' : 'ready');

  let message = 'Bracket input is ready to snapshot.';
  if (errors.length > 0) {
    message = errors[0];
  } else if (warnings.length > 0) {
    message = warnings[0];
  }

  return {
    level,
    canPrepare,
    message,
    supportedBracket,
    bracketType,
    activeCount: seedingReadiness.activeCount,
    seededCount: seedingReadiness.seededCount,
    unseededCount: seedingReadiness.unseededCount,
    duplicateSeeds: seedingReadiness.duplicateSeeds,
    droppedWithSeedCount: seedingReadiness.droppedWithSeedCount,
    errors,
    warnings,
  };
};

const buildSingleEliminationDraft = (seededParticipants) => {
  const participantCount = seededParticipants.length;
  const bracketSize = toNextPowerOfTwo(Math.max(participantCount, MIN_ACTIVE_PARTICIPANTS));
  const seedPlacement = buildSeedPlacementOrder(bracketSize);
  const seedLookup = new Map(
    seededParticipants.map((participant) => [participant.seed_number, participant])
  );

  const firstRoundMatches = [];
  for (let index = 0; index < seedPlacement.length; index += 2) {
    const seedA = seedPlacement[index];
    const seedB = seedPlacement[index + 1];
    const participantA = seedLookup.get(seedA) || null;
    const participantB = seedLookup.get(seedB) || null;

    firstRoundMatches.push({
      match_index: (index / 2) + 1,
      round_index: 1,
      seed_a: seedA,
      seed_b: seedB,
      participant_a: participantA ? toParticipantSnapshot(participantA) : null,
      participant_b: participantB ? toParticipantSnapshot(participantB) : null,
      is_bye: !participantA || !participantB,
      bye_for_seed: !participantA ? seedB : (!participantB ? seedA : null),
    });
  }

  return {
    bracket_size: bracketSize,
    rounds_count: Math.log2(bracketSize),
    first_round_matches: firstRoundMatches,
  };
};

export const buildBracketInputSnapshot = ({ tournament, participants }) => {
  const readiness = validateBracketPreparationReadiness({ tournament, participants });
  if (!readiness.canPrepare) {
    throw new Error(readiness.message || 'Bracket input is not ready.');
  }

  const seededParticipants = getParticipantsSortedBySeed(participants);
  const bracketDraft = buildSingleEliminationDraft(seededParticipants);

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    tournament: {
      id: tournament.id,
      name: tournament.name,
      bracket_type: tournament.bracket_type,
      status: tournament.status,
      event_date: tournament.event_date,
    },
    readiness: {
      min_active_participants: MIN_ACTIVE_PARTICIPANTS,
      active_count: readiness.activeCount,
      seeded_count: readiness.seededCount,
    },
    participants: seededParticipants.map((participant) => toParticipantSnapshot(participant)),
    bracket_draft: bracketDraft,
  };
};
