export const RUN_STATUS = Object.freeze({
  DRAFT: 'draft',
  PREPARED: 'prepared',
  ARCHIVED: 'archived',
  COMPLETED: 'completed',
});

export const RUN_STATUS_TRANSITIONS = Object.freeze({
  [RUN_STATUS.DRAFT]: [RUN_STATUS.PREPARED, RUN_STATUS.ARCHIVED],
  [RUN_STATUS.PREPARED]: [RUN_STATUS.COMPLETED, RUN_STATUS.ARCHIVED],
  [RUN_STATUS.ARCHIVED]: [],
  [RUN_STATUS.COMPLETED]: [],
});

export const canTransitionRunStatus = (fromStatus, toStatus) => {
  const from = String(fromStatus || '').trim();
  const to = String(toStatus || '').trim();
  const allowedTargets = RUN_STATUS_TRANSITIONS[from] || [];
  return allowedTargets.includes(to);
};

export const isRunFinalized = (run) => (
  String(run?.status || '').trim() === RUN_STATUS.COMPLETED
);

export const isRunEditable = (run) => {
  const status = String(run?.status || '').trim();
  return status === RUN_STATUS.DRAFT || status === RUN_STATUS.PREPARED;
};
