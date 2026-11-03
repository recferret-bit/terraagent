import type { ResourceKey } from '@terra/contracts';
import { CANCEL_REFUND_RATE } from '../../data';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { placeSpawnedEntity } from '../../ecs/placement';
import { insertRow } from '../../ecs/store';
import { hexIndex } from '../../grid/hex';
import { PREP, TERRAIN } from '../../grid/layers';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import { setBlob, type ColonyState, type PlanetState } from '../../kernel/state';
import { defineSystem } from '../../kernel/system';
import { buildingFootprints } from '../construction/occupancy';
import { defineSimModule } from '../define';
import { checkCostAffordability, ensureColonyLedger, payProgressiveSlice, refundCost } from '../economy/ledger';
import { colonyWho } from '../find';
import { revealVision } from '../hq';
import {
  buildBuilderView,
  builderJobFromState,
  defaultHubData,
  resolveBuilderRow,
  resolveHubProducerRows,
  resolveUnitRowForHub,
  spawnBuilderUnit,
  syncBuilderView,
  type BuilderJob,
  type BuilderUnitView,
  type SpawnBuilderOpts,
} from './unit';

export {
  buildBuilderView,
  builderJobFromState,
  defaultHubData,
  resolveBuilderRow,
  resolveHubProducerRows,
  resolveUnitRowForHub,
  spawnBuilderUnit,
  syncBuilderView,
  type BuilderJob,
  type BuilderUnitView,
  type SpawnBuilderOpts,
};

export interface HubUnitQueueEntry {
  taskId: string;
  unit: 'harvester' | 'builder';
  colonyIndex: number;
  producerId?: number;
  count: number;
  remainingCount: number;
  repeat: boolean;
  state: 'queued' | 'waiting' | 'in_progress' | 'done' | 'cancelled';
  waitReason?: 'supply' | 'resources' | 'storage' | 'power' | 'producer';
  waitDetail?: string;
  buildTicks: number;
  elapsedTicks: number;
  progress: number;
  paid: boolean;
  cost: Partial<Record<ResourceKey, number>>;
  totalCost?: Partial<Record<ResourceKey, number>>;
  spentCost?: Partial<Record<ResourceKey, number>>;
  createdAt: number;
  spawnedEntityIds: number[];
}

export interface ColonySupplySummary {
  used: number;
  activeUnits: number;
  inProgressSupply: number;
  cap: number;
  available: number;
}

function ensureColony(state: PlanetState, colonyIndex: number, tick: number): ColonyState {
  let col = state.colonies[colonyIndex];
  if (!col) {
    col = { index: colonyIndex, id: `col-${colonyIndex}`, name: `Colony ${colonyIndex + 1}`, color: 0xff6b00, status: 'active', changedAt: tick };
    state.colonies[colonyIndex] = col;
  }
  return ensureColonyLedger(col);
}

/** Computes current unit supply usage and cap (`10` from Hub T1) for `colonyIndex`. */
export function getColonySupply(
  state: PlanetState,
  colonyIndex = 0,
  entries: readonly HubUnitQueueEntry[] = [],
  data?: CompiledDataLike,
): ColonySupplySummary {
  const { harvester, builder, hubProd, hub } = resolveHubProducerRows(data);
  const harvesterSupply = Number(harvester.supply ?? 1);
  const builderSupply = Number(builder?.supply ?? 1);
  const e = state.entities, cols = e.cols;
  let activeUnits = 0;
  let hubCount = 0;

  for (let row = 0; row < e.count; row++) {
    if (cols.owner[row] !== colonyIndex || cols.hp[row] <= 0) continue;
    if (cols.kind[row] === ENTITY_KIND.harvester) activeUnits += harvesterSupply;
    else if (cols.kind[row] === ENTITY_KIND.builder) activeUnits += builderSupply;
    else if (cols.kind[row] === ENTITY_KIND.commandHub && cols.state[row] !== ENTITY_STATE.constructing) hubCount++;
  }

  const inProgressSupply = entries
    .filter((en) => en.colonyIndex === colonyIndex && en.state === 'in_progress')
    .reduce((sum, en) => sum + (en.unit === 'builder' ? builderSupply : harvesterSupply), 0);

  const baseCap = Number(hub.supplyCap ?? hubProd.baseSupplyCap ?? 10);
  const cap = hubCount > 0 ? hubCount * baseCap : baseCap;
  const used = activeUnits + inProgressSupply;
  return { used, activeUnits, inProgressSupply, cap, available: Math.max(0, cap - used) };
}

