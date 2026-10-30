import {
  RESOURCE_FAMILIES,
  RESOURCE_FAMILY_OF,
  type ResourceFamily,
  type ResourceKey,
} from '@terra/contracts';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { rowOf, setField } from '../../ecs/store';
import { hexDistance, hexIndex } from '../../grid/hex';
import { DEPOSIT, PREP, TERRAIN } from '../../grid/layers';
import { setTilePrep, setTileTerrain } from '../../grid/tileModel';
import { defineCommandHandler } from '../../kernel/commands';
import { TICK_MS } from '../../kernel/constants';
import { setBlob, type ColonyState, type PlanetState } from '../../kernel/state';
import { defineSystem } from '../../kernel/system';
import { defineSimModule } from '../define';
import { creditResource, ensureColonyLedger, familyStock, isFamilyAtCap } from '../economy/ledger';
import { resolveHarvesterRow, syncHarvesterView } from './unit';

export * from './unit';

export type HarvestWeights = Record<ResourceFamily, number>;

export interface HarvesterTargetAssignment {
  entityId: number;
  mode: 'harvest' | 'clear' | 'break';
  tileIdx: number;
  q: number;
  r: number;
  family?: ResourceFamily;
  resourceKey?: ResourceKey;
  elapsedTicks: number;
  requiredTicks: number;
}

const DEFAULT_WEIGHTS: HarvestWeights = { metals: 100, minerals: 100, bio: 100 };

function ensureColony(state: PlanetState, owner: number, tick: number): ColonyState {
  let col = state.colonies[owner];
  if (!col) {
    col = { index: owner, id: `col-${owner}`, name: `Colony ${owner + 1}`, color: 0xff6b00, status: 'active', changedAt: tick };
    state.colonies[owner] = col;
  }
  return ensureColonyLedger(col);
}

export function getColonyHarvestWeights(state: PlanetState, colonyIndex = 0): HarvestWeights {
  const col = state.colonies[colonyIndex]?.harvestWeights as Partial<HarvestWeights> | undefined;
  if (col && typeof col.metals === 'number') {
    return { metals: col.metals ?? 100, minerals: col.minerals ?? 100, bio: col.bio ?? 100 };
  }
  const fromBlob = (state.blobs.harvest?.value as { weightsByColony?: Record<number, HarvestWeights> } | undefined)?.weightsByColony?.[colonyIndex];
  if (fromBlob) return { ...fromBlob };
  return { ...DEFAULT_WEIGHTS };
}

function getAssignments(state: PlanetState): Record<number, HarvesterTargetAssignment> {
  const raw = (state.blobs.harvest?.value as { assignments?: Record<number, HarvesterTargetAssignment> } | undefined)?.assignments;
  return raw ? { ...raw } : {};
}

function saveHarvestBlob(
  state: PlanetState,
  weightsByColony: Record<number, HarvestWeights>,
  assignments: Record<number, HarvesterTargetAssignment>,
  tick: number,
): void {
  setBlob(state, 'harvest', { weightsByColony, assignments }, tick);
}

function depositFamilyAndKey(depositCode: number): { family: ResourceFamily; key: ResourceKey } | null {
  if (depositCode === DEPOSIT.metals) return { family: 'metals', key: 'metals.t1' };
  if (depositCode === DEPOSIT.minerals) return { family: 'minerals', key: 'minerals.t1' };
  if (depositCode === DEPOSIT.oil) return { family: 'bio', key: 'bio.biomass' };
  return null;
}

/**
 * Picks the best surface deposit (not under a building, `anchors[i] === 0`) for a Harvester at `(unitQ, unitR)`:
 * ranks families by `weight * stockDeficit` (`most-needed family`), breaking ties by nearest hex distance.
 */
