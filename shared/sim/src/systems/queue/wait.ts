import type { ResourceKey } from '@terra/contracts';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { rowOf } from '../../ecs/store';
import { DEPOSIT } from '../../grid/layers';
import { indexOf } from '../../grid/hex';
import type { CompiledDataLike } from '../../kernel/config';
import type { ColonyState, PlanetState } from '../../kernel/state';
import { resolveBuildingRow } from '../economy/construction';
import { findColonyRoboticsFactories, resolveHubProducerRows, resolveReconRow } from '../factories-hub';
import { normalizeRichness } from '../production';
import { PRECEDENCE_RANK, type QueueEntry, type QueueLane, type QueuePrecedence, type QueueTaskPayload } from './types';

export const CONSTRUCTION_LANE_LIMIT = 20;
export const TERRAFORM_LANE_LIMIT = 20;
export const UNITS_LANE_LIMIT = 10;
export const PRODUCER_BUFFER_LIMIT = 5;
export const HQ_GOALS_LANE_LIMIT = 20;

export function laneForTask(task: QueueTaskPayload): QueueLane {
  if (task.kind === 'buildUnit') return 'units';
  if (task.kind === 'terraform') return 'terraform';
  if (task.kind === 'hqGoal') return 'hqGoals';
  return 'construction';
}

export function laneLimitFor(lane: QueueLane): number {
  if (lane === 'units') return UNITS_LANE_LIMIT;
  if (lane === 'terraform') return TERRAFORM_LANE_LIMIT;
  if (lane === 'hqGoals') return HQ_GOALS_LANE_LIMIT;
  return CONSTRUCTION_LANE_LIMIT;
}

export function resolveTaskCostAndTicks(
  task: QueueTaskPayload,
  data?: CompiledDataLike,
): { cost: Partial<Record<ResourceKey, number>>; buildTicks: number; workRate: number } {
  if (task.kind === 'build') {
    const res = resolveBuildingRow(task.building, data);
    if (!res) return { cost: {}, buildTicks: 50, workRate: 1.5 };
    return {
      cost: { ...((res.row.cost ?? {}) as Partial<Record<ResourceKey, number>>) },
      buildTicks: Math.max(1, Number(res.row.buildS ?? 50)),
      workRate: 1.5,
    };
  }
  if (task.kind === 'buildUnit') {
    if (task.unit === 'recon') {
      const reconRow = resolveReconRow(data);
      return {
        cost: { ...((reconRow.cost ?? { 'metals.t1': 35, 'minerals.t1': 15, 'bio.biomass': 0, 'bio.water': 5 }) as Partial<Record<ResourceKey, number>>) },
        buildTicks: Math.max(1, Number(reconRow.buildS ?? 50)),
        workRate: Number(reconRow.workRate ?? 1.0),
      };
    }
    if (task.unit === 'builder') {
      const tables = data?.tables as
        | Record<string, Record<string, { cost?: Partial<Record<ResourceKey, number>>; buildS?: number; workRate?: number }> | undefined>
        | undefined;
      const builderRow = tables?.grid?.builder ?? tables?.unitsWorkersBasic?.builder;
      return {
        cost: { ...(builderRow?.cost ?? { 'metals.t1': 45, 'minerals.t1': 25, 'bio.biomass': 10 }) },
        buildTicks: Math.max(1, Number(builderRow?.buildS ?? 60)),
        workRate: Number(builderRow?.workRate ?? 1.0),
      };
    }
    const { harvester } = resolveHubProducerRows(data);
    return {
      cost: { ...((harvester.cost ?? {}) as Partial<Record<ResourceKey, number>>) },
      buildTicks: Math.max(1, Number(harvester.buildS ?? 50)),
      workRate: 1.0,
    };
  }
  if (task.kind === 'hqGoal') {
    return { cost: {}, buildTicks: 1, workRate: 1.0 };
  }
  return { cost: {}, buildTicks: 25, workRate: 1.5 };
}

export const RESOURCE_DISPLAY_LABELS: Readonly<Record<ResourceKey, string>> = {
  'metals.t1': 'Metals',
  'minerals.t1': 'Minerals',
  'bio.biomass': 'Biomass',
  'bio.water': 'Water',
  'metals.t2': 'Alloys',
  'minerals.t2': 'Crystals',
  'bio.t2': 'Nutrients',
  'metals.t3': 'Composites',
  'minerals.t3': 'Metamaterials',
  'bio.t3': 'Biopolymers',
};

function depositCodeToResourceKey(dep: number): ResourceKey | null {
  if (dep === DEPOSIT.metals) return 'metals.t1';
  if (dep === DEPOSIT.minerals) return 'minerals.t1';
  if (dep === DEPOSIT.oil) return 'bio.biomass';
  return null;
}

