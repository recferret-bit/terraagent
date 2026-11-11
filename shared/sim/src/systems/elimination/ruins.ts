import { syncAtlasColonySectorState } from '../../atlas/sectorMetrics';
import { ENTITY_STATE } from '../../ecs/columns';
import { removeRow, rowOf, setField } from '../../ecs/store';
import { PREP } from '../../grid/layers';
import { bumpPathEpoch, setTileOwner, setTilePrep } from '../../grid/tileModel';
import { ensureColonyRecord } from '../../kernel/colonies';
import type { CompiledDataLike } from '../../kernel/config';
import { TICKS_PER_SECOND } from '../../kernel/constants';
import type { StepContext } from '../../kernel/context';
import { touchTile, type PlanetState } from '../../kernel/state';
import { UnitBook } from '../../units/book';
import { cancelMove } from '../../units/movement/orchestrator';
import { isFaunaHiveKind, type ApplyDamageOptions } from '../combat/damage';
import { OCCUPYING_BUILDING_KINDS } from '../construction/placement';
import { cancelColonyTrucesOnElimination } from '../diplomacy/operations';
import { resolveColonyIdStr } from '../diplomacy/store';
import { getBuildingJobs, saveBuildingJobs } from '../economy/buildJob';
import { getFootprintTileIndices } from '../economy/buildingRows';
import { colonyWho } from '../find';
import { clearColonyGoals } from '../goals';
import { cancelQueueTask } from '../queue';
import { cancelWorkerJobs } from '../terraform-basic/workJobs';
import { clearColonyCriticalOnHubRebuilt } from './critical';
import { clearColonyHqView } from './operations';
import {
  anchorRevertGraceTicks,
  colonyHasAliveHub,
  ensureColonyEliminationRecord,
  getEliminationStore,
  ruinDecayRatioPerTick,
  saveEliminationStore,
  type EliminationStore,
} from './store';

export type EliminationCause = 'both_lost' | 'timer' | 'hq_lost' | 'raid' | 'other';

function convertColonyEntitiesToRuins(
  state: PlanetState,
  store: EliminationStore,
  colonyIndex: number,
  tick: number,
): number {
  const jobs = getBuildingJobs(state);
  let jobsChanged = false;
  const book = new UnitBook(state);
  let bookChanged = false;
  let ruinCount = 0;

  const toRemove: number[] = [];
  const { count, cols } = state.entities;
  for (let row = 0; row < count; row++) {
    if (cols.owner[row] !== colonyIndex || cols.hp[row] <= 0) continue;
    const entityId = cols.id[row];
    const kind = cols.kind[row];

    if (OCCUPYING_BUILDING_KINDS.has(kind) && !isFaunaHiveKind(kind)) {
      if (jobs[entityId]) {
        delete jobs[entityId];
        jobsChanged = true;
      }
      setField(state.entities, row, 'owner', -1, tick);
      setField(state.entities, row, 'state', ENTITY_STATE.inert, tick);
      store.ruins[entityId] = {
        entityId,
        formerOwner: colonyIndex,
        createdAtTick: tick,
      };
      ruinCount++;
    } else {
      cancelMove(state, entityId, tick);
      cancelWorkerJobs(state, entityId, tick);
      book.remove(entityId);
      bookChanged = true;
      toRemove.push(entityId);
    }
  }

  if (jobsChanged) saveBuildingJobs(state, jobs, tick);
  if (bookChanged) book.flush(tick);
  for (const id of toRemove) {
    removeRow(state.entities, id, tick);
  }
  return ruinCount;
}

