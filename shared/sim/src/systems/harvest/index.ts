import {
  RESOURCE_FAMILY_OF,
  type ResourceFamily,
  type ResourceKey,
} from '@terra/contracts';
import { goalHarvestResource, goalHarvestWeights } from '../goals/harvestWeights';
import { consumeDepositRichness, TERRAFORM_TIME_TABLE } from '../../data';
import { groundWorkYields, terraformYields } from '../terraform-basic/ops';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { rowOf, setField } from '../../ecs/store';
import { hexDistance, hexIndex } from '../../grid/hex';
import { PREP, TERRAIN } from '../../grid/layers';
import { setTilePrep, setTileTerrain } from '../../grid/tileModel';
import { defineCommandHandler } from '../../kernel/commands';
import type { CompiledDataLike } from '../../kernel/config';
import { TICK_MS } from '../../kernel/constants';
import type { StepContext } from '../../kernel/context';
import { setBlob, type PlanetState } from '../../kernel/state';
import { defineSystem } from '../../kernel/system';
import { UnitBook } from '../../units/book';
import { faceTowards } from '../../units/movement/locomotion';
import { cancelMove, requestMove } from '../../units/movement/orchestrator';
import { commandColony } from '../command';
import { occupiedGroundTiles } from '../construction/occupancy';
import { defineSimModule } from '../define';
import { creditResource, ensureColonyAt, isFamilyAtCap, type ColonyWithLedger } from '../economy/ledger';
import {
  assignWorkerDepositTarget,
  depositFamilyAndKey,
  HARVEST_CYCLE_TICKS,
  hasAnyPassableNeighbor,
  isPassableAdjacentHex,
  pickBestSurfaceDepositForUnit,
  pickFreeAdjacentDepositHex,
  type WorkerTargetAssignment,
  type HarvestWeights,
} from './adjacency';
import { harvestRateForWorker, syncHarvestWorkerView } from './workers';
import { isWorker } from './unit';

export * from './unit';
export { harvestRateForWorker, syncHarvestWorkerView } from './workers';
export {
  assignWorkerDepositTarget,
  depositFamilyAndKey,
  HARVEST_CYCLE_TICKS,
  hasAnyPassableNeighbor,
  isPassableAdjacentHex,
  pickFreeAdjacentDepositHex,
  type WorkerTargetAssignment,
  type HarvestWeights,
};

const DEFAULT_WEIGHTS: HarvestWeights = { metals: 100, minerals: 100, bio: 100 };
// The metals rates (`metals.t1..t3`) are reset by the extractor system, which runs first in slot 8
// (`production.extractors` < `production.harvest`); harvesting adds to them.
const TIERED_HARVEST_KEYS: readonly ResourceKey[] = ['minerals.t2', 'minerals.t3', 'bio.t2', 'bio.t3'];
const ensureColony = ensureColonyAt;

export function getColonyHarvestWeights(state: PlanetState, colonyIndex = 0, useGoals = true): HarvestWeights {
  const goalWeights = useGoals ? goalHarvestWeights(state, colonyIndex) : null;
  if (goalWeights) return goalWeights;
  const col = state.colonies[colonyIndex]?.harvestWeights as Partial<HarvestWeights> | undefined;
  if (col && typeof col.metals === 'number') {
    return { metals: col.metals ?? 100, minerals: col.minerals ?? 100, bio: col.bio ?? 100 };
  }
  const fromBlob = (state.blobs.harvest?.value as { weightsByColony?: Record<number, HarvestWeights> } | undefined)?.weightsByColony?.[colonyIndex];
  if (fromBlob) return { ...fromBlob };
  return { ...DEFAULT_WEIGHTS };
}

function saveHarvestBlob(
  state: PlanetState,
  weightsByColony: Record<number, HarvestWeights>,
  assignments: Record<number, WorkerTargetAssignment>,
  tick: number,
): void {
  setBlob(state, 'harvest', { weightsByColony, assignments }, tick);
}