export function pickBestSurfaceDeposit(
  state: PlanetState,
  colonyIndex: number,
  unitQ: number,
  unitR: number,
): { tileIdx: number; q: number; r: number; family: ResourceFamily; resourceKey: ResourceKey } | null {
  const colony = ensureColony(state, colonyIndex, state.meta.tick);
  const weights = getColonyHarvestWeights(state, colonyIndex);
  const familyNeed: Record<ResourceFamily, number> = { metals: 0, minerals: 0, bio: 0 };

  for (const f of RESOURCE_FAMILIES) {
    const w = Math.max(0, weights[f] ?? 100);
    if (w <= 0 || isFamilyAtCap(colony, f)) {
      familyNeed[f] = 0;
    } else {
      const cap = Math.max(1, colony.caps[f] ?? 500);
      const deficit = Math.max(1, cap - familyStock(colony, f));
      familyNeed[f] = w * deficit;
    }
  }

  const layers = state.grid.layers;
  const deposit = layers.deposit as Uint8Array;
  const anchors = layers.anchors as Uint8Array;
  const terrain = layers.terrain as Uint8Array;
  const prep = layers.prep as Uint8Array;
  const idx = hexIndex(state.grid.radius);

  let bestTile = -1;
  let bestNeed = 0;
  let bestDist = Infinity;
  let bestInfo: { family: ResourceFamily; key: ResourceKey } | null = null;

  for (let i = 0; i < state.grid.count; i++) {
    const info = depositFamilyAndKey(deposit[i]);
    if (!info) continue;
    if (anchors[i] !== 0) continue; // under a building
    if (terrain[i] === TERRAIN.deep || prep[i] === PREP.ridge || prep[i] === PREP.moat) continue;

    const need = familyNeed[info.family];
    if (need <= 0) continue;

    const dist = hexDistance(unitQ, unitR, idx.q[i], idx.r[i]);
    if (need > bestNeed + 1e-6 || (Math.abs(need - bestNeed) <= 1e-6 && dist < bestDist)) {
      bestNeed = need;
      bestDist = dist;
      bestTile = i;
      bestInfo = info;
    }
  }

  if (bestTile < 0 || !bestInfo) return null;
  return {
    tileIdx: bestTile,
    q: idx.q[bestTile],
    r: idx.r[bestTile],
    family: bestInfo.family,
    resourceKey: bestInfo.key,
  };
}

/** Sets colony harvest weights (`0..100` per family) and retargets active/idle Harvesters immediately. */
export function applyColonyHarvestWeights(
  state: PlanetState,
  colonyIndex: number,
  weights: Partial<HarvestWeights>,
  tick: number = state.meta.tick,
): HarvestWeights {
  const prev = getColonyHarvestWeights(state, colonyIndex);
  const next: HarvestWeights = {
    metals: typeof weights.metals === 'number' ? Math.max(0, Math.min(100, weights.metals)) : prev.metals,
    minerals: typeof weights.minerals === 'number' ? Math.max(0, Math.min(100, weights.minerals)) : prev.minerals,
    bio: typeof weights.bio === 'number' ? Math.max(0, Math.min(100, weights.bio)) : prev.bio,
  };
  const colony = ensureColony(state, colonyIndex, tick);
  colony.harvestWeights = next;
  colony.changedAt = tick;

  const rawBlob = (state.blobs.harvest?.value as { weightsByColony?: Record<number, HarvestWeights>; assignments?: Record<number, HarvesterTargetAssignment> } | undefined) ?? {};
  const weightsByColony = { ...(rawBlob.weightsByColony ?? {}), [colonyIndex]: next };
  const assignments = { ...(rawBlob.assignments ?? {}) };

  const e = state.entities, cols = e.cols;
  for (let row = 0; row < e.count; row++) {
    if (cols.owner[row] !== colonyIndex || cols.kind[row] !== ENTITY_KIND.harvester || cols.hp[row] <= 0) continue;
    const id = cols.id[row];
    const current = assignments[id];
    if (current && current.mode !== 'harvest') continue; // keep explicit clear/break sub-job
    const target = pickBestSurfaceDeposit(state, colonyIndex, cols.q[row], cols.r[row]);
    if (target) {
      assignments[id] = {
        entityId: id, mode: 'harvest', tileIdx: target.tileIdx, q: target.q, r: target.r,
        family: target.family, resourceKey: target.resourceKey, elapsedTicks: 0, requiredTicks: 0,
      };
      setField(e, row, 'targetQ', target.q, tick);
      setField(e, row, 'targetR', target.r, tick);
      const dist = hexDistance(cols.x[row], cols.y[row], target.q, target.r);
      setField(e, row, 'state', dist <= 1e-4 ? ENTITY_STATE.harvesting : ENTITY_STATE.moving, tick);
      syncHarvesterView(state, row, tick);
    }
  }

  saveHarvestBlob(state, weightsByColony, assignments, tick);
  return next;
}