function getAllEntries(state: PlanetState): HubUnitQueueEntry[] {
  const raw = (state.blobs.hubProduction?.value as { entries?: HubUnitQueueEntry[] } | undefined)?.entries;
  return raw
    ? raw.map((e) => ({
        ...e,
        cost: { ...e.cost },
        totalCost: e.totalCost ? { ...e.totalCost } : { ...e.cost },
        spentCost: e.spentCost ? { ...e.spentCost } : {},
        spawnedEntityIds: [...(e.spawnedEntityIds ?? [])],
      }))
    : [];
}

function saveAllEntries(state: PlanetState, entries: HubUnitQueueEntry[], tick: number, data?: CompiledDataLike): void {
  setBlob(state, 'hubProduction', { entries }, tick);
  const colonyIndices = new Set<number>([0]);
  for (const c of state.colonies) if (c) colonyIndices.add(c.index);
  for (const en of entries) colonyIndices.add(en.colonyIndex);

  for (const idx of colonyIndices) {
    const col = ensureColony(state, idx, tick);
    const colEntries = entries.filter((en) => en.colonyIndex === idx && en.state !== 'done' && en.state !== 'cancelled');
    col.unitQueue = colEntries;
    col.supply = getColonySupply(state, idx, colEntries, data);
    col.changedAt = tick;
  }
}

export function findHubEdgeSpawnTile(state: PlanetState, colonyIndex: number, data?: CompiledDataLike): { q: number; r: number } {
  const e = state.entities, cols = e.cols;
  let hubQ = 0, hubR = 0, hubW = 3, hubD = 3;
  for (let row = 0; row < e.count; row++) {
    if (cols.owner[row] === colonyIndex && cols.kind[row] === ENTITY_KIND.commandHub && cols.hp[row] > 0) {
      hubQ = cols.q[row];
      hubR = cols.r[row];
      hubW = cols.footprintW[row] || 3;
      hubD = cols.footprintD[row] || 3;
      break;
    }
  }
  const minQ = -Math.floor((hubW - 1) / 2), maxQ = minQ + hubW - 1;
  const minR = -Math.floor((hubD - 1) / 2), maxR = minR + hubD - 1;
  const candidates: Array<{ q: number; r: number }> = [
    { q: hubQ + maxQ + 1, r: hubR },
    { q: hubQ + maxQ + 1, r: hubR - 1 },
    { q: hubQ, r: hubR + maxR + 1 },
    { q: hubQ + minQ - 1, r: hubR },
    { q: hubQ, r: hubR + minR - 1 },
    { q: hubQ + minQ - 1, r: hubR + 1 },
  ];
  for (let dr = minR - 1; dr <= maxR + 1; dr++) {
    for (let dq = minQ - 1; dq <= maxQ + 1; dq++) {
      if (dq >= minQ && dq <= maxQ && dr >= minR && dr <= maxR) continue;
      candidates.push({ q: hubQ + dq, r: hubR + dr });
    }
  }
  const idx = hexIndex(state.grid.radius);
  const layers = state.grid.layers;
  const occupied = new Set<number>();
  for (const fp of buildingFootprints(state, data)) {
    for (const i of fp) occupied.add(i);
  }
  for (const c of candidates) {
    const t = idx.indexOf(c.q, c.r);
    if (
      t >= 0 &&
      !occupied.has(t) &&
      layers.terrain[t] !== TERRAIN.deep &&
      layers.terrain[t] !== TERRAIN.shallow &&
      layers.terrain[t] !== TERRAIN.hole &&
      layers.prep[t] !== PREP.ridge &&
      layers.prep[t] !== PREP.moat
    ) {
      return c;
    }
  }
  return { q: hubQ + maxQ + 1, r: hubR };
}

/**
 * A finished Harvester: spawned at the Hub edge, then `unitProduced` in the one player-event shape (`colonyIds` = the
 * colony's string id, `data.colonyId` / `playerId`, see `colonyWho`) so it reaches the colony's channel.
 */
