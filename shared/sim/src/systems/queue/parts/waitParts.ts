import type { ResourceKey } from '@terra/contracts';
import { ENTITY_KIND, ENTITY_STATE } from '../../../ecs/columns';
import { indexOf } from '../../../grid/hex';
import { DEPOSIT } from '../../../grid/layers';
import type { CompiledDataLike } from '../../../kernel/config';
import type { PlanetState } from '../../../kernel/state';
import { isCrewKind, isWorker } from '../../harvest/unit';
import { normalizeRichness } from '../../production';
import {
  PRECEDENCE_RANK,
  type QueueEntry,
  type QueueLane,
  type QueuePrecedence,
  type QueueTaskPayload,
} from '../types';

export function depositCodeToResourceKey(dep: number): ResourceKey | null {
  if (dep === DEPOSIT.metals) return 'metals.t1';
  if (dep === DEPOSIT.minerals) return 'minerals.t1';
  if (dep === DEPOSIT.oil) return 'bio.biomass';
  return null;
}

export function accumulateEntityIncome(
  state: PlanetState,
  row: number,
  key: ResourceKey,
): { rateDelta: number; idleWorkerDelta: number } {
  const { cols } = state.entities;
  const kind = cols.kind[row];
  const st = cols.state[row];
  if (kind === ENTITY_KIND.metalsExtractor && st === ENTITY_STATE.active && key === 'metals.t1') {
    const tileIdx = indexOf(state.grid.radius, cols.q[row], cols.r[row]);
    const rawRich = tileIdx >= 0 ? state.grid.layers.richness[tileIdx] : 10000;
    return { rateDelta: 1.0 * normalizeRichness(rawRich || 10000), idleWorkerDelta: 0 };
  }
  if (!isWorker(kind)) {
    return { rateDelta: 0, idleWorkerDelta: 0 };
  }
  if (st === ENTITY_STATE.harvesting) {
    const tileIdx = indexOf(state.grid.radius, cols.q[row], cols.r[row]);
    const dep = tileIdx >= 0 ? state.grid.layers.deposit[tileIdx] : DEPOSIT.none;
    const depKey = depositCodeToResourceKey(dep);
    return { rateDelta: depKey === key || dep === DEPOSIT.none ? 0.5 : 0, idleWorkerDelta: 0 };
  }
  if (st === ENTITY_STATE.idle || st === ENTITY_STATE.moving) {
    return { rateDelta: 0, idleWorkerDelta: 1 };
  }
  return { rateDelta: 0, idleWorkerDelta: 0 };
}

function extractSpecialTaskPayload(raw: Record<string, unknown>): QueueTaskPayload | undefined {
  if (raw.hqGoal && typeof raw.hqGoal === 'object') {
    const g = raw.hqGoal as { goal: string; target?: string; q?: number; r?: number };
    return { kind: 'hqGoal', goal: g.goal, target: g.target, q: g.q, r: g.r };
  }
  if (raw.project && typeof raw.project === 'object') {
    const p = raw.project as { project?: unknown };
    if (typeof p.project === 'string') return { kind: 'project', project: p.project };
  }
  if (raw.raid && typeof raw.raid === 'object') {
    const rd = raw.raid as {
      targetColonyId?: number | string;
      targetColonyIndex?: number;
      targetColony?: number | string;
      unitIds?: number[];
      entityIds?: number[];
      q?: number;
      r?: number;
    };
    return {
      kind: 'raid',
      targetColonyId: rd.targetColonyId,
      targetColonyIndex: rd.targetColonyIndex,
      targetColony: rd.targetColony,
      unitIds: rd.unitIds,
      entityIds: rd.entityIds,
      q: rd.q,
      r: rd.r,
    };
  }
  if (raw.repair && typeof raw.repair === 'object') {
    const r = raw.repair as { entityId: number; q?: number; r?: number };
    return { kind: 'repair', entityId: r.entityId, q: r.q, r: r.r };
  }
  return undefined;
}

