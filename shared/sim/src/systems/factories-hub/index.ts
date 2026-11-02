import type { ResourceKey } from '@terra/contracts';
import { compileData, dataRow, type CompiledRow } from '../../data';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { placeSpawnedEntity } from '../../ecs/placement';
import { insertRow } from '../../ecs/store';
import { hexIndex } from '../../grid/hex';
import { PREP, TERRAIN } from '../../grid/layers';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import { setBlob, type ColonyState, type PlanetState } from '../../kernel/state';
import { defineSystem } from '../../kernel/system';
import { defineSimModule } from '../define';
import { checkCostAffordability, debitCost, ensureColonyLedger } from '../economy/ledger';
import { revealVision } from '../hq';

export interface HubUnitQueueEntry {
  taskId: string;
  unit: 'harvester';
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

let cachedData: CompiledDataLike | null = null;
function defaultData(): CompiledDataLike {
  if (!cachedData) cachedData = compileData(new Set(['W00', 'W01', 'W02']));
  return cachedData;
}

export function resolveHubProducerRows(data?: CompiledDataLike): { harvester: CompiledRow; hubProd: CompiledRow; hub: CompiledRow } {
  const d = data?.tables?.unitsWorkersBasic ? data : defaultData();
  return {
    harvester: dataRow(d, 'unitsWorkersBasic', 'harvester'),
    hubProd: dataRow(d, 'unitsWorkersBasic', 'hubProduction'),
    hub: dataRow(d, 'hub', 't1'),
  };
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
  const { harvester, hubProd, hub } = resolveHubProducerRows(data);
  const unitSupply = Number(harvester.supply ?? 1);
  const e = state.entities, cols = e.cols;
  let activeUnits = 0;
  let hubCount = 0;

  for (let row = 0; row < e.count; row++) {
    if (cols.owner[row] !== colonyIndex || cols.hp[row] <= 0) continue;
    if (cols.kind[row] === ENTITY_KIND.harvester) activeUnits += unitSupply;
    else if (cols.kind[row] === ENTITY_KIND.commandHub && cols.state[row] !== ENTITY_STATE.constructing) hubCount++;
  }

  const inProgressSupply = entries
    .filter((en) => en.colonyIndex === colonyIndex && en.state === 'in_progress')
    .reduce((sum) => sum + unitSupply, 0);

  const baseCap = Number(hub.supplyCap ?? hubProd.baseSupplyCap ?? 10);
  const cap = hubCount > 0 ? hubCount * baseCap : baseCap;
  const used = activeUnits + inProgressSupply;
  return { used, activeUnits, inProgressSupply, cap, available: Math.max(0, cap - used) };
}

function getAllEntries(state: PlanetState): HubUnitQueueEntry[] {
  const raw = (state.blobs.hubProduction?.value as { entries?: HubUnitQueueEntry[] } | undefined)?.entries;
  return raw ? raw.map((e) => ({ ...e, spawnedEntityIds: [...(e.spawnedEntityIds ?? [])] })) : [];
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

function findHubEdgeSpawnTile(state: PlanetState, colonyIndex: number): { q: number; r: number } {
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
  const candidates = [
    { q: hubQ + hubW, r: hubR },
    { q: hubQ, r: hubR + hubD },
    { q: hubQ - 1, r: hubR },
    { q: hubQ, r: hubR - 1 },
    { q: hubQ + 1, r: hubR },
  ];
  const idx = hexIndex(state.grid.radius);
  const layers = state.grid.layers;
  for (const c of candidates) {
    const t = idx.indexOf(c.q, c.r);
    if (t >= 0 && layers.terrain[t] !== TERRAIN.deep && layers.prep[t] !== PREP.ridge && layers.prep[t] !== PREP.moat) {
      return c;
    }
  }
  return { q: hubQ, r: hubR };
}

function spawnHarvesterAtHubEdge(state: PlanetState, colonyIndex: number, tick: number, data?: CompiledDataLike, ctx?: StepContext): { entityId: number; q: number; r: number } {
  const { harvester } = resolveHubProducerRows(data);
  const pos = findHubEdgeSpawnTile(state, colonyIndex);
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

function refreshColonyUnitQueueStates(state: PlanetState, entries: HubUnitQueueEntry[], colonyIndex: number, tick: number, data?: CompiledDataLike): void {
  const { harvester } = resolveHubProducerRows(data);
  const unitSupply = Number(harvester.supply ?? 1);
  const colony = ensureColony(state, colonyIndex, tick);
  const totalStock = Object.values(colony.stock as Record<string, number>).reduce((a, b) => a + b, 0);

  let hasInProgress = entries.some((e) => e.colonyIndex === colonyIndex && e.state === 'in_progress');

  for (const entry of entries) {
    if (entry.colonyIndex !== colonyIndex || entry.state === 'done' || entry.state === 'cancelled' || entry.state === 'in_progress') {
      continue;
    }
    const supply = getColonySupply(state, colonyIndex, entries, data);
    if (supply.used + unitSupply > supply.cap) {
      entry.state = 'waiting';
      entry.waitReason = 'supply';
      entry.waitDetail = 'waiting(supply)';
      continue;
    }

    if (totalStock > 0) {
      const afford = checkCostAffordability(colony, entry.cost);
      if (!afford.ok) {
        entry.state = 'waiting';
        entry.waitReason = Object.keys(afford.exceedsCap).length > 0 ? 'storage' : 'resources';
        entry.waitDetail = `waiting(${entry.waitReason})`;
        continue;
      }
    }

    if (!hasInProgress) {
      if (totalStock > 0) debitCost(colony, entry.cost, tick);
      entry.paid = true;
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
  unit?: 'harvester';
  count?: number;
  repeat?: boolean;
  producerId?: number;
  taskId?: string;
  tick?: number;
  data?: CompiledDataLike;
}

/** Enqueues a Harvester unit production order at the Command Hub's Units lane (5-slot buffer, 1.0x rate, paid on start). */
export function enqueueHubUnit(
  state: PlanetState,
  opts: EnqueueHubUnitOptions = {},
): { ok: true; entry: HubUnitQueueEntry; entries: HubUnitQueueEntry[] } | { ok: false; code: string; detail?: string } {
  const tick = opts.tick ?? state.meta.tick;
  const colonyIndex = opts.colonyIndex ?? 0;
  const { harvester, hubProd } = resolveHubProducerRows(opts.data);
  const entries = getAllEntries(state);
  const activeForColony = entries.filter((e) => e.colonyIndex === colonyIndex && e.state !== 'done' && e.state !== 'cancelled');
  const limit = Number(hubProd.unitsLaneLimit ?? 10);
  if (activeForColony.length >= limit) {
    return { ok: false, code: 'queue_full', detail: 'units lane full' };
  }

  const count = Math.max(1, Math.floor(opts.count ?? 1));
  const cost = { ...(harvester.cost as Record<ResourceKey, number>) };
  const buildTicks = Math.max(1, Number(harvester.buildS ?? 50));

  const entry: HubUnitQueueEntry = {
    taskId: opts.taskId ?? `u-${colonyIndex}-${tick}-${entries.length + 1}`,
    unit: 'harvester',
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
    createdAt: tick,
    spawnedEntityIds: [],
  };

  entries.push(entry);
  refreshColonyUnitQueueStates(state, entries, colonyIndex, tick, opts.data);
  saveAllEntries(state, entries, tick, opts.data);
  return { ok: true, entry, entries };
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
        active.elapsedTicks += ctx.dt * rate;
        active.progress = Math.min(1, Number((active.elapsedTicks / active.buildTicks).toFixed(4)));

        while (active.state === 'in_progress' && active.elapsedTicks >= active.buildTicks - 1e-6) {
          const carry = Math.max(0, active.elapsedTicks - active.buildTicks);
          const spawned = spawnHarvesterAtHubEdge(state, colIdx, ctx.tick, ctx.data, ctx);
          active.spawnedEntityIds.push(spawned.entityId);
          ctx.emit({
            kind: 'unitProduced',
            colonyIds: [colIdx],
            data: { entityId: spawned.entityId, unit: 'harvester', q: spawned.q, r: spawned.r },
          });

          if (active.remainingCount > 1) {
            active.remainingCount -= 1;
            active.elapsedTicks = carry;
            active.progress = 0;
            active.paid = false;
            active.state = 'queued';
            refreshColonyUnitQueueStates(state, entries, colIdx, ctx.tick, ctx.data);
          } else if (active.repeat) {
            active.remainingCount = active.count;
            active.elapsedTicks = carry;
            active.progress = 0;
            active.paid = false;
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