export function pickBestSurfaceDeposit(
  state: PlanetState,
  colonyIndex: number,
  unitQ: number,
  unitR: number,
  selfEntityId = -1,
): { tileIdx: number; q: number; r: number; standQ: number; standR: number; family: ResourceFamily; resourceKey: ResourceKey } | null {
  const colony = ensureColony(state, colonyIndex, state.meta.tick);
  const weights = getColonyHarvestWeights(state, colonyIndex);
  const rawBlob = (state.blobs.harvest?.value as { assignments?: Record<number, WorkerTargetAssignment> } | undefined) ?? {};
  return pickBestSurfaceDepositForUnit(state, colony, weights, unitQ, unitR, selfEntityId, rawBlob.assignments);
}

/** Sets colony harvest weights (`0..100` per family) and retargets active/idle Workers immediately. */
export function applyColonyHarvestWeights(
  state: PlanetState,
  colonyIndex: number,
  weights: Partial<HarvestWeights>,
  tick: number = state.meta.tick,
): HarvestWeights {
  const prev = getColonyHarvestWeights(state, colonyIndex, false);
  const next: HarvestWeights = {
    metals: typeof weights.metals === 'number' ? Math.max(0, Math.min(100, weights.metals)) : prev.metals,
    minerals: typeof weights.minerals === 'number' ? Math.max(0, Math.min(100, weights.minerals)) : prev.minerals,
    bio: typeof weights.bio === 'number' ? Math.max(0, Math.min(100, weights.bio)) : prev.bio,
  };
  const colony = ensureColony(state, colonyIndex, tick);
  colony.harvestWeights = next;
  colony.changedAt = tick;

  const rawBlob = (state.blobs.harvest?.value as { weightsByColony?: Record<number, HarvestWeights>; assignments?: Record<number, WorkerTargetAssignment> } | undefined) ?? {};
  const weightsByColony = { ...(rawBlob.weightsByColony ?? {}), [colonyIndex]: next };
  const assignments = { ...(rawBlob.assignments ?? {}) };

  const e = state.entities, cols = e.cols;
  for (let row = 0; row < e.count; row++) {
    if (cols.owner[row] !== colonyIndex || !isWorker(cols.kind[row]) || cols.hp[row] <= 0) continue;
    const id = cols.id[row];
    const current = assignments[id];
    if (current && current.mode !== 'harvest') continue;
    const target = pickBestSurfaceDepositForUnit(state, colony, next, cols.q[row], cols.r[row], id, assignments);
    if (target) {
      assignments[id] = {
        entityId: id, mode: 'harvest', tileIdx: target.tileIdx, q: target.q, r: target.r,
        standQ: target.standQ, standR: target.standR,
        family: target.family, resourceKey: target.resourceKey, elapsedTicks: 0, requiredTicks: 0,
      };
      setField(e, row, 'targetQ', target.q, tick);
      setField(e, row, 'targetR', target.r, tick);
      cancelMove(state, id, tick);
      const atNeighbor = hexDistance(cols.q[row], cols.r[row], target.q, target.r) === 1 && hexDistance(cols.x[row], cols.y[row], cols.q[row], cols.r[row]) <= 0.15;
      setField(e, row, 'state', atNeighbor ? ENTITY_STATE.harvesting : ENTITY_STATE.moving, tick);
      syncHarvestWorkerView(state, row, tick);
    }
  }

  saveHarvestBlob(state, weightsByColony, assignments, tick);
  return next;
}