function startTerritoryRevertGrace(
  state: PlanetState,
  colonyIndex: number,
  revertDeadlineTick: number,
  graceSeconds: number,
  tick: number,
  ctx?: StepContext,
): number {
  const ownerLayer = state.grid.layers.owner as Int16Array;
  const graceLayer = state.grid.layers.graceUntil as Float64Array | undefined;
  let ownedTiles = 0;

  for (let i = 0; i < ownerLayer.length; i++) {
    if (ownerLayer[i] === colonyIndex) {
      ownedTiles++;
      if (graceLayer) {
        graceLayer[i] = revertDeadlineTick;
      }
      touchTile(state, i, tick);
    }
  }

  if (ownedTiles > 0 && ctx) {
    const { colonyIdStr, who } = colonyWho(state, colonyIndex);
    ctx.emit({
      kind: 'territoryReverting',
      severity: 'warn',
      colonyIds: [colonyIdStr],
      data: {
        ...who,
        colonyId: colonyIdStr,
        colonyIndex,
        tiles: ownedTiles,
        graceSeconds,
        reverted: false,
      },
    });
  }
  return ownedTiles;
}

export function revertEliminatedColonyAnchors(
  state: PlanetState,
  colonyIndex: number,
  tick: number,
  ctx?: StepContext,
): number {
  const ownerLayer = state.grid.layers.owner as Int16Array;
  const anchorsLayer = state.grid.layers.anchors as Uint8Array | undefined;
  const graceLayer = state.grid.layers.graceUntil as Float64Array | undefined;
  let revertedTiles = 0;

  for (let i = 0; i < ownerLayer.length; i++) {
    if (ownerLayer[i] === colonyIndex) {
      setTileOwner(state.grid, i, -1, tick);
      if (anchorsLayer) anchorsLayer[i] = 0;
      if (graceLayer) graceLayer[i] = 0;
      revertedTiles++;
    }
  }

  if (revertedTiles > 0) {
    syncAtlasColonySectorState(state, tick);
    if (ctx) {
      const { colonyIdStr, who } = colonyWho(state, colonyIndex);
      ctx.emit({
        kind: 'territoryReverting',
        severity: 'warn',
        colonyIds: [colonyIdStr],
        data: {
          ...who,
          colonyId: colonyIdStr,
          colonyIndex,
          tiles: revertedTiles,
          graceSeconds: 0,
          reverted: true,
        },
      });
    }
  }
  return revertedTiles;
}

export function eliminateColony(
  state: PlanetState,
  colonyIndex: number,
  cause: EliminationCause,
  tick: number,
  opts?: ApplyDamageOptions,
): void {
  if (colonyIndex < 0) return;
  const store = getEliminationStore(state);
  const rec = ensureColonyEliminationRecord(store, colonyIndex);
  const col = ensureColonyRecord(state, colonyIndex, tick);
  if (rec.eliminatedAtTick !== undefined || col.status === 'eliminated') return;

  const data = opts?.data ?? opts?.ctx?.data;
  const graceTicks = anchorRevertGraceTicks(data);
  const graceSeconds = Math.round(graceTicks / TICKS_PER_SECOND);

  rec.hqDown = true;
  rec.eliminatedAtTick = tick;
  delete rec.criticalDeadlineTick;
  delete rec.hqReprintTaskId;
  rec.anchorRevertDeadlineTick = tick + graceTicks;
  rec.revertedAnchors = false;

  const attackerOwner =
    opts?.attackerOwner !== undefined
      ? opts.attackerOwner
      : opts?.attackerId !== undefined && rowOf(state.entities, opts.attackerId) >= 0
        ? state.entities.cols.owner[rowOf(state.entities, opts.attackerId)]
        : undefined;
  if (typeof attackerOwner === 'number' && attackerOwner >= 0 && attackerOwner !== colonyIndex) {
    rec.eliminatedByColonyId = resolveColonyIdStr(state, attackerOwner);
  }

  col.status = 'eliminated';
  (col as Record<string, unknown>).hqDown = true;
  delete (col as Record<string, unknown>).criticalDeadlineTick;
  delete (col as Record<string, unknown>).hqReprintTaskId;
  delete col.hubEntityId;
  col.changedAt = tick;

  clearColonyHqView(state, colonyIndex, tick);
  cancelQueueTask(state, 'all', colonyIndex, tick, data);
  clearColonyGoals(state, colonyIndex, tick, data);
  cancelColonyTrucesOnElimination(state, colonyIndex, tick, opts?.ctx);

  convertColonyEntitiesToRuins(state, store, colonyIndex, tick);
  saveEliminationStore(state, store, tick);

  startTerritoryRevertGrace(state, colonyIndex, rec.anchorRevertDeadlineTick, graceSeconds, tick, opts?.ctx);
  syncAtlasColonySectorState(state, tick);

  if (opts?.ctx) {
    const { colonyIdStr, who } = colonyWho(state, colonyIndex);
    opts.ctx.emit({
      kind: 'colonyEliminated',
      severity: 'critical',
      colonyIds: rec.eliminatedByColonyId ? [colonyIdStr, rec.eliminatedByColonyId] : [colonyIdStr],
      data: {
        ...who,
        colonyIndex,
        cause,
        reason: cause,
        ...(rec.eliminatedByColonyId ? { byColony: rec.eliminatedByColonyId, killerColonyId: rec.eliminatedByColonyId } : {}),
      },
    });
  }
}