export function produceHarvesterAtHubEdge(state: PlanetState, colonyIndex: number, ctx: StepContext): { entityId: number; q: number; r: number } {
  const spawned = spawnHarvesterAtHubEdge(state, colonyIndex, ctx.tick, ctx.data, ctx);
  const { colonyIdStr, who } = colonyWho(state, colonyIndex);
  ctx.emit({ kind: 'unitProduced', colonyIds: [colonyIdStr], data: { ...who, entityId: spawned.entityId, unit: 'harvester', q: spawned.q, r: spawned.r } });
  return spawned;
}

export function spawnHarvesterAtHubEdge(state: PlanetState, colonyIndex: number, tick: number, data?: CompiledDataLike, ctx?: StepContext): { entityId: number; q: number; r: number } {
  const { harvester } = resolveHubProducerRows(data);
  const pos = findHubEdgeSpawnTile(state, colonyIndex, data);
  const id = ctx ? ctx.newEntityId() : state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, tick);
  const cols = state.entities.cols;
  cols.kind[row] = ENTITY_KIND.harvester;
  cols.owner[row] = colonyIndex;
  cols.tier[row] = Number(harvester.tier ?? 1);
  placeSpawnedEntity(state.entities, row, pos.q, pos.r, tick);
  cols.hp[row] = Math.fround(Number(harvester.hp ?? 160));
  cols.hpMax[row] = Math.fround(Number(harvester.hp ?? 160));
  cols.state[row] = ENTITY_STATE.idle;
  cols.workRate[row] = Math.fround(Number(harvester.workRate ?? 1.0));
  cols.targetQ[row] = pos.q;
  cols.targetR[row] = pos.r;
  cols.createdAt[row] = tick;
  cols.changedAt[row] = tick;

  revealVision(state, colonyIndex, pos.q, pos.r, Number(harvester.viewRadius ?? 7), tick);
  return { entityId: id, q: pos.q, r: pos.r };
}

export function spawnBuilderAtHubEdge(state: PlanetState, colonyIndex: number, tick: number, data?: CompiledDataLike, ctx?: StepContext): { entityId: number; q: number; r: number } {
  const pos = findHubEdgeSpawnTile(state, colonyIndex, data);
  const entityId = spawnBuilderUnit(state, { owner: colonyIndex, q: pos.q, r: pos.r, tick, data }, ctx);
  return { entityId, q: pos.q, r: pos.r };
}

export function produceBuilderAtHubEdge(state: PlanetState, colonyIndex: number, ctx: StepContext): { entityId: number; q: number; r: number } {
  const spawned = spawnBuilderAtHubEdge(state, colonyIndex, ctx.tick, ctx.data, ctx);
  const { colonyIdStr, who } = colonyWho(state, colonyIndex);
  ctx.emit({ kind: 'unitProduced', colonyIds: [colonyIdStr], data: { ...who, entityId: spawned.entityId, unit: 'builder', q: spawned.q, r: spawned.r } });
  return spawned;
}

function refreshColonyUnitQueueStates(state: PlanetState, entries: HubUnitQueueEntry[], colonyIndex: number, tick: number, data?: CompiledDataLike): void {
  const { harvester } = resolveHubProducerRows(data);
  const colony = ensureColony(state, colonyIndex, tick);
  const stock = colony.stock as Record<string, number>;
  const totalStock = Object.values(stock).reduce((a, b) => a + b, 0);

  let hasInProgress = entries.some((e) => e.colonyIndex === colonyIndex && e.state === 'in_progress');

  for (const entry of entries) {
    if (entry.colonyIndex !== colonyIndex || entry.state === 'done' || entry.state === 'cancelled' || entry.state === 'in_progress') {
      continue;
    }
    const unitRow = resolveUnitRowForHub(entry.unit, data);
    const unitSupply = Number(unitRow?.supply ?? harvester.supply ?? 1);
    const supply = getColonySupply(state, colonyIndex, entries, data);
    if (supply.used + unitSupply > supply.cap) {
      entry.state = 'waiting';
      entry.waitReason = 'supply';
      entry.waitDetail = 'waiting(supply)';
      continue;
    }

    if (totalStock > 0) {
      const afford = checkCostAffordability(colony, entry.cost);
      if (Object.keys(afford.exceedsCap).length > 0) {
        entry.state = 'waiting';
        entry.waitReason = 'storage';
        entry.waitDetail = 'waiting(storage)';
        continue;
      }
      const nextSliceProg = Math.min(1, (entry.elapsedTicks + 1) / Math.max(1, entry.buildTicks));
      const totalCost = entry.totalCost ?? entry.cost;
      const spentCost = entry.spentCost ?? {};
      let sliceAffordable = true;
      for (const [k, v] of Object.entries(totalCost) as [ResourceKey, number][]) {
        const needed = Math.max(0, (v ?? 0) * nextSliceProg - (spentCost[k] ?? 0));
        if (needed > 1e-6 && (stock[k] ?? 0) + 1e-6 < needed) {
          sliceAffordable = false;
          break;
        }
      }
      if (!sliceAffordable) {
        entry.state = 'waiting';
        entry.waitReason = 'resources';
        entry.waitDetail = 'waiting(resources)';
        continue;
      }
    }

    if (!hasInProgress) {
      entry.state = 'in_progress';
      entry.waitReason = undefined;
      entry.waitDetail = undefined;
      hasInProgress = true;
    } else {
      entry.state = 'queued';
      entry.waitReason = undefined;
      entry.waitDetail = undefined;
    }
  }
}

