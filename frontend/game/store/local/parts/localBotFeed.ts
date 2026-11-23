import type { AgentDecisionFeedItemV1, ServerMessage, SimInputFeedItemV1 } from '@terra/contracts';
import type { AutopilotDecision, CommandOutcome, PlanetState, PlannedBotDecision, SimCommand } from '@terra/sim';

const MAX_FEED_RECENT = 200;
const LOCAL_FEED_NONCE = (
  typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 10)
    : Math.random().toString(36).slice(2, 12)
);

function makeLocalFeedId(planetId: string, tag: 'in' | 'dec' | 'auto', tick: number, seq: number): string {
  return `${planetId.slice(0, 32)}:${tag}:${tick}:${LOCAL_FEED_NONCE}:${seq}`;
}

export interface PendingFeedMeta {
  readonly cmd: SimCommand;
  readonly isBot: boolean;
  readonly colonyId: string | null;
  readonly sectorId: string;
  readonly actorId: string | null;
  readonly atTick: number;
  readonly createdAtMs: number;
}

function colonySector(state: PlanetState, colonyIndex: number | null): string {
  if (colonyIndex === null || colonyIndex < 0) return 'sec_0_0';
  const col = state.colonies[colonyIndex];
  return typeof col?.foundingSectorId === 'string' && col.foundingSectorId ? col.foundingSectorId : 'sec_0_0';
}

function buildInputFeedItems(
  planetId: string,
  metaByCmdId: Map<string, PendingFeedMeta>,
  outcomeMap: Map<string, CommandOutcome>,
  nextId: () => number,
): SimInputFeedItemV1[] {
  const inputItems: SimInputFeedItemV1[] = [];
  for (const [cmdId, meta] of metaByCmdId) {
    const out = outcomeMap.get(cmdId);
    const rejected = Boolean(out?.code && out.code !== 'ok');
    const resolvedTick = out?.appliedAtTick ?? meta.atTick;
    inputItems.push({
      id: makeLocalFeedId(planetId, 'in', resolvedTick, nextId()),
      planetId,
      sectorId: meta.sectorId,
      colonyId: meta.colonyId,
      colonyIndex: typeof meta.cmd.colonyIndex === 'number' ? meta.cmd.colonyIndex : null,
      actorId: meta.actorId,
      isBot: meta.isBot,
      source: (meta.cmd.source || 'player') as SimInputFeedItemV1['source'],
      commandId: cmdId,
      kind: meta.cmd.kind,
      args: meta.cmd.args,
      status: rejected ? 'rejected' : 'applied',
      rejectCode: rejected ? out?.code ?? null : null,
      rejectDetail: rejected ? out?.detail ?? null : null,
      atTick: resolvedTick,
      createdAtMs: meta.createdAtMs,
    });
  }
  return inputItems;
}

function buildBotDecisionItems(
  planetId: string,
  botDecisions: readonly PlannedBotDecision[],
  outcomeMap: Map<string, CommandOutcome>,
  wallMs: number,
  nextId: () => number,
): AgentDecisionFeedItemV1[] {
  return botDecisions.map((d) => {
    const out = d.commandId ? outcomeMap.get(d.commandId) : undefined;
    const rejected = Boolean(out?.code && out.code !== 'ok');
    return {
      id: makeLocalFeedId(planetId, 'dec', d.atTick, nextId()),
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
      outcome: out ? (rejected ? 'rejected' : 'applied') : 'emitted',
      atTick: d.atTick,
      createdAtMs: wallMs,
    };
  });
}