export function stepRuinsDecay(
  state: PlanetState,
  store: EliminationStore,
  dt: number,
  tick: number,
  data?: CompiledDataLike,
): boolean {
  const ratioPerTick = ruinDecayRatioPerTick(data);
  const cols = state.entities.cols;
  let storeChanged = false;
  let pathChanged = false;

  for (const entityIdStr of Object.keys(store.ruins)) {
    const entityId = Number(entityIdStr);
    const row = rowOf(state.entities, entityId);
    if (row < 0 || cols.hp[row] <= 0) {
      delete store.ruins[entityId];
      storeChanged = true;
      continue;
    }
    const hpMax = Math.max(1, cols.hpMax[row] > 0 ? cols.hpMax[row] : cols.hp[row]);
    const decay = Math.max(0.01, hpMax * ratioPerTick * dt);
    const nextHp = cols.hp[row] - decay;
    if (nextHp > 0) {
      setField(state.entities, row, 'hp', Math.fround(nextHp), tick);
    } else {
      const fw = cols.footprintW[row] || 2;
      const fd = cols.footprintD[row] || fw;
      const fp = getFootprintTileIndices(state, cols.q[row], cols.r[row], fw, fd, cols.rot[row]);
      for (const tileIdx of fp.indices) {
        setTilePrep(state.grid, tileIdx, PREP.prepared, tick);
        touchTile(state, tileIdx, tick);
      }
      removeRow(state.entities, entityId, tick);
      delete store.ruins[entityId];
      storeChanged = true;
      pathChanged = true;
    }
  }

  if (pathChanged) bumpPathEpoch(state.meta);
  return storeChanged;
}

export function stepEliminationAndRuins(state: PlanetState, ctx: StepContext): void {
  let store = getEliminationStore(state);
  let storeChanged = !state.blobs.elimination;

  for (const rec of Object.values(store.byColony)) {
    if (rec.criticalDeadlineTick !== undefined && rec.eliminatedAtTick === undefined) {
      if (colonyHasAliveHub(state, rec.colonyIndex)) {
        clearColonyCriticalOnHubRebuilt(state, rec.colonyIndex, ctx.tick, ctx);
        store = getEliminationStore(state);
      } else if (ctx.tick >= rec.criticalDeadlineTick) {
        eliminateColony(state, rec.colonyIndex, 'timer', ctx.tick, { ctx, data: ctx.data });
        store = getEliminationStore(state);
      }
    }
    const currentRec = store.byColony[rec.colonyIndex];
    if (
      currentRec?.anchorRevertDeadlineTick !== undefined &&
      !currentRec.revertedAnchors &&
      ctx.tick >= currentRec.anchorRevertDeadlineTick
    ) {
      revertEliminatedColonyAnchors(state, rec.colonyIndex, ctx.tick, ctx);
      currentRec.revertedAnchors = true;
      storeChanged = true;
    }
  }

  if (stepRuinsDecay(state, store, ctx.dt, ctx.tick, ctx.data)) {
    storeChanged = true;
  }

  if (storeChanged) {
    saveEliminationStore(state, store, ctx.tick);
  }
}