/** Assigns a Clear (`forest`), Break (`rock`), or Work (`work`) sub-job to a Worker Drone. */
export function assignWorkerSubJob(
  state: PlanetState,
  entityId: number,
  op: string,
  q: number,
  r: number,
  tick: number = state.meta.tick,
): { ok: true } | { ok: false; code: string } {
  if (op !== 'clear' && op !== 'break' && op !== 'work') return { ok: false, code: 'op_not_allowed' };
  const row = rowOf(state.entities, entityId);
  if (row < 0 || state.entities.cols.kind[row] !== ENTITY_KIND.worker) return { ok: false, code: 'unknown_entity' };
  const idx = hexIndex(state.grid.radius);
  const tileIdx = idx.indexOf(q, r);
  if (tileIdx < 0) return { ok: false, code: 'invalid_args' };
  const terrain = state.grid.layers.terrain[tileIdx];
  const prep = state.grid.layers.prep[tileIdx];
  if (op === 'clear' && terrain !== TERRAIN.forest) return { ok: false, code: 'invalid_terrain' };
  if (op === 'break' && terrain !== TERRAIN.rock) return { ok: false, code: 'invalid_terrain' };
  if (op === 'work') {
    if (terrain === TERRAIN.deep || terrain === TERRAIN.shallow || prep === PREP.ridge || prep === PREP.moat) {
      return { ok: false, code: 'invalid_terrain' };
    }
    if (terrain === TERRAIN.flat && (prep === PREP.prepared || prep === PREP.living)) {
      return { ok: false, code: 'already_prepared' };
    }
  }

  const reqTicks =
    op === 'clear' ? 30
    : op === 'break' ? 40
    : terrain === TERRAIN.forest ? TERRAFORM_TIME_TABLE.forest.durationTicks
    : terrain === TERRAIN.rock ? TERRAFORM_TIME_TABLE.rock.durationTicks
    : terrain === TERRAIN.slope ? TERRAFORM_TIME_TABLE.slope.durationTicks
    : terrain === TERRAIN.hole ? TERRAFORM_TIME_TABLE.hole.durationTicks
    : TERRAFORM_TIME_TABLE.flat.durationTicks;

  const rawBlob = (state.blobs.harvest?.value as { weightsByColony?: Record<number, HarvestWeights>; assignments?: Record<number, WorkerTargetAssignment> } | undefined) ?? {};
  const assignments = { ...(rawBlob.assignments ?? {}) };
  assignments[entityId] = {
    entityId, mode: op, tileIdx, q, r,
    elapsedTicks: 0, requiredTicks: reqTicks,
  };
  setField(state.entities, row, 'targetQ', q, tick);
  setField(state.entities, row, 'targetR', r, tick);
  const dist = hexDistance(state.entities.cols.q[row], state.entities.cols.r[row], q, r);
  setField(state.entities, row, 'state', dist <= 1 ? ENTITY_STATE.working : ENTITY_STATE.moving, tick);
  saveHarvestBlob(state, rawBlob.weightsByColony ?? {}, assignments, tick);
  return { ok: true };
}

/** Cancels a Worker Drone's active harvest/work assignment and sets it to `idle` with `progress = 0`. */
export function cancelWorkerTask(
  state: PlanetState,
  entityId: number,
  tick: number = state.meta.tick,
  data?: CompiledDataLike,
): boolean {
  const row = rowOf(state.entities, entityId);
  if (row < 0) return false;
  const rawBlob = (state.blobs.harvest?.value as { weightsByColony?: Record<number, HarvestWeights>; assignments?: Record<number, WorkerTargetAssignment> } | undefined) ?? {};
  const assignments = { ...(rawBlob.assignments ?? {}) };
  const hadAssignment = Boolean(assignments[entityId]);
  if (hadAssignment) {
    delete assignments[entityId];
    saveHarvestBlob(state, rawBlob.weightsByColony ?? {}, assignments, tick);
  }
  const book = new UnitBook(state);
  const rec = book.get(entityId);
  rec.current = null;
  rec.queue = [];
  rec.holdUntil = tick + 1;
  book.touch();
  book.flush(tick);
  cancelMove(state, entityId, tick);
  setField(state.entities, row, 'progress', 0, tick);
  setField(state.entities, row, 'state', ENTITY_STATE.idle, tick);
  setField(state.entities, row, 'targetQ', state.entities.cols.q[row], tick);
  setField(state.entities, row, 'targetR', state.entities.cols.r[row], tick);
  syncHarvestWorkerView(state, row, tick, data);
  return true;
}

export const setHarvestWeightsHandler = defineCommandHandler({
  kind: 'setHarvestWeights',
  wave: 'W02',
  handle(state, cmd, ctx) {
    const colIdx = commandColony(cmd); // never "colony 0" for a planet-level command (GP-46)
    if (typeof colIdx === 'string') return colIdx;
    const args = (cmd.args ?? {}) as Partial<HarvestWeights>;
    applyColonyHarvestWeights(state, colIdx, args, ctx.tick);
  },
});

