import type { CompiledRow } from '../../data';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { rowOf, setField } from '../../ecs/store';
import { HEX_DIRS, hexDistance, hexIndex } from '../../grid/hex';
import { pathBlockersFor } from '../../grid/pathProfiles';
import { isGroundPassable } from '../../grid/tileModel';
import type { CompiledDataLike } from '../../kernel/config';
import { TICK_MS } from '../../kernel/constants';
import type { StepContext } from '../../kernel/context';
import { nextInt } from '../../kernel/rng';
import { setBlob, type PlanetState } from '../../kernel/state';
import { mobileStats } from '../../units/mobility';
import { getMotion, requestMove } from '../../units/movement/orchestrator';

export const COMBAT_EVASIVE_BLOB = 'combatEvasive';
export const EVASIVE_HEADING_INTERVAL_S = 0.5;

export interface EvasiveEntityState {
  lastHeadingTick: number;
  headingQ: number;
  headingR: number;
  prevQ: number;
  prevR: number;
  targetId: number;
}

export interface CombatEvasiveBlob {
  lastHeadingTickByEntity: Record<number, number>;
  headingQ: Record<number, number>;
  headingR: Record<number, number>;
  byEntityId: Record<number, EvasiveEntityState>;
}

function emptyEvasiveBlob(): CombatEvasiveBlob {
  return {
    lastHeadingTickByEntity: {},
    headingQ: {},
    headingR: {},
    byEntityId: {},
  };
}

function readEvasiveBlob(state: PlanetState): CombatEvasiveBlob {
  const raw = state.blobs[COMBAT_EVASIVE_BLOB]?.value as Partial<CombatEvasiveBlob> | undefined;
  if (!raw || typeof raw !== 'object') return emptyEvasiveBlob();
  return {
    lastHeadingTickByEntity: raw.lastHeadingTickByEntity ? { ...raw.lastHeadingTickByEntity } : {},
    headingQ: raw.headingQ ? { ...raw.headingQ } : {},
    headingR: raw.headingR ? { ...raw.headingR } : {},
    byEntityId: raw.byEntityId ? { ...raw.byEntityId } : {},
  };
}

function writeEvasiveBlob(state: PlanetState, blob: CombatEvasiveBlob, tick: number): void {
  const existing = state.blobs[COMBAT_EVASIVE_BLOB];
  if (existing) {
    existing.value = blob;
  } else {
    setBlob(state, COMBAT_EVASIVE_BLOB, blob, tick);
  }
}

/**
 * Returns the evasive heading re-pick interval in seconds (`combatUnits.recon.evasiveIntervalS ?? 0.5`).
 */
export function getEvasiveHeadingIntervalS(data?: CompiledDataLike): number {
  const combatUnits = data?.tables?.combatUnits as Record<string, CompiledRow | undefined> | undefined;
  const raw = Number(
    combatUnits?.recon?.evasiveIntervalS ??
      combatUnits?.combatConfig?.evasiveHeadingIntervalS ??
      EVASIVE_HEADING_INTERVAL_S,
  );
  return Number.isFinite(raw) && raw > 0 ? raw : EVASIVE_HEADING_INTERVAL_S;
}

/**
 * Returns `true` when entities of `kind` have `evasive: true` (`UO-C-09`, Recon Drone).
 */
export function isUnitEvasive(kind: number, data?: CompiledDataLike): boolean {
  if (kind !== ENTITY_KIND.recon) return false;
  const combatUnits = data?.tables?.combatUnits as Record<string, CompiledRow | undefined> | undefined;
  const reconRow = combatUnits?.recon;
  if (reconRow && 'evasive' in reconRow) {
    return Boolean(reconRow.evasive);
  }
  return true;
}

/**
 * Reads the stored evasive state for `entityId` from `state.blobs.combatEvasive`, or `null` if none.
 */
export function getEvasiveState(state: PlanetState, entityId: number): EvasiveEntityState | null {
  return readEvasiveBlob(state).byEntityId[entityId] ?? null;
}

/**
 * Clears stored evasive cadence state for `entityId` from `state.blobs.combatEvasive`.
 */
export function clearEvasiveState(state: PlanetState, entityId: number, tick = state.meta.tick): void {
  const blob = readEvasiveBlob(state);
  if (!(entityId in blob.byEntityId) && !(entityId in blob.lastHeadingTickByEntity)) return;
  delete blob.byEntityId[entityId];
  delete blob.lastHeadingTickByEntity[entityId];
  delete blob.headingQ[entityId];
  delete blob.headingR[entityId];
  writeEvasiveBlob(state, blob, tick);
}