export interface EnqueueHubUnitOptions {
  colonyIndex?: number;
  unit?: 'harvester' | 'builder' | string;
  count?: number;
  repeat?: boolean;
  producerId?: number;
  taskId?: string;
  tick?: number;
  data?: CompiledDataLike;
}

/** Enqueues a unit production order (`harvester` or `builder`) at the Command Hub's Units lane (paid progressively as it builds). */
export function enqueueHubUnit(
  state: PlanetState,
  opts: EnqueueHubUnitOptions = {},
): { ok: true; entry: HubUnitQueueEntry; entries: HubUnitQueueEntry[] } | { ok: false; code: string; detail?: string } {
  const tick = opts.tick ?? state.meta.tick;
  const colonyIndex = opts.colonyIndex ?? 0;
  const unitName = opts.unit ?? 'harvester';
  const unitRow = resolveUnitRowForHub(unitName, opts.data);
  if (!unitRow || (unitName !== 'harvester' && unitName !== 'builder')) {
    return { ok: false, code: 'invalid_args', detail: 'unknown unit' };
  }
  const { hubProd } = resolveHubProducerRows(opts.data);
  const entries = getAllEntries(state);
  const activeForColony = entries.filter((e) => e.colonyIndex === colonyIndex && e.state !== 'done' && e.state !== 'cancelled');
  const limit = Number(hubProd.unitsLaneLimit ?? 10);
  if (activeForColony.length >= limit) {
    return { ok: false, code: 'queue_full', detail: 'units lane full' };
  }

  const count = Math.max(1, Math.floor(opts.count ?? 1));
  const cost = { ...(unitRow.cost as Record<ResourceKey, number>) };
  const buildTicks = Math.max(1, Number(unitRow.buildS ?? (unitName === 'builder' ? 60 : 50)));

  const entry: HubUnitQueueEntry = {
    taskId: opts.taskId ?? `u-${colonyIndex}-${tick}-${entries.length + 1}`,
    unit: unitName,
    colonyIndex,
    producerId: opts.producerId,
    count,
    remainingCount: count,
    repeat: Boolean(opts.repeat),
    state: 'queued',
    buildTicks,
    elapsedTicks: 0,
    progress: 0,
    paid: false,
    cost,
    totalCost: { ...cost },
    spentCost: {},
    createdAt: tick,
    spawnedEntityIds: [],
  };

  entries.push(entry);
  refreshColonyUnitQueueStates(state, entries, colonyIndex, tick, opts.data);
  saveAllEntries(state, entries, tick, opts.data);
  return { ok: true, entry, entries };
}

/** Cancels a Hub unit production entry, refunding 50% of `spentCost`. */
export function cancelHubUnit(
  state: PlanetState,
  taskId: string,
  colonyIndex?: number | null,
  tick: number = state.meta.tick,
  data?: CompiledDataLike,
): { ok: true; refunded: boolean } | { ok: false; code: string } {
  const entries = getAllEntries(state);
  const idx = entries.findIndex((e) => e.taskId === taskId && e.state !== 'done' && e.state !== 'cancelled');
  if (idx < 0) return { ok: false, code: 'unknown_task' };
  const entry = entries[idx];
  if (colonyIndex !== undefined && colonyIndex !== null && entry.colonyIndex !== colonyIndex) {
    return { ok: false, code: 'not_own_colony' };
  }

  const colony = ensureColony(state, entry.colonyIndex, tick);
  const spent = entry.spentCost && Object.keys(entry.spentCost).length > 0 ? entry.spentCost : entry.paid ? entry.cost : {};
  const hasSpent = Object.values(spent).some((v) => (v ?? 0) > 0);
  if (hasSpent) refundCost(colony, spent, CANCEL_REFUND_RATE, tick);

  entries.splice(idx, 1);
  refreshColonyUnitQueueStates(state, entries, entry.colonyIndex, tick, data);
  saveAllEntries(state, entries, tick, data);
  return { ok: true, refunded: hasSpent };
}

