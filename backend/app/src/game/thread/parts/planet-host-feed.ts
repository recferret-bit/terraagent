import { randomUUID } from 'node:crypto';
import type { AgentDecisionFeedItemV1, SimCommandV1, SimInputFeedItemV1 } from '@terra/contracts';
import type {
  AutopilotDecision,
  CommandOutcome,
  PlanetState,
  PlannedBotActionBatch,
} from '@terra/sim';
import { getRivalColonyMeta, isRivalAiColony, resolveTileSector } from '@terra/sim';

const HOST_FEED_NONCE = randomUUID().replace(/-/g, '').slice(0, 10);

function makeFeedId(planetId: string, tag: 'in' | 'dec' | 'auto', tick: number, seq: number): string {
  return `${planetId.slice(0, 32)}:${tag}:${tick}:${HOST_FEED_NONCE}:${seq}`;
}

function colonySectorId(state: PlanetState, colonyIndex: number | null): string {
  if (colonyIndex === null || colonyIndex < 0) return 'sec_0_0';
  const col = state.colonies[colonyIndex];
  const explicit = (col as { foundingSectorId?: unknown } | undefined)?.foundingSectorId;
  if (typeof explicit === 'string' && explicit.startsWith('sec_')) return explicit;
  const legacy = (col as { sectorId?: unknown } | undefined)?.sectorId;
  if (typeof legacy === 'string' && legacy.startsWith('sec_')) return legacy;
  const meta = getRivalColonyMeta(state, colonyIndex);
  if (meta) {
    const resolved = resolveTileSector(state, meta.anchorQ, meta.anchorR);
    if (resolved?.sectorId) return resolved.sectorId;
  }
  return 'sec_0_0';
}

function colonyActorInfo(state: PlanetState, colonyIndex: number | null): {
  colonyId: string | null;
  sectorId: string;
  isBot: boolean;
  actorId: string | null;
} {
  if (colonyIndex === null || colonyIndex < 0) {
    return { colonyId: null, sectorId: 'sec_0_0', isBot: false, actorId: null };
  }
  const col = state.colonies[colonyIndex];
  const isBot = Boolean(col?.isBot || isRivalAiColony(state, colonyIndex));
  const colonyId = col?.id || `col_${colonyIndex}`;
  const sectorId = colonySectorId(state, colonyIndex);
  const actorId = isBot
    ? `bot:${colonyId}`
    : typeof col?.playerId === 'string' && col.playerId
      ? col.playerId
      : null;
  return { colonyId, sectorId, isBot, actorId };
}

function collectAutopilotFeedDecisions(
  planetId: string,
  state: PlanetState,
  seenAutopilotTickByColony: Map<number, number>,
  wallMs: number,
  nextFeedId: () => number,
): AgentDecisionFeedItemV1[] {
  const decisions: AgentDecisionFeedItemV1[] = [];
  for (const col of state.colonies) {
    if (!col || col.index < 0 || col.isBot || isRivalAiColony(state, col.index)) continue;
    const auto = col.lastAutopilotDecision as AutopilotDecision | undefined;
    if (!auto || typeof auto.tick !== 'number') continue;
    if (seenAutopilotTickByColony.get(col.index) === auto.tick) continue;
    seenAutopilotTickByColony.set(col.index, auto.tick);
    const info = colonyActorInfo(state, col.index);
    decisions.push({
      id: makeFeedId(planetId, 'auto', auto.tick, nextFeedId()),
      planetId,
      sectorId: info.sectorId,
      colonyId: info.colonyId,
      colonyIndex: col.index,
      actorId: info.actorId,
      isBot: false,
      actorSource: 'rule_engine',
      decisionKind: auto.mode ?? 'autopilot',
      summary: auto.title || `${auto.need}: ${auto.target}`,
      rationale: auto.reason,
      commandId: auto.queuedTaskId ?? null,
      commandKind: auto.queuedTaskId ? 'enqueueTask' : null,
      payload: { need: auto.need, target: auto.target, mode: auto.mode, stage: auto.stage },
      outcome: auto.orderQueued ? 'applied' : 'emitted',
      atTick: auto.tick,
      createdAtMs: wallMs,
    });
  }
  return decisions;
}