interface CandidateHex {
  q: number;
  r: number;
  distFromUnit: number;
  distToTarget: number;
  contDistFromUnit: number;
}

function isStepReachable(
  state: PlanetState,
  uq: number,
  ur: number,
  cq: number,
  cr: number,
  distFromUnit: number,
  blocked: ((tileIdx: number) => boolean) | undefined,
  data?: CompiledDataLike,
): boolean {
  if (distFromUnit <= 1) return true;
  const idx = hexIndex(state.grid.radius);
  for (const [dq, dr] of HEX_DIRS) {
    const mq = uq + dq;
    const mr = ur + dr;
    if (hexDistance(mq, mr, cq, cr) !== 1) continue;
    const midIdx = idx.indexOf(mq, mr);
    if (midIdx < 0) continue;
    if (!isGroundPassable(state.grid, midIdx, data)) continue;
    if (blocked?.(midIdx)) continue;
    return true;
  }
  return false;
}

function collectCandidateHexes(
  state: PlanetState,
  unitRow: number,
  targetRow: number,
  weaponRange: number,
  data?: CompiledDataLike,
): CandidateHex[] {
  const cols = state.entities.cols;
  const uq = cols.q[unitRow]!;
  const ur = cols.r[unitRow]!;
  const ux = cols.x[unitRow]!;
  const uy = cols.y[unitRow]!;
  const tq = cols.q[targetRow]!;
  const tr = cols.r[targetRow]!;
  const maxRange = Math.max(1, weaponRange);

  const idx = hexIndex(state.grid.radius);
  const fromIdx = idx.indexOf(uq, ur);
  const profile = (data ? mobileStats(cols.kind[unitRow]!, data)?.profile : undefined) ?? 'none';
  const blockers = pathBlockersFor(state, profile, fromIdx, data);

  const candidates: CandidateHex[] = [];
  for (let dr = -2; dr <= 2; dr++) {
    const dqMin = Math.max(-2, -dr - 2);
    const dqMax = Math.min(2, -dr + 2);
    for (let dq = dqMin; dq <= dqMax; dq++) {
      if (dq === 0 && dr === 0) continue;
      const cq = uq + dq;
      const cr = ur + dr;
      const distFromUnit = hexDistance(uq, ur, cq, cr);
      if (distFromUnit < 1 || distFromUnit > 2) continue;

      const tileIdx = idx.indexOf(cq, cr);
      if (tileIdx < 0) continue;
      if (!isGroundPassable(state.grid, tileIdx, data)) continue;
      if (blockers?.goalBlocked(tileIdx)) continue;

      const distToTarget = hexDistance(cq, cr, tq, tr);
      if (distToTarget > maxRange) continue;
      if (!isStepReachable(state, uq, ur, cq, cr, distFromUnit, blockers?.blocked, data)) continue;

      candidates.push({
        q: cq,
        r: cr,
        distFromUnit,
        distToTarget,
        contDistFromUnit: hexDistance(ux, uy, cq, cr),
      });
    }
  }
  return candidates;
}

/**
 * Picks a deterministic evasive destination tile around `unitRow` (`distance 1..2`, excluding current `(q, r)`)
 * that stays within `weaponRange` of `targetRow`, drawing from `rngStream` (`combat` PRNG stream).
 */
