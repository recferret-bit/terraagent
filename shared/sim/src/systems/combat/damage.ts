import { ENTITY_KIND } from '../../ecs/columns';
import { removeRow, rowOf, setField } from '../../ecs/store';
import { hexIndex } from '../../grid/hex';
import { PREP } from '../../grid/layers';
import { bumpPathEpoch, setTilePrep } from '../../grid/tileModel';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import { touchTile, type PlanetState } from '../../kernel/state';
import { UnitBook } from '../../units/book';
import { isUnitKind } from '../../units/mobility';
import { cancelMove } from '../../units/movement/orchestrator';
import { entityFootprint, getBuildingFootprintTiles } from '../construction/placement';
import { getBuildingJobs, saveBuildingJobs } from '../economy/buildJob';
import { getFootprintTileIndices } from '../economy/buildingRows';
import { syncColonyDepotCaps } from '../economy/ledger';
import { colonyWho } from '../find';
import { hasActiveTruce, recordHostilityBetween, resolveColonyIdStr } from '../diplomacy/store';
import { syncHqView } from '../hq/view';
import { syncColonyThreatStage } from '../progression/threatStage';
import { resolveHqT1Row, rowNum } from '../rows';
import { cancelWorkerJobs } from '../terraform-basic/workJobs';
import {
  clearEntityDamaged,
  clearWorkerDispatch,
  getLastDamagedTick,
  hqRetreatHpRatio,
  hqSelfRepairPctPerS,
  recordEntityDamaged,
  retreatHqToSafety,
  stepHqCombatSurvival,
  stepHqSelfRepair,
} from './hqSurvival';
import {
  emitUnderAttackIfDue,
  noteColonyBuildingDestroyedDuringRaid,
} from './events';
import { isCombatDryFire } from './firingRange';

export * from './events';

export {
  getLastDamagedTick,
  hqRetreatHpRatio,
  hqSelfRepairPctPerS,
  retreatHqToSafety,
  stepHqCombatSurvival,
  stepHqSelfRepair,
};

export interface ApplyDamageOptions {
  attackerId?: number;
  attackerOwner?: number;
  tick?: number;
  ctx?: StepContext;
  data?: CompiledDataLike;
}

export interface DamageResult {
  applied: number;
  hpAfter: number;
  destroyed: boolean;
  clampedHq: boolean;
  retreatedHq: boolean;
}

const KIND_NAMES: Readonly<Record<number, string>> = {
  [ENTITY_KIND.devProbe]: 'devProbe',
  [ENTITY_KIND.pod]: 'pod',
  [ENTITY_KIND.hq]: 'hq',
  [ENTITY_KIND.commandHub]: 'commandHub',
  [ENTITY_KIND.metalsExtractor]: 'metalsExtractor',
  [ENTITY_KIND.solar]: 'solar',
  [ENTITY_KIND.worker]: 'worker',
  [ENTITY_KIND.tradeHub]: 'tradeHub',
  [ENTITY_KIND.pylon]: 'pylon',
  [ENTITY_KIND.capacitor]: 'capacitor',
  [ENTITY_KIND.wind]: 'wind',
  [ENTITY_KIND.thermal]: 'thermal',
  [ENTITY_KIND.supplyDepot]: 'supplyDepot',
  [ENTITY_KIND.mineralsQuarry]: 'mineralsQuarry',
  [ENTITY_KIND.waterExtractor]: 'waterExtractor',
  [ENTITY_KIND.petroleumWell]: 'petroleumWell',
  [ENTITY_KIND.roboticsFactory]: 'roboticsFactory',
  [ENTITY_KIND.droneControlArray]: 'droneControlArray',
  [ENTITY_KIND.autocannon]: 'autocannon',
  [ENTITY_KIND.laserTower]: 'laserTower',
  [ENTITY_KIND.recon]: 'recon',
  [ENTITY_KIND.blackAnt]: 'blackAnt',
  [ENTITY_KIND.blueBeetle]: 'blueBeetle',
  [ENTITY_KIND.greenSpitter]: 'greenSpitter',
  [ENTITY_KIND.hiveBlackAnt]: 'hiveBlackAnt',
  [ENTITY_KIND.hiveBlueBeetle]: 'hiveBlueBeetle',
  [ENTITY_KIND.hiveGreenSpitter]: 'hiveGreenSpitter',
};

export function isFaunaBugKind(kind: number): boolean {
  return kind === ENTITY_KIND.blackAnt || kind === ENTITY_KIND.blueBeetle || kind === ENTITY_KIND.greenSpitter;
}

export function isFaunaHiveKind(kind: number): boolean {
  return kind === ENTITY_KIND.hiveBlackAnt || kind === ENTITY_KIND.hiveBlueBeetle || kind === ENTITY_KIND.hiveGreenSpitter;
}