function stepWorkerSubJobMove(
  state: PlanetState,
  row: number,
  id: number,
  st: number,
  cur: WorkerTargetAssignment,
  ctx: StepContext,
): void {
  const cols = state.entities.cols;
  const dist = hexDistance(cols.q[row], cols.r[row], cur.q, cur.r);
  if (dist <= 1) {
    cancelMove(state, id, ctx.tick);
    faceTowards(state, row, cur.q, cur.r, ctx.tick);
    if (st !== ENTITY_STATE.working) setField(state.entities, row, 'state', ENTITY_STATE.working, ctx.tick);
  } else {
    if (st !== ENTITY_STATE.moving) setField(state.entities, row, 'state', ENTITY_STATE.moving, ctx.tick);
    requestMove(state, row, { q: cur.q, r: cur.r, minDist: 0, maxDist: 1 }, ctx);
  }
}

const standingHarvestAssignSystem = defineSystem({
  id: 'harvest.standing',
  slot: 5,
  wave: 'W02',
  run(state, ctx) {
    const e = state.entities, cols = e.cols;
    const book = new UnitBook(state);
    const rawBlob = (state.blobs.harvest?.value as { weightsByColony?: Record<number, HarvestWeights>; assignments?: Record<number, WorkerTargetAssignment> } | undefined) ?? {};
    const assignments = { ...(rawBlob.assignments ?? {}) };
    const workJobsById = (state.blobs.workJobs?.value as { byId?: Record<string, { workerEntityId?: number }> } | undefined)?.byId;
    const occupied = occupiedGroundTiles(state, ctx.data); // building footprints (not `anchors`: territory)
    let changed = false;

    for (let row = 0; row < e.count; row++) {
      if (!isWorker(cols.kind[row]) || cols.hp[row] <= 0) continue;
      const id = cols.id[row], owner = cols.owner[row], st = cols.state[row];
      let cur = assignments[id];

      const uRec = book.peek(id);
      if (uRec && (uRec.current !== null || uRec.queue.length > 0 || ctx.tick < uRec.holdUntil)) {
        if (cur && cur.mode === 'harvest' && !cur.playerAssigned) { delete assignments[id]; changed = true; }
        continue;
      }
      if (workJobsById && Object.values(workJobsById).some((j) => j.workerEntityId === id)) continue;
      if (cur && (cur.mode === 'clear' || cur.mode === 'break' || cur.mode === 'work')) {
        stepWorkerSubJobMove(state, row, id, st, cur, ctx);
        continue;
      }

      const colony = ensureColony(state, owner, ctx.tick);
      const weights = getColonyHarvestWeights(state, owner, ctx.flags.has('W08'));
      const goalResource = ctx.flags.has('W08') ? goalHarvestResource(state, owner) : null;
      const curDepleted = cur ? Number(state.grid.layers.richness?.[cur.tileIdx] ?? 10000) <= 0 : true;
      const needsTarget =
        !cur ||
        curDepleted ||
        occupied.has(cur.tileIdx) ||
        (cur.family && isFamilyAtCap(colony, cur.family)) ||
        (!cur.playerAssigned && cur.family && (weights[cur.family] ?? 100) <= 0) ||
        (!cur.playerAssigned && goalResource !== null && cur.resourceKey !== goalResource);

      if (needsTarget || (st === ENTITY_STATE.idle && !cur.playerAssigned)) {
        const best = pickBestSurfaceDepositForUnit(state, colony, weights, cols.q[row], cols.r[row], id, assignments, occupied, goalResource);
        if (!best) {
          if (cur) { delete assignments[id]; changed = true; }
          if (st === ENTITY_STATE.harvesting) {
            setField(e, row, 'progress', 0, ctx.tick);
            setField(e, row, 'state', ENTITY_STATE.idle, ctx.tick);
          }
          continue;
        }
        if (!cur || cur.tileIdx !== best.tileIdx || cur.resourceKey !== best.resourceKey) {
          cur = {
            entityId: id, mode: 'harvest', tileIdx: best.tileIdx, q: best.q, r: best.r,
            standQ: best.standQ, standR: best.standR,
            family: best.family, resourceKey: best.resourceKey, elapsedTicks: 0, requiredTicks: 0,
          };
          assignments[id] = cur;
          changed = true;
          setField(e, row, 'targetQ', best.q, ctx.tick);
          setField(e, row, 'targetR', best.r, ctx.tick);
        }
      }

      if (!cur) continue;
      const distToDep = hexDistance(cols.q[row], cols.r[row], cur.q, cur.r);
      const fracDist = hexDistance(cols.x[row], cols.y[row], cols.q[row], cols.r[row]);
      // A building placed over its stand tile (construction evacuates it) sends it to another free side of the deposit.
      const standBuiltOver = occupied.has(hexIndex(state.grid.radius).indexOf(cols.q[row], cols.r[row]));
      if (distToDep === 1 && fracDist <= 0.15 && !standBuiltOver) {
        cancelMove(state, id, ctx.tick);
        faceTowards(state, row, cur.q, cur.r, ctx.tick);
        if (cols.targetQ[row] !== cur.q) setField(e, row, 'targetQ', cur.q, ctx.tick);
        if (cols.targetR[row] !== cur.r) setField(e, row, 'targetR', cur.r, ctx.tick);
        if (st !== ENTITY_STATE.harvesting) setField(e, row, 'state', ENTITY_STATE.harvesting, ctx.tick);
      } else {
        const stand = pickFreeAdjacentDepositHex(state, cur.q, cur.r, id, cols.q[row], cols.r[row], assignments, occupied);
        if (!stand) {
          delete assignments[id];
          changed = true;
          setField(e, row, 'state', ENTITY_STATE.idle, ctx.tick);
          continue;
        }
        if (cur.standQ !== stand.q || cur.standR !== stand.r) {
          cur.standQ = stand.q;
          cur.standR = stand.r;
          changed = true;
        }
        if (st !== ENTITY_STATE.moving) setField(e, row, 'state', ENTITY_STATE.moving, ctx.tick);
        requestMove(state, row, { q: stand.q, r: stand.r, minDist: 0, maxDist: 0 }, ctx);
      }
    }

    if (changed) saveHarvestBlob(state, rawBlob.weightsByColony ?? {}, assignments, ctx.tick);
  },
});

