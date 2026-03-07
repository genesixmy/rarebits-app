import React from 'react';
import { cn } from '@/lib/utils';

const statusBadgeClassMap = {
  completed: 'border-violet-300 bg-violet-50 text-violet-700',
  ready: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  pending: 'border-cyan-300 bg-cyan-50 text-cyan-700',
  bye: 'border-amber-300 bg-amber-50 text-amber-700',
  locked: 'border-slate-300 bg-slate-100 text-slate-700',
};

const CARD_HEIGHT = Object.freeze({
  readonly: 160,
  organizer: 248,
});
const CARD_BASE_GAP = 18;
const COLUMN_WIDTH = 290;
const COLUMN_GAP = 32;

const ParticipantRow = ({ slotLabel, seed, name, isWinner, score }) => (
  <div className={cn('grid grid-cols-[auto_1fr_auto] items-center gap-x-2 rounded-md border px-2 py-1.5', isWinner ? 'border-emerald-300 bg-emerald-50/80' : 'bg-white')}>
    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{slotLabel}</p>
    <div className="min-w-0">
      <p className="text-[11px] text-muted-foreground">{seed ? `Seed #${seed}` : 'Seed TBD'}</p>
      <p className="truncate text-sm font-semibold">{name || 'TBD'}</p>
    </div>
    <p className={cn(
      'min-w-[28px] rounded-md border px-1.5 py-0.5 text-center text-xs font-semibold',
      Number.isInteger(score) ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border bg-muted/20 text-muted-foreground'
    )}
    >
      {Number.isInteger(score) ? score : '-'}
    </p>
  </div>
);