/** Whether a Harvester of `colonyIndex` harvests now (the production ledger then holds the real per-key rates). */
function harvestersAtWork(state: PlanetState, colonyIndex: number): boolean {
  const { count, cols } = state.entities;
  for (let r = 0; r < count; r++) {
    if (cols.owner[r] === colonyIndex && cols.kind[r] === ENTITY_KIND.harvester && cols.state[r] === ENTITY_STATE.harvesting) return true;
  }
  return false;
}

/**
 * Estimates current colony income per second (`amount/s`) for a given `ResourceKey`.
 * Uses explicit `colony.incomePerS`, else the production ledger (`colony.production.incomePerS`, written each step by
 * `production.extractors` / `production.harvest`: the real per-key rate, so a Harvester mining metals adds nothing to
 * Minerals). Without a ledger rate it guesses: active extractors (`1.0 * richness`/s) and idle / moving Harvesters.
 */
export function estimateResourceIncomePerS(
  state: PlanetState,
  colony: ColonyState,
  key: ResourceKey,
): number {
  const explicitColony = (colony as { incomePerS?: Partial<Record<ResourceKey, number>> }).incomePerS?.[key];
  if (typeof explicitColony === 'number' && explicitColony > 0) {
    return explicitColony;
  }
  const production = (colony as { production?: { incomePerS?: Partial<Record<ResourceKey, number>> } }).production;
  const ledgerRate = production?.incomePerS?.[key];
  if (typeof ledgerRate === 'number' && ledgerRate > 0) return ledgerRate;
  if (production?.incomePerS && harvestersAtWork(state, colony.index)) return 0; // the ledger knows: nothing comes in

  let rate = 0;
  let idleOrMovingHarvesters = 0;
  const { count, cols } = state.entities;
  for (let r = 0; r < count; r++) {
    if (cols.owner[r] !== colony.index) continue;
    const kind = cols.kind[r];
    const st = cols.state[r];
    if (kind === ENTITY_KIND.metalsExtractor && st === ENTITY_STATE.active && key === 'metals.t1') {
      const tileIdx = indexOf(state.grid.radius, cols.q[r], cols.r[r]);
      const rawRich = tileIdx >= 0 ? state.grid.layers.richness[tileIdx] : 10000;
      rate += 1.0 * normalizeRichness(rawRich || 10000);
    } else if (kind === ENTITY_KIND.harvester) {
      if (st === ENTITY_STATE.harvesting) {
        const tileIdx = indexOf(state.grid.radius, cols.q[r], cols.r[r]);
        const dep = tileIdx >= 0 ? state.grid.layers.deposit[tileIdx] : DEPOSIT.none;
        const depKey = depositCodeToResourceKey(dep);
        if (depKey === key || dep === DEPOSIT.none) {
          rate += 0.5;
        }
      } else if (st === ENTITY_STATE.idle || st === ENTITY_STATE.moving) {
        idleOrMovingHarvesters++;
      }
    }
  }

  if (rate === 0 && idleOrMovingHarvesters > 0 && (key === 'metals.t1' || key === 'minerals.t1' || key === 'bio.biomass')) {
    rate = 0.5 * idleOrMovingHarvesters;
  }
  return rate;
}

export function computeResourceWaitState(
  state: PlanetState,
  colony: ColonyState,
  cost: Partial<Record<ResourceKey, number>>,
  missing: Partial<Record<ResourceKey, number>>,
): { etaSeconds: number | null; waitDetail: string } {
  const keys = Object.keys(missing) as ResourceKey[];
  if (keys.length === 0) {
    return { etaSeconds: 0, waitDetail: 'waiting: resources' };
  }

  let maxEta: number | null = 0;
  let bottleneckKey: ResourceKey = keys[0];
  let bottleneckEta = -1;

  for (const k of keys) {
    const missAmt = missing[k] ?? 0;
    if (missAmt <= 0) continue;
    const income = estimateResourceIncomePerS(state, colony, k);
    if (income <= 0) {
      maxEta = null;
      if (bottleneckEta < Number.POSITIVE_INFINITY) {
        bottleneckEta = Number.POSITIVE_INFINITY;
        bottleneckKey = k;
      }
    } else {
      const kEta = Math.ceil(missAmt / income);
      if (maxEta !== null && kEta > maxEta) {
        maxEta = kEta;
      }
      if (kEta > bottleneckEta) {
        bottleneckEta = kEta;
        bottleneckKey = k;
      }
    }
  }

  const label = RESOURCE_DISPLAY_LABELS[bottleneckKey] ?? bottleneckKey;
  const stockMap = (colony.stock ?? {}) as Partial<Record<ResourceKey, number>>;
  const haveAmt = Math.floor(stockMap[bottleneckKey] ?? 0);
  const needAmt = cost[bottleneckKey] ?? 0;
  const waitDetail =
    maxEta !== null
      ? `waiting: ${label} ${haveAmt}/${needAmt} · ~${maxEta} s`
      : `waiting: ${label} ${haveAmt}/${needAmt} (no ETA)`;

  return { etaSeconds: maxEta, waitDetail };
}