/** Assigns a Clear (`forest`) or Break (`rock`) terraform sub-job to a Harvester (`allowedTerraformOps: ['clear', 'break']`). */
export function assignHarvesterSubJob(
  state: PlanetState,
  entityId: number,
  op: string,
  q: number,
  r: number,
  tick: number = state.meta.tick,
): { ok: true } | { ok: false; code: string } {
  if (op !== 'clear' && op !== 'break') return { ok: false, code: 'op_not_allowed' };
  const row = rowOf(state.entities, entityId);
  if (row < 0 || state.entities.cols.kind[row] !== ENTITY_KIND.harvester) return { ok: false, code: 'unknown_entity' };
  const idx = hexIndex(state.grid.radius);
  const tileIdx = idx.indexOf(q, r);
  if (tileIdx < 0) return { ok: false, code: 'invalid_args' };
  const terrain = state.grid.layers.terrain[tileIdx];
  if (op === 'clear' && terrain !== TERRAIN.forest) return { ok: false, code: 'invalid_terrain' };
  if (op === 'break' && terrain !== TERRAIN.rock) return { ok: false, code: 'invalid_terrain' };

  const rawBlob = (state.blobs.harvest?.value as { weightsByColony?: Record<number, HarvestWeights>; assignments?: Record<number, HarvesterTargetAssignment> } | undefined) ?? {};
  const assignments = { ...(rawBlob.assignments ?? {}) };
  assignments[entityId] = {
    entityId, mode: op, tileIdx, q, r,
    elapsedTicks: 0, requiredTicks: op === 'clear' ? 30 : 40,
  };
  setField(state.entities, row, 'targetQ', q, tick);
  setField(state.entities, row, 'targetR', r, tick);
  const dist = hexDistance(state.entities.cols.x[row], state.entities.cols.y[row], q, r);
  setField(state.entities, row, 'state', dist <= 1e-4 ? ENTITY_STATE.working : ENTITY_STATE.moving, tick);
  saveHarvestBlob(state, rawBlob.weightsByColony ?? {}, assignments, tick);
  return { ok: true };
}

export const setHarvestWeightsHandler = defineCommandHandler({
  kind: 'setHarvestWeights',
  wave: 'W02',
  handle(state, cmd, ctx) {
    const args = (cmd.args ?? {}) as Partial<HarvestWeights>;
    applyColonyHarvestWeights(state, cmd.colonyIndex ?? 0, args, ctx.tick);
  },
});

const standingHarvestAssignSystem = defineSystem({
  id: 'harvest.standing',
  slot: 5, // runs before 'movement' (slot 5, 'harvest.standing' < 'movement')
  wave: 'W02',
  run(state, ctx) {
    const e = state.entities, cols = e.cols;
    const rawBlob = (state.blobs.harvest?.value as { weightsByColony?: Record<number, HarvestWeights>; assignments?: Record<number, HarvesterTargetAssignment> } | undefined) ?? {};
    const assignments = { ...(rawBlob.assignments ?? {}) };
    let changed = false;

    for (let row = 0; row < e.count; row++) {
      if (cols.kind[row] !== ENTITY_KIND.harvester || cols.hp[row] <= 0) continue;
      const id = cols.id[row];
      const owner = cols.owner[row];
      const st = cols.state[row];
      const cur = assignments[id];

      if (cur && (cur.mode === 'clear' || cur.mode === 'break')) {
        if (st === ENTITY_STATE.idle && cols.q[row] === cur.q && cols.r[row] === cur.r) {
          setField(e, row, 'state', ENTITY_STATE.working, ctx.tick);
        }
        continue;
      }

      const weights = getColonyHarvestWeights(state, owner);
      const needsTarget =
        !cur ||
        state.grid.layers.anchors[cur.tileIdx] !== 0 ||
        (cur.family && (isFamilyAtCap(ensureColony(state, owner, ctx.tick), cur.family) || (weights[cur.family] ?? 100) <= 0));

      if (st === ENTITY_STATE.idle || needsTarget) {
        const best = pickBestSurfaceDeposit(state, owner, cols.q[row], cols.r[row]);
        if (!best) {
          if (st === ENTITY_STATE.harvesting) setField(e, row, 'state', ENTITY_STATE.idle, ctx.tick);
          continue;
        }
        if (!cur || cur.tileIdx !== best.tileIdx || cur.resourceKey !== best.resourceKey) {
          assignments[id] = {
            entityId: id, mode: 'harvest', tileIdx: best.tileIdx, q: best.q, r: best.r,
            family: best.family, resourceKey: best.resourceKey, elapsedTicks: 0, requiredTicks: 0,
          };
          changed = true;
          setField(e, row, 'targetQ', best.q, ctx.tick);
          setField(e, row, 'targetR', best.r, ctx.tick);
        }
        const dist = hexDistance(cols.x[row], cols.y[row], best.q, best.r);
        if (dist > 1e-4) {
          if (st !== ENTITY_STATE.moving) setField(e, row, 'state', ENTITY_STATE.moving, ctx.tick);
        } else if (st !== ENTITY_STATE.harvesting) {
          setField(e, row, 'state', ENTITY_STATE.harvesting, ctx.tick);
        }
      }
    }

    if (changed) saveHarvestBlob(state, rawBlob.weightsByColony ?? {}, assignments, ctx.tick);
  },
});