export function extractQueueTaskPayloadFromRaw(raw: Record<string, unknown>): QueueTaskPayload | undefined {
  if (raw.task && typeof (raw.task as { kind?: unknown }).kind === 'string') {
    return raw.task as QueueTaskPayload;
  }
  if (raw.build && typeof raw.build === 'object') {
    const b = raw.build as { building: string; q: number; r: number; rotation?: number; rot?: number; tier?: number };
    return { kind: 'build', building: b.building, q: b.q, r: b.r, tier: b.tier, rotation: b.rotation ?? b.rot };
  }
  if (typeof raw.buildUnit === 'string') {
    return {
      kind: 'buildUnit',
      unit: raw.buildUnit,
      count: typeof raw.count === 'number' ? raw.count : undefined,
      repeat: typeof raw.repeat === 'boolean' ? raw.repeat : undefined,
      producerId: typeof raw.producerId === 'number' ? raw.producerId : undefined,
    };
  }
  if (raw.buildUnit && typeof raw.buildUnit === 'object') {
    const u = raw.buildUnit as { unit: string; tier?: 1 | 2 | 3; count?: number; repeat?: boolean; producerId?: number };
    return { kind: 'buildUnit', unit: u.unit, tier: u.tier, count: u.count, repeat: u.repeat, producerId: u.producerId };
  }
  if (raw.terraform && typeof raw.terraform === 'object') {
    const tf = raw.terraform as { op: string; q?: number; r?: number; tiles?: Array<{ q: number; r: number }> };
    const first = tf.tiles?.[0] ?? (typeof tf.q === 'number' && typeof tf.r === 'number' ? { q: tf.q, r: tf.r } : undefined);
    if (first) {
      return { kind: 'terraform', op: tf.op, q: first.q, r: first.r };
    }
  }
  return extractSpecialTaskPayload(raw);
}

/** The contract's precedence words (`enqueueTask.precedence`) in the queue's terms (`system > player > hq > ai > auto`). */
const CONTRACT_PRECEDENCE: Readonly<Record<string, QueuePrecedence>> = {
  explicit: 'player',
  queued: 'player',
  standing: 'auto',
  autoSitePrep: 'system',
  system: 'system',
  player: 'player',
  hq: 'hq',
  ai: 'ai',
  auto: 'auto',
};

/** Command sources that may set an entry's cost or raise its precedence (dev tools, the sim's own systems, admins). */
const TRUSTED_SOURCES: ReadonlySet<string> = new Set(['dev', 'system', 'admin']);

/**
 * What an `enqueueTask` command may decide about its entry: a player (or AI / chain) command never sets `costOverride`
 * (a free building) and never ranks above `player` (it may lower its own entry to `hq` / `ai` / `auto`); trusted sources may do both.
 */
export function enqueueAuthority(
  source: string,
  norm: { precedence?: string; costOverride?: Partial<Record<ResourceKey, number>> },
): { precedence?: QueuePrecedence; costOverride?: Partial<Record<ResourceKey, number>> } {
  const word = norm.precedence;
  const asked =
    word === undefined
      ? undefined
      : (CONTRACT_PRECEDENCE[word] ??
        (word === 'system' || word === 'player' || word === 'hq' || word === 'ai' || word === 'auto' ? word : undefined));
  if (TRUSTED_SOURCES.has(source)) return { precedence: asked, costOverride: norm.costOverride };
  if (source === 'ai') {
    return { precedence: asked && PRECEDENCE_RANK[asked] <= PRECEDENCE_RANK.ai ? asked : 'ai' };
  }
  if (asked === undefined) return { precedence: undefined };
  return { precedence: PRECEDENCE_RANK[asked] <= PRECEDENCE_RANK.player ? asked : 'player' };
}

export function isW03QueueActive(state: PlanetState, data?: CompiledDataLike): boolean {
  if (data?.tables) {
    return Boolean(data.tables.grid && Object.keys(data.tables.grid).length > 0);
  }
  return state.meta.seed !== 'w02';
}

export function findOldestAutoIndex(entries: readonly QueueEntry[], colonyIndex: number, lane: QueueLane): number {
  let bestIdx = -1;
  let bestCreatedAt = Number.POSITIVE_INFINITY;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (
      e.colonyIndex === colonyIndex &&
      e.lane === lane &&
      e.state !== 'done' &&
      e.state !== 'cancelled' &&
      e.precedence === 'auto' &&
      e.createdAt < bestCreatedAt
    ) {
      bestCreatedAt = e.createdAt;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export function nextAutoTaskId(entries: readonly QueueEntry[], colonyIndex: number, tick: number): string {
  let seq = entries.length + 1;
  let candidate = `q-${colonyIndex}-${tick}-${seq}`;
  while (entries.some((e) => e.taskId === candidate)) {
    seq++;
    candidate = `q-${colonyIndex}-${tick}-${seq}`;
  }
  return candidate;
}

/** The terraform and construction lanes run one entry per live crew unit (HQ or Worker Drone); other lanes one. */
export function maxConcurrentInLane(state: PlanetState, colonyIndex: number, lane: QueueLane): number {
  if (lane !== 'terraform' && lane !== 'construction') return 1;
  let crew = 0;
  const { count, cols } = state.entities;
  for (let r = 0; r < count; r++) {
    if (cols.owner[r] === colonyIndex && cols.hp[r] > 0 && isCrewKind(cols.kind[r])) crew++;
  }
  return Math.max(1, crew);
}