export function getEntityKindName(kind: number): string {
  return KIND_NAMES[kind] ?? 'entity';
}

export function getHiveSpeciesName(kind: number): 'blackAnt' | 'blueBeetle' | 'greenSpitter' {
  if (kind === ENTITY_KIND.hiveBlueBeetle) return 'blueBeetle';
  if (kind === ENTITY_KIND.hiveGreenSpitter) return 'greenSpitter';
  return 'blackAnt';
}

const isCombatOrWorkerUnitKind = (kind: number): boolean =>
  isUnitKind(kind) || kind === ENTITY_KIND.recon || isFaunaBugKind(kind);

function defaultBuildingFootprint(kind: number, data?: CompiledDataLike): number {
  if (kind === ENTITY_KIND.commandHub || kind === ENTITY_KIND.roboticsFactory || kind === ENTITY_KIND.tradeHub) return 3;
  if (
    kind === ENTITY_KIND.pylon ||
    kind === ENTITY_KIND.droneControlArray ||
    kind === ENTITY_KIND.autocannon ||
    kind === ENTITY_KIND.laserTower ||
    kind === ENTITY_KIND.pod ||
    kind === ENTITY_KIND.devProbe
  ) {
    return 1;
  }
  if (isFaunaHiveKind(kind)) return 2;
  return Math.max(2, entityFootprint(kind, data));
}

function resolveEntityFootprintIndices(state: PlanetState, row: number, data?: CompiledDataLike): number[] {
  const cols = state.entities.cols;
  const kind = cols.kind[row];
  const baseFp = defaultBuildingFootprint(kind, data);
  const fw = cols.footprintW[row] > 0 ? cols.footprintW[row] : baseFp;
  const fd = cols.footprintD[row] > 0 ? cols.footprintD[row] : fw;
  const fp = getFootprintTileIndices(state, cols.q[row], cols.r[row], fw, fd, cols.rot[row]);
  if (fp.indices.length > 0) return fp.indices;
  const idx = hexIndex(state.grid.radius);
  return getBuildingFootprintTiles(cols.q[row], cols.r[row], fw)
    .map((t) => idx.indexOf(t.q, t.r))
    .filter((i) => i >= 0);
}

function emitUnitDestructionEvent(
  state: PlanetState,
  targetId: number,
  kind: number,
  owner: number,
  q: number,
  r: number,
  opts?: ApplyDamageOptions,
): void {
  if (!opts?.ctx) return;
  if (isFaunaBugKind(kind)) {
    const colonyIdx = Math.max(0, opts.attackerOwner ?? 0);
    const { colonyIdStr, who } = colonyWho(state, colonyIdx);
    opts.ctx.emit({
      kind: 'faunaKilled',
      severity: 'info',
      colonyIds: [colonyIdStr],
      data: {
        ...who,
        colonyIndex: colonyIdx,
        entityId: targetId,
        species: getEntityKindName(kind),
        q,
        r,
        count: 1,
        ...(opts.attackerId !== undefined ? { attackerId: opts.attackerId } : {}),
      },
    });
    return;
  }
  const colonyIdx = Math.max(0, owner);
  const { colonyIdStr, who } = colonyWho(state, colonyIdx);
  const attackerColony =
    opts?.attackerOwner !== undefined
      ? opts.attackerOwner
      : opts?.attackerId !== undefined && rowOf(state.entities, opts.attackerId) >= 0
        ? state.entities.cols.owner[rowOf(state.entities, opts.attackerId)]
        : undefined;
  const isPvpKill =
    typeof attackerColony === 'number' && attackerColony >= 0 && attackerColony !== colonyIdx;
  const killerColonyId = isPvpKill ? resolveColonyIdStr(state, attackerColony) : undefined;
  opts.ctx.emit({
    kind: 'unitDestroyed',
    severity: 'warn',
    colonyIds: killerColonyId ? [colonyIdStr, killerColonyId] : [colonyIdStr],
    data: {
      ...who,
      colonyIndex: colonyIdx,
      entityId: targetId,
      unit: getEntityKindName(kind),
      kind,
      q,
      r,
      ...(opts.attackerId !== undefined ? { attackerId: opts.attackerId } : {}),
      ...(isPvpKill
        ? {
            pvp: true,
            killerOwner: attackerColony,
            killerColonyId,
            byColony: killerColonyId,
          }
        : {}),
    },
  });
}