const BracketMatchCard = ({
  match,
  mode = 'readonly',
  isFinalized = false,
  cardRef,
  renderOrganizerControls,
  cardBaseHeight,
}) => {
  const statusClass = statusBadgeClassMap[match.status] || statusBadgeClassMap.locked;
  const hasValidScores = Number.isInteger(match.scoreA) && Number.isInteger(match.scoreB);
  const winnerLine = match.winnerName
    ? `Winner: ${match.winnerName}${hasValidScores ? ` (${match.scoreA}-${match.scoreB})` : ''}`
    : (match.isBye ? 'BYE progression' : (match.isLocked ? 'Future slot' : 'Winner pending'));

  return (
    <div
      ref={cardRef}
      className={cn(
        'relative z-20 rounded-lg border bg-card p-2 shadow-sm',
        match.isCompleted ? 'border-emerald-300/60' : 'border-primary/20'
      )}
      style={{ minHeight: `${cardBaseHeight}px` }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-muted-foreground">Match {match.matchIndex}</p>
        <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-semibold', statusClass)}>
          {String(match.status || 'locked').toUpperCase()}
        </span>
      </div>

      <div className="space-y-1.5" data-connector-anchor="true">
        <ParticipantRow
          slotLabel="Slot A"
          seed={match.seedA}
          name={match.participantAName}
          isWinner={match.slotAIsWinner}
          score={match.scoreA}
        />
        <ParticipantRow
          slotLabel="Slot B"
          seed={match.seedB}
          name={match.participantBName}
          isWinner={match.slotBIsWinner}
          score={match.scoreB}
        />
      </div>

      {mode !== 'readonly' ? (
        <p className={cn('mt-2 truncate rounded-md border px-2 py-1 text-[11px] whitespace-nowrap', match.isCompleted ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-border bg-muted/20 text-muted-foreground')}>
          {winnerLine}
        </p>
      ) : null}

      {mode === 'organizer' && isFinalized ? (
        <p className="mt-1 text-[10px] text-muted-foreground">Run finalized. Match edits are locked.</p>
      ) : null}

      {mode === 'organizer' && typeof renderOrganizerControls === 'function' ? (
        <div className="mt-2 border-t border-primary/20 pt-2">
          {renderOrganizerControls(match)}
        </div>
      ) : null}
    </div>
  );
};

const BracketConnectors = ({ centers = [], roundIndex, totalRounds }) => {
  const matchCount = Array.isArray(centers) ? centers.length : 0;
  if (roundIndex >= totalRounds || matchCount <= 0) return null;

  const pairCount = Math.floor(matchCount / 2);
  if (pairCount <= 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-visible">
      {Array.from({ length: pairCount }).map((_, pairIdx) => {
        const firstCenterY = centers[pairIdx * 2];
        const secondCenterY = centers[(pairIdx * 2) + 1];
        if (!Number.isFinite(firstCenterY) || !Number.isFinite(secondCenterY)) return null;
        const bridgeTop = Math.min(firstCenterY, secondCenterY);
        const bridgeHeight = Math.abs(secondCenterY - firstCenterY);
        const middleY = bridgeTop + (bridgeHeight / 2);
        const matchRightX = COLUMN_WIDTH - 1;
        const trunkX = COLUMN_WIDTH + 10;
        const outX = COLUMN_WIDTH + COLUMN_GAP;
        const lineThickness = 2;

        return (
          <React.Fragment key={`connector-${roundIndex}-${pairIdx}`}>
            <div
              className="absolute bg-border"
              style={{
                left: `${matchRightX}px`,
                top: `${firstCenterY - (lineThickness / 2)}px`,
                width: `${Math.max(trunkX - matchRightX, 1)}px`,
                height: `${lineThickness}px`,
              }}
            />
            <div
              className="absolute bg-border"
              style={{
                left: `${matchRightX}px`,
                top: `${secondCenterY - (lineThickness / 2)}px`,
                width: `${Math.max(trunkX - matchRightX, 1)}px`,
                height: `${lineThickness}px`,
              }}
            />
            <div
              className="absolute bg-border"
              style={{
                left: `${trunkX - (lineThickness / 2)}px`,
                top: `${bridgeTop}px`,
                width: `${lineThickness}px`,
                height: `${Math.max(bridgeHeight, 1)}px`,
              }}
            />
            <div
              className="absolute bg-border"
              style={{
                left: `${trunkX}px`,
                top: `${middleY - (lineThickness / 2)}px`,
                width: `${Math.max(outX - trunkX, 1)}px`,
                height: `${lineThickness}px`,
              }}
            />
          </React.Fragment>
        );
      })}
    </div>
  );
};

const BracketRoundColumn = ({
  round,
  roundIndex,
  totalRounds,
  mode,
  isFinalized,
  renderOrganizerControls,
  cardBaseHeight,
}) => {
  const spacingMultiplier = 2 ** Math.max(roundIndex - 1, 0);
  const gap = Math.max((cardBaseHeight + CARD_BASE_GAP) * spacingMultiplier - cardBaseHeight, CARD_BASE_GAP);
  const topOffset = roundIndex === 1
    ? 0
    : ((cardBaseHeight + CARD_BASE_GAP) * (spacingMultiplier - 1)) / 2;
  const matchContainerRef = React.useRef(null);
  const matchNodeRefs = React.useRef(new Map());
  const [connectorCenters, setConnectorCenters] = React.useState([]);

  React.useLayoutEffect(() => {
    const containerNode = matchContainerRef.current;
    if (!containerNode) return undefined;

    const collectCenters = () => {
      const nextCenters = round.matches.map((match) => {
        const node = matchNodeRefs.current.get(match.id);
        if (!node) return null;
        const anchorNode = node.querySelector('[data-connector-anchor="true"]');
        if (anchorNode) {
          return Math.round(node.offsetTop + anchorNode.offsetTop + (anchorNode.offsetHeight / 2));
        }
        return Math.round(node.offsetTop + (node.offsetHeight / 2));
      });
      setConnectorCenters(nextCenters);
    };

    collectCenters();

    const observer = new ResizeObserver(() => collectCenters());
    observer.observe(containerNode);
    round.matches.forEach((match) => {
      const node = matchNodeRefs.current.get(match.id);
      if (node) observer.observe(node);
    });
    window.addEventListener('resize', collectCenters);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', collectCenters);
    };
  }, [round.matches]);

  return (
    <div
      className="relative overflow-visible"
      style={{ width: `${COLUMN_WIDTH}px`, minWidth: `${COLUMN_WIDTH}px` }}
    >
      <div className="mb-2 flex items-center justify-between px-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{round.label}</p>
        <p className="text-[11px] text-muted-foreground">{round.matches.length} match</p>
      </div>

      <div
        ref={matchContainerRef}
        className="relative flex flex-col overflow-visible"
        style={{
          paddingTop: `${topOffset}px`,
          gap: `${gap}px`,
        }}
      >
        {round.matches.map((match) => (
          <BracketMatchCard
            key={match.id}
            match={match}
            mode={mode}
            isFinalized={isFinalized}
            renderOrganizerControls={renderOrganizerControls}
            cardBaseHeight={cardBaseHeight}
            cardRef={(node) => {
              if (!node) {
                matchNodeRefs.current.delete(match.id);
                return;
              }
              matchNodeRefs.current.set(match.id, node);
            }}
          />
        ))}
        <BracketConnectors
          centers={connectorCenters}
          roundIndex={roundIndex}
          totalRounds={totalRounds}
        />
      </div>
    </div>
  );
};

const SingleEliminationBracketView = ({
  rounds = [],
  totalRounds = 0,
  mode = 'readonly',
  isFinalized = false,
  className,
  renderOrganizerControls,
}) => {
  const safeRounds = Array.isArray(rounds) ? rounds : [];
  const cardBaseHeight = mode === 'organizer'
    ? CARD_HEIGHT.organizer
    : CARD_HEIGHT.readonly;

  if (safeRounds.length === 0) {
    return (
      <div className={cn('rounded-lg border border-dashed border-primary/30 p-4 text-sm text-muted-foreground', className)}>
        Bracket belum tersedia.
      </div>
    );
  }

  return (
    <div className={cn('overflow-x-auto pb-2', className)}>
      <div className="flex min-w-max items-start gap-8 pr-6">
        {safeRounds.map((round) => (
          <BracketRoundColumn
            key={`round-${round.roundIndex}`}
            round={round}
            roundIndex={round.roundIndex}
            totalRounds={totalRounds || safeRounds.length}
            mode={mode}
            isFinalized={isFinalized}
            renderOrganizerControls={renderOrganizerControls}
            cardBaseHeight={cardBaseHeight}
          />
        ))}
      </div>
    </div>
  );
};

export default SingleEliminationBracketView;