export function buildHostStepFeeds(opts: {
  readonly planetId: string;
  readonly state: PlanetState;
  readonly queuedCmds: readonly SimCommandV1[];
  readonly botBatch: PlannedBotActionBatch;
  readonly outcomes: readonly CommandOutcome[];
  readonly tick: number;
  readonly wallMs: number;
  readonly seenAutopilotTickByColony: Map<number, number>;
  readonly lastInputTickByColony: Map<number, number>;
  readonly nextFeedId: () => number;
}): {
  readonly inputs: SimInputFeedItemV1[];
  readonly decisions: AgentDecisionFeedItemV1[];
} {
  const {
    planetId, state, queuedCmds, botBatch, outcomes, tick, wallMs,
    seenAutopilotTickByColony, lastInputTickByColony, nextFeedId,
  } = opts;
  const outcomeByCmd = new Map<string, CommandOutcome>();
  for (const o of outcomes) outcomeByCmd.set(o.commandId, o);

  const inputs: SimInputFeedItemV1[] = [];
  for (const cmd of [...queuedCmds, ...botBatch.commands]) {
    const colIdx = typeof cmd.colonyIndex === 'number' && cmd.colonyIndex >= 0 ? cmd.colonyIndex : null;
    const info = colonyActorInfo(state, colIdx);
    const isBot = cmd.source === 'bot' || info.isBot;
    const out = outcomeByCmd.get(cmd.commandId);
    const rejected = Boolean(out?.code && out.code !== 'ok');
    const atTick = out?.appliedAtTick ?? tick;
    if (colIdx !== null) lastInputTickByColony.set(colIdx, atTick);
    inputs.push({
      id: makeFeedId(planetId, 'in', atTick, nextFeedId()),
      planetId,
      sectorId: info.sectorId,
      colonyId: info.colonyId,
      colonyIndex: colIdx,
      actorId: info.actorId ?? (isBot && info.colonyId ? `bot:${info.colonyId}` : null),
      isBot,
      source: (cmd.source || 'player') as SimInputFeedItemV1['source'],
      commandId: cmd.commandId,
      kind: cmd.kind,
      args: cmd.args,
      status: rejected ? 'rejected' : 'applied',
      rejectCode: rejected ? out?.code ?? null : null,
      rejectDetail: rejected ? out?.detail ?? null : null,
      atTick,
      createdAtMs: wallMs,
    });
  }

  const decisions: AgentDecisionFeedItemV1[] = [
    ...botBatch.decisions.map((d) => {
      const out = d.commandId ? outcomeByCmd.get(d.commandId) : undefined;
      const rejected = Boolean(out?.code && out.code !== 'ok');
      return {
        id: makeFeedId(planetId, 'dec', d.atTick, nextFeedId()),
        planetId,
        sectorId: d.sectorId,
        colonyId: d.colonyId,
        colonyIndex: d.colonyIndex,
        actorId: d.actorId,
        isBot: true,
        actorSource: d.actorSource,
        decisionKind: d.decisionKind,
        summary: d.summary,
        rationale: d.rationale,
        commandId: d.commandId ?? null,
        commandKind: d.commandKind ?? null,
        payload: d.payload,
        outcome: (out ? (rejected ? 'rejected' : 'applied') : 'emitted') as AgentDecisionFeedItemV1['outcome'],
        atTick: d.atTick,
        createdAtMs: wallMs,
      };
    }),
    ...collectAutopilotFeedDecisions(planetId, state, seenAutopilotTickByColony, wallMs, nextFeedId),
  ];

  return { inputs, decisions };
}