function handleUnitDestruction(
  state: PlanetState,
  row: number,
  targetId: number,
  prevHp: number,
  tick: number,
  opts?: ApplyDamageOptions,
): DamageResult {
  const cols = state.entities.cols;
  const kind = cols.kind[row];
  const owner = cols.owner[row];
  const q = cols.q[row];
  const r = cols.r[row];

  cancelMove(state, targetId, tick);
  cancelWorkerJobs(state, targetId, tick);
  clearWorkerDispatch(state, targetId, tick);
  clearEntityDamaged(state, targetId, tick);

  const book = new UnitBook(state);
  book.remove(targetId);
  book.flush(tick);

  emitUnitDestructionEvent(state, targetId, kind, owner, q, r, opts);
  removeRow(state.entities, targetId, tick);
  return { applied: Math.max(0, prevHp), hpAfter: 0, destroyed: true, clampedHq: false, retreatedHq: false };
}

function emitBuildingDestructionEvent(
  state: PlanetState,
  targetId: number,
  kind: number,
  owner: number,
  q: number,
  r: number,
  opts?: ApplyDamageOptions,
): void {
  if (!opts?.ctx) return;
  if (isFaunaHiveKind(kind)) {
    const colonyIdx = Math.max(0, opts.attackerOwner ?? 0);
    const { colonyIdStr, who } = colonyWho(state, colonyIdx);
    opts.ctx.emit({
      kind: 'nestDestroyed',
      severity: 'info',
      colonyIds: [colonyIdStr],
      data: {
        ...who,
        colonyIndex: colonyIdx,
        hiveId: targetId,
        entityId: targetId,
        species: getHiveSpeciesName(kind),
        q,
        r,
        count: 1,
        ...(opts.attackerId !== undefined ? { attackerId: opts.attackerId } : {}),
      },
    });
    return;
  }
  const colonyIdx = Math.max(0, owner);
  const { colonyIdStr, who } = colonyWho(state, colonyIdx);
  opts.ctx.emit({
    kind: 'buildingDestroyed',
    severity: 'critical',
    colonyIds: [colonyIdStr],
    data: {
      ...who,
      colonyIndex: colonyIdx,
      entityId: targetId,
      building: getEntityKindName(kind),
      kind,
      q,
      r,
      ...(opts.attackerId !== undefined ? { attackerId: opts.attackerId } : {}),
    },
  });
}

function handleBuildingDestruction(
  state: PlanetState,
  row: number,
  targetId: number,
  prevHp: number,
  tick: number,
  opts?: ApplyDamageOptions,
): DamageResult {
  const cols = state.entities.cols;
  const kind = cols.kind[row];
  const owner = cols.owner[row];
  const q = cols.q[row];
  const r = cols.r[row];
  const data = opts?.data ?? opts?.ctx?.data;

  const tileIndices = resolveEntityFootprintIndices(state, row, data);
  if (owner >= 0 && !isFaunaHiveKind(kind)) {
    for (const tileIdx of tileIndices) {
      setTilePrep(state.grid, tileIdx, PREP.prepared, tick);
      touchTile(state, tileIdx, tick);
    }
  }
  if (owner >= 0) {
    noteColonyBuildingDestroyedDuringRaid(state, owner, tick);
  }

  const jobs = getBuildingJobs(state);
  if (jobs[targetId]) {
    delete jobs[targetId];
    saveBuildingJobs(state, jobs, tick);
  }
  if (owner >= 0 && state.colonies[owner]?.hubEntityId === targetId) {
    delete state.colonies[owner].hubEntityId;
  }
  clearEntityDamaged(state, targetId, tick);

  emitBuildingDestructionEvent(state, targetId, kind, owner, q, r, opts);

  const wasSupplyDepot = kind === ENTITY_KIND.supplyDepot;
  removeRow(state.entities, targetId, tick);
  bumpPathEpoch(state.meta);
  if (owner >= 0 && state.colonies[owner]) {
    if (wasSupplyDepot) syncColonyDepotCaps(state, owner, tick);
    syncColonyThreatStage(state, owner, tick);
  }

  return { applied: Math.max(0, prevHp), hpAfter: 0, destroyed: true, clampedHq: false, retreatedHq: false };
}

function isHostileDamage(state: PlanetState, targetOwner: number, opts?: ApplyDamageOptions): boolean {
  if (targetOwner < 0) return false;
  if (opts?.attackerOwner !== undefined) {
    return opts.attackerOwner !== targetOwner;
  }
  if (opts?.attackerId !== undefined) {
    const aRow = rowOf(state.entities, opts.attackerId);
    if (aRow < 0) return false;
    return state.entities.cols.owner[aRow] !== targetOwner;
  }
  return true;
}

/**
 * Returns `true` when `owner` is a colony index (`>= 0`) with `godMode` active
 * in `state.blobs.godMode.byColony[owner]` or `state.colonies[owner].godMode`.
 */