const standingHarvestYieldSystem = defineSystem({
  id: 'production.harvest',
  slot: 8, // runs in production slot alongside extractors
  wave: 'W02',
  run(state, ctx) {
    const harvRow = resolveHarvesterRow(ctx.data);
    const ratePerS = Number(harvRow.harvestRatePerS ?? 0.5); // 2.0 * ECONOMY_RATE_SCALE(0.25) = 0.5 res/s
    const e = state.entities, cols = e.cols;
    const rawBlob = (state.blobs.harvest?.value as { weightsByColony?: Record<number, HarvestWeights>; assignments?: Record<number, HarvesterTargetAssignment> } | undefined) ?? {};
    const assignments = { ...(rawBlob.assignments ?? {}) };
    let changed = false;

    for (let row = 0; row < e.count; row++) {
      if (cols.kind[row] !== ENTITY_KIND.harvester || cols.hp[row] <= 0) continue;
      const id = cols.id[row];
      const owner = cols.owner[row];
      const cur = assignments[id];

      if (cur && (cur.mode === 'clear' || cur.mode === 'break') && cols.q[row] === cur.q && cols.r[row] === cur.r) {
        cur.elapsedTicks += ctx.dt;
        changed = true;
        if (cur.elapsedTicks >= cur.requiredTicks) {
          const colony = ensureColony(state, owner, ctx.tick);
          setTileTerrain(state, cur.tileIdx, TERRAIN.flat, ctx.tick);
          setTilePrep(state, cur.tileIdx, PREP.flat, ctx.tick);
          creditResource(colony, cur.mode === 'clear' ? 'bio.biomass' : 'minerals.t1', 15, ctx.tick);
          delete assignments[id];
          setField(e, row, 'state', ENTITY_STATE.idle, ctx.tick);
        }
        continue;
      }

      if (cols.state[row] === ENTITY_STATE.idle && cur?.mode === 'harvest' && cols.q[row] === cur.q && cols.r[row] === cur.r) {
        setField(e, row, 'state', ENTITY_STATE.harvesting, ctx.tick);
      }

      if (cols.state[row] === ENTITY_STATE.harvesting && cur?.mode === 'harvest' && cur.resourceKey) {
        const colony = ensureColony(state, owner, ctx.tick);
        const fam = RESOURCE_FAMILY_OF[cur.resourceKey];
        if (!isFamilyAtCap(colony, fam)) {
          const amount = (ratePerS * TICK_MS * ctx.dt) / 1000;
          creditResource(colony, cur.resourceKey, amount, ctx.tick);
          colony.production.incomePerS[cur.resourceKey] = Number(
            ((colony.production.incomePerS[cur.resourceKey] ?? 0) + ratePerS).toFixed(4),
          );
          colony.production.familyIncomePerS[fam] = Number(
            ((colony.production.familyIncomePerS[fam] ?? 0) + ratePerS).toFixed(4),
          );
        } else {
          setField(e, row, 'state', ENTITY_STATE.idle, ctx.tick);
        }
      }
      syncHarvesterView(state, row, ctx.tick, ctx.data);
    }

    if (changed) saveHarvestBlob(state, rawBlob.weightsByColony ?? {}, assignments, ctx.tick);
  },
});

export default defineSimModule({
  id: 'harvest',
  wave: 'W02',
  systems: [standingHarvestAssignSystem, standingHarvestYieldSystem],
  handlers: [setHarvestWeightsHandler],
});