export function getHubUnitQueue(state: PlanetState, colonyIndex = 0): HubUnitQueueEntry[] {
  return getAllEntries(state).filter((e) => e.colonyIndex === colonyIndex && e.state !== 'done' && e.state !== 'cancelled');
}

export const hubProductionSystem = defineSystem({
  id: 'factories.hub',
  slot: 9,
  wave: 'W02',
  run(state, ctx) {
    const entries = getAllEntries(state);
    if (entries.length === 0) return;
    const { hubProd } = resolveHubProducerRows(ctx.data);
    const rate = Number(hubProd.productionRate ?? 1.0);

    const colonyIndices = new Set<number>(entries.map((e) => e.colonyIndex));
    for (const colIdx of colonyIndices) {
      refreshColonyUnitQueueStates(state, entries, colIdx, ctx.tick, ctx.data);

      const active = entries.find((e) => e.colonyIndex === colIdx && e.state === 'in_progress');
      if (active) {
        const colony = ensureColony(state, colIdx, ctx.tick);
        const totalStock = Object.values(colony.stock as Record<string, number>).reduce((a, b) => a + b, 0);
        const totalCost = active.totalCost ?? active.cost;
        const spentCost = { ...(active.spentCost ?? {}) };
        const hadSpent = Object.values(spentCost).some((v) => (v ?? 0) > 0);
        const nextElapsed = active.elapsedTicks + ctx.dt * rate;
        const nextProgress = Math.min(1, nextElapsed / active.buildTicks);

        if ((totalStock > 0 || hadSpent) && Object.keys(totalCost).length > 0) {
          const pay = payProgressiveSlice(colony, totalCost, spentCost, nextProgress, ctx.tick);
          if (!pay.ok) {
            active.state = 'waiting';
            active.waitReason = 'resources';
            active.waitDetail = 'waiting(resources)';
            continue;
          }
          active.spentCost = spentCost;
          active.paid = Object.values(spentCost).some((v) => (v ?? 0) > 0);
        }

        active.elapsedTicks = nextElapsed;
        active.progress = Math.min(1, Number(nextProgress.toFixed(4)));

        while (active.state === 'in_progress' && active.elapsedTicks >= active.buildTicks - 1e-6) {
          const carry = Math.max(0, active.elapsedTicks - active.buildTicks);
          const spawned = active.unit === 'builder'
            ? produceBuilderAtHubEdge(state, colIdx, ctx)
            : produceHarvesterAtHubEdge(state, colIdx, ctx);
          active.spawnedEntityIds.push(spawned.entityId);

          if (active.remainingCount > 1) {
            active.remainingCount -= 1;
            active.elapsedTicks = carry;
            active.progress = 0;
            active.paid = false;
            active.spentCost = {};
            active.state = 'queued';
            refreshColonyUnitQueueStates(state, entries, colIdx, ctx.tick, ctx.data);
          } else if (active.repeat) {
            active.remainingCount = active.count;
            active.elapsedTicks = carry;
            active.progress = 0;
            active.paid = false;
            active.spentCost = {};
            active.state = 'queued';
            refreshColonyUnitQueueStates(state, entries, colIdx, ctx.tick, ctx.data);
          } else {
            active.progress = 1;
            active.state = 'done';
            refreshColonyUnitQueueStates(state, entries, colIdx, ctx.tick, ctx.data);
          }
        }
      }
    }

    saveAllEntries(
      state,
      entries.filter((e) => e.state !== 'done' && e.state !== 'cancelled'),
      ctx.tick,
      ctx.data,
    );
  },
});

export default defineSimModule({
  id: 'factories-hub',
  wave: 'W02',
  systems: [hubProductionSystem],
});