export function isBlockedByPower(state: PlanetState, colony: ColonyState, entry: QueueEntry): boolean {
  const taskAny = entry.task as { requiresPower?: boolean; producerId?: number };
  const pwr = (colony.power ?? {}) as { status?: string; brownout?: boolean; net?: number };
  const inBrownout = pwr.status === 'brownout' || Boolean(pwr.brownout) || (pwr.net ?? 0) < 0;
  if (taskAny.requiresPower && inBrownout) {
    return true;
  }
  if (entry.task.kind === 'buildUnit') {
    if (typeof entry.task.producerId === 'number') {
      const pRow = rowOf(state.entities, entry.task.producerId);
      if (pRow >= 0) {
        const st = state.entities.cols.state[pRow];
        if (
          st === ENTITY_STATE.offlineBrownout ||
          st === ENTITY_STATE.offlineUnpowered ||
          st === ENTITY_STATE.offlineOverload ||
          st === ENTITY_STATE.offlineNoGrid ||
          st === ENTITY_STATE.constructing
        ) {
          return true;
        }
      }
    }
    if (entry.task.unit === 'recon') {
      const factories = findColonyRoboticsFactories(state, entry.colonyIndex);
      if (factories.length > 0) {
        const anyOnline = factories.some((r) => {
          const st = state.entities.cols.state[r];
          return st === ENTITY_STATE.active || st === ENTITY_STATE.idle;
        });
        if (!anyOnline) return true;
      } else if (inBrownout) {
        return true;
      }
    }
  }
  return false;
}

export function normalizeEnqueueArgs(raw: Record<string, unknown>): {
  task?: QueueTaskPayload;
  precedence?: QueuePrecedence;
  taskId?: string;
  costOverride?: Partial<Record<ResourceKey, number>>;
} {
  const base = {
    taskId: typeof raw.taskId === 'string' ? raw.taskId : undefined,
    precedence: typeof raw.precedence === 'string' ? (raw.precedence as QueuePrecedence) : undefined,
    costOverride: raw.costOverride as Partial<Record<ResourceKey, number>> | undefined,
  };
  if (raw.task && typeof (raw.task as { kind?: unknown }).kind === 'string') {
    return { ...base, task: raw.task as QueueTaskPayload };
  }
  if (raw.build && typeof raw.build === 'object') {
    const b = raw.build as { building: string; q: number; r: number; rotation?: number; rot?: number; tier?: number };
    return {
      ...base,
      task: { kind: 'build', building: b.building, q: b.q, r: b.r, tier: b.tier, rotation: b.rotation ?? b.rot },
    };
  }
  if (typeof raw.buildUnit === 'string') {
    return {
      ...base,
      task: {
        kind: 'buildUnit',
        unit: raw.buildUnit,
        count: typeof raw.count === 'number' ? raw.count : undefined,
        repeat: typeof raw.repeat === 'boolean' ? raw.repeat : undefined,
        producerId: typeof raw.producerId === 'number' ? raw.producerId : undefined,
      },
    };
  }
  if (raw.buildUnit && typeof raw.buildUnit === 'object') {
    const u = raw.buildUnit as { unit: string; count?: number; repeat?: boolean; producerId?: number };
    return {
      ...base,
      task: { kind: 'buildUnit', unit: u.unit, count: u.count, repeat: u.repeat, producerId: u.producerId },
    };
  }
  if (raw.terraform && typeof raw.terraform === 'object') {
    const tf = raw.terraform as { op: string; q?: number; r?: number; tiles?: Array<{ q: number; r: number }> };
    const first = tf.tiles?.[0] ?? (typeof tf.q === 'number' && typeof tf.r === 'number' ? { q: tf.q, r: tf.r } : undefined);
    if (first) {
      return {
        ...base,
        task: { kind: 'terraform', op: tf.op, q: first.q, r: first.r },
      };
    }
  }
  if (raw.hqGoal && typeof raw.hqGoal === 'object') {
    const g = raw.hqGoal as { goal: string; target?: string; q?: number; r?: number };
    return {
      ...base,
      task: { kind: 'hqGoal', goal: g.goal, target: g.target, q: g.q, r: g.r },
    };
  }
  if (raw.repair && typeof raw.repair === 'object') {
    const r = raw.repair as { entityId: number; q?: number; r?: number };
    return {
      ...base,
      task: { kind: 'repair', entityId: r.entityId, q: r.q, r: r.r },
    };
  }
  return {};
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

export function maxConcurrentInLane(state: PlanetState, colonyIndex: number, lane: QueueLane): number {
  if (lane !== 'construction') return 1;
  let builders = 0;
  const { count, cols } = state.entities;
  for (let r = 0; r < count; r++) {
    if (cols.owner[r] !== colonyIndex || cols.hp[r] <= 0) continue;
    if (cols.kind[r] === ENTITY_KIND.hq || cols.kind[r] === ENTITY_KIND.builder) builders++;
  }
  return Math.max(1, builders);
}