function collectAutopilotDecisions(
  state: PlanetState,
  planetId: string,
  seenTickByColony: Map<number, number>,
  wallMs: number,
  nextId: () => number,
): AgentDecisionFeedItemV1[] {
  const out: AgentDecisionFeedItemV1[] = [];
  for (const col of state.colonies) {
    if (!col || col.isBot) continue;
    const auto = col.lastAutopilotDecision as AutopilotDecision | undefined;
    if (!auto || typeof auto.tick !== 'number') continue;
    if (seenTickByColony.get(col.index) === auto.tick) continue;
    seenTickByColony.set(col.index, auto.tick);
    out.push({
      id: makeLocalFeedId(planetId, 'auto', auto.tick, nextId()),
      planetId,
      sectorId: colonySector(state, col.index),
      colonyId: col.id,
      colonyIndex: col.index,
      actorId: typeof col.playerId === 'string' && col.playerId ? col.playerId : `col_${col.index}`,
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
  return out;
}

export class LocalFeedCollector {
  private readonly recentInputs: SimInputFeedItemV1[] = [];
  private readonly recentDecisions: AgentDecisionFeedItemV1[] = [];
  private readonly lastAutopilotTickByColony = new Map<number, number>();
  private seq = 0;

  reset(): void {
    this.recentInputs.length = 0;
    this.recentDecisions.length = 0;
    this.lastAutopilotTickByColony.clear();
  }

  getRecent(): { inputs: SimInputFeedItemV1[]; decisions: AgentDecisionFeedItemV1[] } {
    return { inputs: [...this.recentInputs], decisions: [...this.recentDecisions] };
  }

  prepareBatch(state: PlanetState, batch: readonly SimCommand[], nextTick: number, wallMs: number): Map<string, PendingFeedMeta> {
    const map = new Map<string, PendingFeedMeta>();
    for (const cmd of batch) {
      const idx = typeof cmd.colonyIndex === 'number' && cmd.colonyIndex >= 0 ? cmd.colonyIndex : null;
      const col = idx !== null ? state.colonies[idx] : undefined;
      const isBot = cmd.source === 'bot' || Boolean(col?.isBot);
      const actorId = typeof col?.playerId === 'string' && col.playerId ? col.playerId : isBot && idx !== null ? `ai:col_${idx}` : 'local-player';
      map.set(cmd.commandId, { cmd, isBot, colonyId: col?.id ?? (idx !== null ? `col_${idx}` : null), sectorId: colonySector(state, idx), actorId, atTick: nextTick, createdAtMs: wallMs });
    }
    return map;
  }

  finalizeStep(
    state: PlanetState,
    planetId: string,
    metaByCmdId: Map<string, PendingFeedMeta>,
    outcomes: readonly CommandOutcome[],
    botDecisions: readonly PlannedBotDecision[],
    wallMs: number,
  ): ServerMessage[] {
    const outcomeMap = new Map<string, CommandOutcome>();
    for (const o of outcomes) outcomeMap.set(o.commandId, o);
    const nextId = () => ++this.seq;
    const inputItems = buildInputFeedItems(planetId, metaByCmdId, outcomeMap, nextId);
    for (const item of inputItems) this.pushInput(item);
    const decisionItems = [
      ...buildBotDecisionItems(planetId, botDecisions, outcomeMap, wallMs, nextId),
      ...collectAutopilotDecisions(state, planetId, this.lastAutopilotTickByColony, wallMs, nextId),
    ];
    for (const item of decisionItems) this.pushDecision(item);
    const msgs: ServerMessage[] = [];
    if (inputItems.length > 0) msgs.push({ v: 1, t: 'sim.input', tick: state.meta.tick, d: { items: inputItems } });
    if (decisionItems.length > 0) msgs.push({ v: 1, t: 'sim.decision', tick: state.meta.tick, d: { items: decisionItems } });
    return msgs;
  }

  private pushInput(item: SimInputFeedItemV1): void {
    this.recentInputs.push(item);
    if (this.recentInputs.length > MAX_FEED_RECENT) this.recentInputs.shift();
  }

  private pushDecision(item: AgentDecisionFeedItemV1): void {
    this.recentDecisions.push(item);
    if (this.recentDecisions.length > MAX_FEED_RECENT) this.recentDecisions.shift();
  }
}