export function pickEvasiveDestination(
  state: PlanetState,
  unitRow: number,
  targetRow: number,
  weaponRange: number,
  rngStream: Uint32Array,
  data?: CompiledDataLike,
): { q: number; r: number } | null {
  if (
    unitRow < 0 ||
    unitRow >= state.entities.count ||
    targetRow < 0 ||
    targetRow >= state.entities.count
  ) {
    return null;
  }

  const all = collectCandidateHexes(state, unitRow, targetRow, weaponRange, data);
  if (all.length === 0) return null;

  const cols = state.entities.cols;
  const entityId = cols.id[unitRow]!;
  const tq = cols.q[targetRow]!;
  const tr = cols.r[targetRow]!;
  const maxRange = Math.max(1, weaponRange);
  const prev = readEvasiveBlob(state).byEntityId[entityId];

  let pool = all;

  const offTarget = pool.filter((c) => c.q !== tq || c.r !== tr);
  if (offTarget.length > 0) pool = offTarget;

  const dist2 = pool.filter((c) => c.distFromUnit === 2);
  if (dist2.length > 0) pool = dist2;

  const minSkirmishDist = Math.max(1, maxRange - 2);
  const skirmishBand = pool.filter((c) => c.distToTarget >= minSkirmishDist);
  if (skirmishBand.length > 0) pool = skirmishBand;

  const fullStride = pool.filter((c) => c.contDistFromUnit >= 1.7);
  if (fullStride.length > 0) pool = fullStride;

  if (prev) {
    const diffHeading = pool.filter((c) => c.q !== prev.headingQ || c.r !== prev.headingR);
    if (diffHeading.length > 0) pool = diffHeading;

    const noBacktrack = pool.filter((c) => hexDistance(c.q, c.r, prev.prevQ, prev.prevR) >= 2);
    if (noBacktrack.length > 0) pool = noBacktrack;
  }

  const choiceIdx = nextInt(rngStream, 0, pool.length - 1);
  const chosen = pool[choiceIdx]!;
  return { q: chosen.q, r: chosen.r };
}

function shouldPickNewHeading(
  tick: number,
  prev: EvasiveEntityState | undefined,
  targetId: number,
  intervalS: number,
): boolean {
  if (!prev) return true;
  if (prev.targetId !== targetId) return true;
  const intervalMs = Math.max(TICK_MS, intervalS * 1000);
  const curBucket = Math.floor((tick * TICK_MS) / intervalMs);
  const prevBucket = Math.floor((prev.lastHeadingTick * TICK_MS) / intervalMs);
  return curBucket !== prevBucket;
}

/**
 * Steps an evasive unit (`isUnitEvasive`) while engaging `targetId`:
 * - Every `0.5 s` (`2.5` ticks at 5 Hz -> `2` or `3` ticks), draws a new destination within `weaponRange` of `targetId`
 *   using the `combat` PRNG stream (`pickEvasiveDestination`) and issues `requestMove` via the movement orchestrator (`SIM-M-01`).
 * - Returns `true` when a new evasive heading was picked on this tick, or `false` otherwise.
 */
export function stepEvasiveUnit(
  state: PlanetState,
  unitRow: number,
  targetId: number,
  ctx: StepContext,
  weaponRange = 5,
): boolean {
  if (unitRow < 0 || unitRow >= state.entities.count) return false;
  const cols = state.entities.cols;
  if (cols.hp[unitRow]! <= 0) return false;
  if (!isUnitEvasive(cols.kind[unitRow]!, ctx.data)) return false;

  const targetRow = rowOf(state.entities, targetId);
  if (targetRow < 0 || cols.hp[targetRow]! <= 0) return false;

  const entityId = cols.id[unitRow]!;
  const blob = readEvasiveBlob(state);
  const prev = blob.byEntityId[entityId];
  const intervalS = getEvasiveHeadingIntervalS(ctx.data);
  const tick = ctx.tick;

  if (!shouldPickNewHeading(tick, prev, targetId, intervalS)) {
    const motion = getMotion(state, entityId);
    if (!motion || motion.status === 'failed') {
      requestMove(state, unitRow, { q: prev!.headingQ, r: prev!.headingR, minDist: 0, maxDist: 0 }, ctx);
    }
    return false;
  }

  const rngStream = ctx.rng ? ctx.rng('combat') : state.rng.combat;
  const dest = pickEvasiveDestination(state, unitRow, targetRow, weaponRange, rngStream, ctx.data);
  if (!dest) return false;

  const nextState: EvasiveEntityState = {
    lastHeadingTick: tick,
    headingQ: dest.q,
    headingR: dest.r,
    prevQ: cols.q[unitRow]!,
    prevR: cols.r[unitRow]!,
    targetId,
  };
  blob.byEntityId[entityId] = nextState;
  blob.lastHeadingTickByEntity[entityId] = tick;
  blob.headingQ[entityId] = dest.q;
  blob.headingR[entityId] = dest.r;
  writeEvasiveBlob(state, blob, tick);

  setField(state.entities, unitRow, 'state', ENTITY_STATE.moving, tick);
  setField(state.entities, unitRow, 'targetQ', dest.q, tick);
  setField(state.entities, unitRow, 'targetR', dest.r, tick);
  requestMove(state, unitRow, { q: dest.q, r: dest.r, minDist: 0, maxDist: 0 }, ctx);
  return true;
}