export function isColonyGodMode(state: PlanetState, owner: number): boolean {
  if (owner < 0) return false;
  if ((state.colonies[owner] as { godMode?: boolean } | undefined)?.godMode === true) {
    return true;
  }
  const rawBlob = (state.blobs.godMode?.value ?? state.blobs.godMode) as
    | { byColony?: Record<number, boolean> }
    | undefined;
  return rawBlob?.byColony?.[owner] === true;
}

/**
 * Applies plain battle v1 damage to `targetId` (`UO-C`, `UO-TF-04`, `UO-HQ-03`):
 * - Non-HQ units at `<= 0` HP are removed and emit `unitDestroyed` / `faunaKilled`.
 * - Buildings at `<= 0` HP are removed, leave all footprint tiles `PREP.prepared` (`UO-TF-04`), and emit `buildingDestroyed` / `nestDestroyed`.
 * - HQ never dies (`hp` clamped at `1`, `UO-HQ-03`); below 40% HP it drops work orders and retreats toward the nearest Hub/pod.
 */
export function applyDamage(
  state: PlanetState,
  targetId: number,
  amount: number,
  opts?: ApplyDamageOptions,
): DamageResult {
  const row = rowOf(state.entities, targetId);
  if (row < 0 || amount <= 0) {
    return { applied: 0, hpAfter: row >= 0 ? state.entities.cols.hp[row] : 0, destroyed: false, clampedHq: false, retreatedHq: false };
  }

  const cols = state.entities.cols;
  const owner = cols.owner[row];
  const tick = opts?.tick ?? opts?.ctx?.tick ?? state.meta.tick;
  const attackerOwner =
    opts?.attackerOwner !== undefined
      ? opts.attackerOwner
      : opts?.attackerId !== undefined && rowOf(state.entities, opts.attackerId) >= 0
        ? cols.owner[rowOf(state.entities, opts.attackerId)]
        : undefined;
  if (
    owner >= 0 &&
    typeof attackerOwner === 'number' &&
    attackerOwner >= 0 &&
    attackerOwner !== owner &&
    hasActiveTruce(state, attackerOwner, owner, tick)
  ) {
    return { applied: 0, hpAfter: cols.hp[row], destroyed: false, clampedHq: false, retreatedHq: false };
  }
  const rawDamage = isCombatDryFire(state) || (owner >= 0 && isColonyGodMode(state, owner)) ? 0 : amount;
  if (rawDamage <= 0) {
    return { applied: 0, hpAfter: cols.hp[row], destroyed: false, clampedHq: false, retreatedHq: false };
  }

  const data = opts?.data ?? opts?.ctx?.data;
  const kind = cols.kind[row];
  const q = cols.q[row];
  const r = cols.r[row];
  const prevHp = cols.hp[row];
  const rawHp = prevHp - amount;

  recordEntityDamaged(state, targetId, tick, opts?.attackerOwner, opts?.attackerId);

  let result: DamageResult;
  if (kind === ENTITY_KIND.hq) {
    const hpAfter = Math.fround(Math.max(1, rawHp));
    setField(state.entities, row, 'hp', hpAfter, tick);
    const hpMax = Math.max(1, cols.hpMax[row] > 0 ? cols.hpMax[row] : rowNum(resolveHqT1Row(data), 'hp'));
    let retreatedHq = false;
    if (hpAfter / hpMax < hqRetreatHpRatio(data)) {
      retreatedHq = retreatHqToSafety(state, row, tick, opts?.ctx);
    }
    syncHqView(state, row, tick, data);
    result = {
      applied: Math.max(0, prevHp - hpAfter),
      hpAfter,
      destroyed: false,
      clampedHq: rawHp <= 1,
      retreatedHq,
    };
  } else if (rawHp > 0) {
    const hpAfter = Math.fround(rawHp);
    setField(state.entities, row, 'hp', hpAfter, tick);
    result = { applied: prevHp - hpAfter, hpAfter, destroyed: false, clampedHq: false, retreatedHq: false };
  } else if (isCombatOrWorkerUnitKind(kind)) {
    result = handleUnitDestruction(state, row, targetId, prevHp, tick, opts);
  } else {
    result = handleBuildingDestruction(state, row, targetId, prevHp, tick, opts);
  }

  if (result.applied > 0 && owner >= 0 && isHostileDamage(state, owner, opts)) {
    if (typeof attackerOwner === 'number' && attackerOwner >= 0 && attackerOwner !== owner) {
      recordHostilityBetween(state, attackerOwner, owner, tick);
    }
    emitUnderAttackIfDue(state, owner, { targetId, attackerId: opts?.attackerId, q, r, tick }, opts?.ctx);
  }

  return result;
}