/** Completes a Worker's Clear / Break / Work sub-job: the tile becomes Flat and pays THE terraform yield (`opsBasic`). */
function completeWorkerWorkJob(
  state: PlanetState,
  colony: ColonyWithLedger,
  cur: WorkerTargetAssignment,
  tick: number,
  data?: CompiledDataLike,
): void {
  const prevTerrain = state.grid.layers.terrain[cur.tileIdx];
  setTileTerrain(state, cur.tileIdx, TERRAIN.flat, tick);
  setTilePrep(state, cur.tileIdx, cur.mode === 'work' ? PREP.prepared : PREP.flat, tick);
  const yields =
    cur.mode === 'clear' ? terraformYields('clear', data)
    : cur.mode === 'break' ? terraformYields('break', data)
    : groundWorkYields(prevTerrain === TERRAIN.forest ? 'forest' : prevTerrain === TERRAIN.rock ? 'rock' : 'flat', data);
  for (const [k, v] of Object.entries(yields) as [ResourceKey, number][]) if (v > 0) creditResource(colony, k, v, tick);
}

const standingHarvestYieldSystem = defineSystem({
  id: 'production.harvest',
  slot: 8,
  wave: 'W02',
  run(state, ctx) {
    const e = state.entities, cols = e.cols;
    const rawBlob = (state.blobs.harvest?.value as { weightsByColony?: Record<number, HarvestWeights>; assignments?: Record<number, WorkerTargetAssignment> } | undefined) ?? {};
    const assignments = { ...(rawBlob.assignments ?? {}) };
    let changed = false;

    for (const c of state.colonies) {
      if (!c) continue;
      const col = ensureColony(state, c.index, ctx.tick);
      col.production.incomePerS['minerals.t1'] = 0;
      col.production.incomePerS['bio.biomass'] = 0;
      col.production.incomePerS['bio.water'] = 0;
      for (const k of TIERED_HARVEST_KEYS) col.production.incomePerS[k] = 0; // tier 2/3 deposits (`depositTier`)
      col.production.familyIncomePerS.minerals = 0;
      col.production.familyIncomePerS.bio = 0;
    }

    for (let row = 0; row < e.count; row++) {
      if (!isWorker(cols.kind[row]) || cols.hp[row] <= 0) continue;
      const id = cols.id[row], owner = cols.owner[row];
      const cur = assignments[id];

      if (cur && (cur.mode === 'clear' || cur.mode === 'break' || cur.mode === 'work') && hexDistance(cols.q[row], cols.r[row], cur.q, cur.r) <= 1) {
        cur.elapsedTicks += ctx.dt;
        changed = true;
        const prog = Math.min(1, cur.elapsedTicks / Math.max(1, cur.requiredTicks));
        setField(e, row, 'progress', Math.fround(prog), ctx.tick);
        setField(e, row, 'state', ENTITY_STATE.working, ctx.tick);
        faceTowards(state, row, cur.q, cur.r, ctx.tick);
        if (cur.elapsedTicks >= cur.requiredTicks) {
          const colony = ensureColony(state, owner, ctx.tick);
          completeWorkerWorkJob(state, colony, cur, ctx.tick, ctx.data);
          delete assignments[id];
          setField(e, row, 'progress', 0, ctx.tick);
          setField(e, row, 'state', ENTITY_STATE.idle, ctx.tick);
        }
        syncHarvestWorkerView(state, row, ctx.tick, ctx.data);
        continue;
      }

      const distToDep = cur ? hexDistance(cols.q[row], cols.r[row], cur.q, cur.r) : Infinity;
      const fracDist = hexDistance(cols.x[row], cols.y[row], cols.q[row], cols.r[row]);
      if (cols.state[row] === ENTITY_STATE.idle && cur?.mode === 'harvest' && distToDep <= 1 && fracDist <= 0.15) {
        faceTowards(state, row, cur.q, cur.r, ctx.tick);
        setField(e, row, 'state', ENTITY_STATE.harvesting, ctx.tick);
      }

      if (cols.state[row] === ENTITY_STATE.harvesting && cur?.mode === 'harvest' && cur.resourceKey && distToDep <= 1) {
        const rawRich = Number(state.grid.layers.richness?.[cur.tileIdx] ?? 10000);
        if (rawRich <= 0) {
          delete assignments[id];
          changed = true;
          setField(e, row, 'progress', 0, ctx.tick);
          setField(e, row, 'state', ENTITY_STATE.idle, ctx.tick);
          syncHarvestWorkerView(state, row, ctx.tick, ctx.data);
          continue;
        }
        const colony = ensureColony(state, owner, ctx.tick);
        const fam = RESOURCE_FAMILY_OF[cur.resourceKey];
        if (!isFamilyAtCap(colony, fam)) {
          cur.elapsedTicks = (cur.elapsedTicks ?? 0) + ctx.dt;
          changed = true;
          const cycleProg = ((cur.elapsedTicks - 1) % HARVEST_CYCLE_TICKS + 1) / HARVEST_CYCLE_TICKS;
          setField(e, row, 'progress', Math.fround(cycleProg), ctx.tick);
          faceTowards(state, row, cur.q, cur.r, ctx.tick);
          const ratePerS = harvestRateForWorker(cols.tier[row] || 1, ctx.data);
          const desiredAmount = (ratePerS * TICK_MS * ctx.dt) / 1000;
          const actualAmount = consumeDepositRichness(state, cur.tileIdx, desiredAmount, ctx.tick);
          if (actualAmount > 0) {
            creditResource(colony, cur.resourceKey, actualAmount, ctx.tick);
            colony.production.incomePerS[cur.resourceKey] = Number(
              ((colony.production.incomePerS[cur.resourceKey] ?? 0) + ratePerS).toFixed(4),
            );
            colony.production.familyIncomePerS[fam] = Number(
              ((colony.production.familyIncomePerS[fam] ?? 0) + ratePerS).toFixed(4),
            );
          }
          if (Number(state.grid.layers.richness?.[cur.tileIdx] ?? 0) <= 0) {
            delete assignments[id];
            setField(e, row, 'progress', 0, ctx.tick);
            setField(e, row, 'state', ENTITY_STATE.idle, ctx.tick);
          }
        } else {
          setField(e, row, 'progress', 0, ctx.tick);
          setField(e, row, 'state', ENTITY_STATE.idle, ctx.tick);
        }
      } else if (cols.state[row] !== ENTITY_STATE.working && cols.progress[row] !== 0) {
        setField(e, row, 'progress', 0, ctx.tick);
      }
      syncHarvestWorkerView(state, row, ctx.tick, ctx.data);
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
