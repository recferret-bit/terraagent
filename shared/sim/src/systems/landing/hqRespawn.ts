import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { placeSpawnedEntity } from '../../ecs/placement';
import { insertRow, removeRow } from '../../ecs/store';
import { hexDistance, hexIndex } from '../../grid/hex';
import { DEPOSIT, PREP, TERRAIN } from '../../grid/layers';
import { setTileDeposit, setTilePrep, setTileTerrain } from '../../grid/tileModel';
import { TICK_MS } from '../../kernel/constants';
import type { StepContext } from '../../kernel/context';
import { setBlob, touchTile, type PlanetState } from '../../kernel/state';
import { hqViewRadius, revealVision } from '../hq';
import { resolveStartingKitRow, rowNum } from '../rows';
import { footprintTilesOfEntity } from '../weather/types';
import { getLandingPods, resolveDescentTicks } from './index';

export const HQ_RESPAWN_BLOB_KEY = 'hqRespawn';
export const HQ_COLONY_TRACKER_BLOB_KEY = 'hqColonyTracker';
export const HQ_RESPAWN_COUNTDOWN_S = 30;
export const HQ_RESPAWN_TICKS = Math.round(HQ_RESPAWN_COUNTDOWN_S * (1000 / TICK_MS));
export const HQ_RESPAWN_DESCENT_TICKS = Math.max(1, Math.round(3.6 * (1000 / TICK_MS)));

export interface HqColonyTrackerEntry {
  deployed: boolean;
  lastQ: number;
  lastR: number;
}

export interface HqRespawnRecord {
  colonyId: number;
  deadAtTick: number;
  respawnAtTick: number;
  ticksRemaining: number;
  totalTicks: number;
  q: number;
  r: number;
  lastHqQ: number;
  lastHqR: number;
  emitted?: boolean;
}

/** Reads the persistent per-colony HQ deployment & last-known-position tracker (`state.blobs.hqColonyTracker`). */
export function getHqColonyTracker(state: PlanetState): Record<number, HqColonyTrackerEntry> {
  const rawBlob = state.blobs[HQ_COLONY_TRACKER_BLOB_KEY] as unknown;
  const raw = (rawBlob && typeof rawBlob === 'object' && 'value' in rawBlob
    ? (rawBlob as { value?: unknown }).value
    : rawBlob) as Record<number, HqColonyTrackerEntry> | undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<number, HqColonyTrackerEntry> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v && typeof v === 'object' && typeof v.deployed === 'boolean') {
      out[Number(k)] = {
        deployed: v.deployed,
        lastQ: typeof v.lastQ === 'number' ? v.lastQ : 0,
        lastR: typeof v.lastR === 'number' ? v.lastR : 0,
      };
    }
  }
  return out;
}

function saveHqColonyTracker(state: PlanetState, tracker: Record<number, HqColonyTrackerEntry>, tick: number): void {
  setBlob(state, HQ_COLONY_TRACKER_BLOB_KEY, tracker, tick);
}

/** Records that `colonyId` has deployed an HQ Explorer (and updates its last known hex coordinates). */
export function recordHqColonyDeployed(
  state: PlanetState,
  colonyId: number,
  q: number,
  r: number,
  tick = state.meta.tick,
  forcePos = false,
): void {
  const tracker = getHqColonyTracker(state);
  let targetQ = q, targetR = r;
  if (!forcePos) {
    const e = state.entities, cols = e.cols;
    for (let row = 0; row < e.count; row++) {
      if (cols.owner[row] === colonyId && cols.kind[row] === ENTITY_KIND.hq && cols.hp[row] > 0) {
        targetQ = cols.q[row];
        targetR = cols.r[row];
        break;
      }
    }
  }
  const existing = tracker[colonyId];
  if (!existing || !existing.deployed || (forcePos && (existing.lastQ !== targetQ || existing.lastR !== targetR))) {
    tracker[colonyId] = { deployed: true, lastQ: targetQ, lastR: targetR };
    saveHqColonyTracker(state, tracker, tick);
  }
}

/** Returns `true` when `colonyId` currently has an undeployed/descending drop pod. */
export function hasDescendingPod(state: PlanetState, colonyId: number): boolean {
  if (getLandingPods(state).some((p) => p.colonyId === colonyId && !p.deployed)) return true;
  const e = state.entities, cols = e.cols;
  for (let row = 0; row < e.count; row++) {
    if (cols.owner[row] === colonyId && cols.kind[row] === ENTITY_KIND.pod && cols.hp[row] > 0 && cols.state[row] === ENTITY_STATE.descending) {
      return true;
    }
  }
  return false;
}

/** Reads the active per-colony HQ respawn records (`state.blobs.hqRespawn`). */
export function getHqRespawns(state: PlanetState): Record<number, HqRespawnRecord> {
  const rawBlob = state.blobs[HQ_RESPAWN_BLOB_KEY] as unknown;
  const raw = (rawBlob && typeof rawBlob === 'object' && 'value' in rawBlob
    ? (rawBlob as { value?: unknown }).value
    : rawBlob) as Record<number, HqRespawnRecord> | undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<number, HqRespawnRecord> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v && typeof v === 'object' && typeof v.colonyId === 'number') out[Number(k)] = { ...v };
  }
  return out;
}

/** Reads the active HQ respawn record for `colonyId` (`0` by default), if any. */
export function getHqRespawn(state: PlanetState, colonyId = 0): HqRespawnRecord | undefined {
  return getHqRespawns(state)[colonyId];
}

function saveHqRespawns(state: PlanetState, map: Record<number, HqRespawnRecord>, tick: number): void {
  setBlob(state, HQ_RESPAWN_BLOB_KEY, map, tick);
}

/** Returns `true` when `colonyId` currently has a live `ENTITY_KIND.hq` unit on the planet. */
export function hasAliveHq(state: PlanetState, colonyId: number): boolean {
  const e = state.entities, cols = e.cols;
  for (let row = 0; row < e.count; row++) {
    if (cols.owner[row] === colonyId && cols.kind[row] === ENTITY_KIND.hq && cols.hp[row] > 0) {
      return true;
    }
  }
  return false;
}

function collectOccupiedTileIndices(state: PlanetState, colonyId: number): Set<number> {
  const hx = hexIndex(state.grid.radius);
  const occupied = new Set<number>();
  const e = state.entities, cols = e.cols;
  for (let row = 0; row < e.count; row++) {
    if (cols.hp[row] <= 0) continue;
    const kind = cols.kind[row];
    if ((kind === ENTITY_KIND.hq || kind === ENTITY_KIND.pod) && cols.owner[row] === colonyId) continue;
    for (const t of footprintTilesOfEntity(state, row)) {
      const idx = hx.indexOf(t.q, t.r);
      if (idx >= 0) occupied.add(idx);
    }
  }
  return occupied;
}

function isTerraformedPrep(prep: number): boolean {
  return prep === PREP.flat || prep === PREP.prepared || prep === PREP.irrigated || prep === PREP.living;
}

function isBlockedLandingTile(state: PlanetState, idx: number): boolean {
  const L = state.grid.layers;
  const terrain = L.terrain[idx], prep = L.prep[idx], deposit = L.deposit?.[idx] ?? DEPOSIT.none;
  return (
    terrain === TERRAIN.deep ||
    terrain === TERRAIN.shallow ||
    terrain === TERRAIN.hole ||
    terrain === TERRAIN.rock ||
    prep === PREP.ridge ||
    prep === PREP.moat ||
    deposit !== DEPOSIT.none
  );
}

export function isValidLandingCandidateTile(
  state: PlanetState,
  colonyId: number,
  q: number,
  r: number,
  occupied?: ReadonlySet<number>,
): boolean {
  const idx = hexIndex(state.grid.radius).indexOf(q, r);
  if (idx < 0) return false;
  const occ = occupied ?? collectOccupiedTileIndices(state, colonyId);
  return !occ.has(idx) && !isBlockedLandingTile(state, idx);
}

/**
 * Finds the closest terraformed ground tile to `(refQ, refR)` for replacement pod landing.
 * Priority 1: closest valid unobstructed tile with `terrain === TERRAIN.flat` and terraformed `prep`
 * (`PREP.flat | PREP.prepared | PREP.irrigated | PREP.living`).
 * Priority 2 (fallback if all terraformed ground was destroyed): closest passable non-hole, non-water tile, prepared flat.
 */
export function findClosestTerraformedLandingTile(
  state: PlanetState,
  colonyId: number,
  refQ: number,
  refR: number,
  tick = state.meta.tick,
): { q: number; r: number } {
  const hx = hexIndex(state.grid.radius);
  const L = state.grid.layers;
  const occupied = collectOccupiedTileIndices(state, colonyId);
  let bestTf: { q: number; r: number; idx: number; score: number } | null = null;
  let bestFallback: { q: number; r: number; idx: number; score: number } | null = null;

  for (let idx = 0; idx < state.grid.count; idx++) {
    if (occupied.has(idx) || isBlockedLandingTile(state, idx)) continue;
    const terrain = L.terrain[idx], prep = L.prep[idx];
    const q = hx.q[idx]!, r = hx.r[idx]!;
    const dist = hexDistance(refQ, refR, q, r);
    const ownerBonus = (L.owner?.[idx] ?? -1) === colonyId ? 0.15 : 0;

    if (terrain === TERRAIN.flat && isTerraformedPrep(prep)) {
      const prepBonus = prep >= PREP.prepared && prep <= PREP.living ? 0.05 : 0;
      const score = dist - ownerBonus - prepBonus;
      if (!bestTf || score < bestTf.score) bestTf = { q, r, idx, score };
    } else {
      const score = dist + (terrain === TERRAIN.flat ? 0 : 0.35) - ownerBonus;
      if (!bestFallback || score < bestFallback.score) bestFallback = { q, r, idx, score };
    }
  }

  if (bestTf) return { q: bestTf.q, r: bestTf.r };
  if (bestFallback) {
    setTileTerrain(state, bestFallback.idx, TERRAIN.flat, tick);
    setTilePrep(state, bestFallback.idx, PREP.flat, tick);
    touchTile(state, bestFallback.idx, tick);
    return { q: bestFallback.q, r: bestFallback.r };
  }
  return { q: refQ, r: refR };
}

/** Finds the closest terraformed landing hex to `(q, r)` (supports `(state, q, r)` and `(state, colonyId, q, r, tick)`). */
export function findClosestTerraformedHex(
  state: PlanetState,
  qOrColonyId: number,
  rOrRefQ: number,
  refROpt?: number,
  tick = state.meta.tick,
): { q: number; r: number } {
  if (typeof refROpt === 'number') {
    return findClosestTerraformedLandingTile(state, qOrColonyId, rOrRefQ, refROpt, tick);
  }
  return findClosestTerraformedLandingTile(state, 0, qOrColonyId, rOrRefQ, tick);
}

/** Starts the unskippable 30-second HQ respawn countdown for `colonyId`. */
export function initiateHqRespawn(
  state: PlanetState,
  colonyId: number,
  refQ: number,
  refR: number,
  tick = state.meta.tick,
  ctx?: Partial<Pick<StepContext, 'tick' | 'emit'>>,
): HqRespawnRecord {
  const effTick = ctx?.tick ?? tick;
  recordHqColonyDeployed(state, colonyId, refQ, refR, effTick, true);
  const map = getHqRespawns(state);
  const existing = map[colonyId];
  if (existing && existing.ticksRemaining > 0) return existing;

  const target = findClosestTerraformedLandingTile(state, colonyId, refQ, refR, effTick);
  const rec: HqRespawnRecord = {
    colonyId,
    deadAtTick: effTick,
    respawnAtTick: effTick + HQ_RESPAWN_TICKS,
    ticksRemaining: HQ_RESPAWN_TICKS,
    totalTicks: HQ_RESPAWN_TICKS,
    q: target.q,
    r: target.r,
    lastHqQ: refQ,
    lastHqR: refR,
    emitted: Boolean(ctx?.emit),
  };
  map[colonyId] = rec;
  saveHqRespawns(state, map, effTick);

  ctx?.emit?.({
    kind: 'hqDestroyed',
    severity: 'critical',
    colonyIds: [colonyId],
    data: {
      colonyId,
      q: target.q,
      r: target.r,
      lastHqQ: refQ,
      lastHqR: refR,
      countdownS: HQ_RESPAWN_COUNTDOWN_S,
      respawnAtTick: rec.respawnAtTick,
    },
  });
  return rec;
}

/** Re-validates active HQ respawn target coordinates (e.g. right after a meteor blast mutates grid tiles). */
export function refreshHqRespawnTargets(state: PlanetState, tick = state.meta.tick): void {
  const raw = state.blobs[HQ_RESPAWN_BLOB_KEY];
  if (!raw) return;
  const map = getHqRespawns(state);
  const occupied = collectOccupiedTileIndices(state, -1);
  const hx = hexIndex(state.grid.radius);
  let changed = false;

  for (const rec of Object.values(map)) {
    const idx = hx.indexOf(rec.q, rec.r);
    const valid =
      idx >= 0 &&
      isValidLandingCandidateTile(state, rec.colonyId, rec.q, rec.r, occupied) &&
      state.grid.layers.terrain[idx] === TERRAIN.flat &&
      isTerraformedPrep(state.grid.layers.prep[idx]);
    if (!valid) {
      const refQ = typeof rec.lastHqQ === 'number' ? rec.lastHqQ : rec.q;
      const refR = typeof rec.lastHqR === 'number' ? rec.lastHqR : rec.r;
      const next = findClosestTerraformedLandingTile(state, rec.colonyId, refQ, refR, tick);
      if (next.q !== rec.q || next.r !== rec.r) {
        rec.q = next.q;
        rec.r = next.r;
        changed = true;
      }
    }
  }
  if (changed) saveHqRespawns(state, map, tick);
}

function launchReplacementPod(state: PlanetState, rec: HqRespawnRecord, ctx: StepContext): void {
  const valid = isValidLandingCandidateTile(state, rec.colonyId, rec.q, rec.r);
  const target = valid
    ? { q: rec.q, r: rec.r }
    : findClosestTerraformedLandingTile(state, rec.colonyId, rec.lastHqQ, rec.lastHqR, ctx.tick);
  const targetQ = target.q;
  const targetR = target.r;

  const hx = hexIndex(state.grid.radius);
  const idx = hx.indexOf(targetQ, targetR);
  if (idx >= 0) {
    setTileTerrain(state, idx, TERRAIN.flat, ctx.tick);
    if (!isTerraformedPrep(state.grid.layers.prep[idx])) {
      setTilePrep(state, idx, PREP.flat, ctx.tick);
    }
    if ((state.grid.layers.deposit?.[idx] ?? DEPOSIT.none) !== DEPOSIT.none) {
      setTileDeposit(state, idx, DEPOSIT.none, 0, ctx.tick, 0);
    }
    touchTile(state, idx, ctx.tick);
  }

  const e = state.entities, cols = e.cols;
  for (let row = e.count - 1; row >= 0; row--) {
    if (cols.kind[row] === ENTITY_KIND.pod && cols.owner[row] === rec.colonyId) {
      removeRow(e, cols.id[row], ctx.tick);
    }
  }

  const totalTicks = Math.min(resolveDescentTicks(ctx.data), HQ_RESPAWN_DESCENT_TICKS);
  const podEntityId = ctx.newEntityId();
  const row = insertRow(e, podEntityId, ctx.tick);
  cols.kind[row] = ENTITY_KIND.pod;
  cols.owner[row] = rec.colonyId;
  cols.tier[row] = 1;
  placeSpawnedEntity(e, row, targetQ, targetR, ctx.tick);
  cols.rot[row] = 0;
  const podHp = Math.fround(rowNum(resolveStartingKitRow(ctx.data), 'podHp'));
  cols.hp[row] = podHp;
  cols.hpMax[row] = podHp;
  cols.state[row] = ENTITY_STATE.descending;
  cols.progress[row] = 0;
  cols.createdAt[row] = ctx.tick;
  cols.changedAt[row] = ctx.tick;

  revealVision(state, rec.colonyId, targetQ, targetR, hqViewRadius(ctx.data), ctx.tick);

  const pods = getLandingPods(state).filter((p) => p.colonyId !== rec.colonyId);
  pods.push({
    podEntityId,
    colonyId: rec.colonyId,
    q: targetQ,
    r: targetR,
    ticksRemaining: totalTicks,
    totalTicks,
    deployed: false,
  });
  setBlob(state, 'landingPods', pods, ctx.tick);

  ctx.emit({
    kind: 'hqRespawnPodLaunched',
    severity: 'info',
    colonyIds: [rec.colonyId],
    data: {
      colonyId: rec.colonyId,
      podEntityId,
      q: targetQ,
      r: targetR,
      descentTicks: totalTicks,
    },
  });
}

function syncHqColonyTracker(state: PlanetState, tick: number): Record<number, HqColonyTrackerEntry> {
  const tracker = getHqColonyTracker(state);
  let changed = false;
  const e = state.entities, cols = e.cols;
  for (let row = 0; row < e.count; row++) {
    if (cols.kind[row] === ENTITY_KIND.hq && cols.hp[row] > 0) {
      const colId = cols.owner[row];
      const q = cols.q[row];
      const r = cols.r[row];
      const prev = tracker[colId];
      if (!prev || !prev.deployed || prev.lastQ !== q || prev.lastR !== r) {
        tracker[colId] = { deployed: true, lastQ: q, lastR: r };
        changed = true;
      }
    }
  }
  for (const pod of getLandingPods(state)) {
    if (pod.deployed && !tracker[pod.colonyId]) {
      tracker[pod.colonyId] = { deployed: true, lastQ: pod.q, lastR: pod.r };
      changed = true;
    }
  }
  if (changed) saveHqColonyTracker(state, tracker, tick);
  return tracker;
}

/** Steps all active HQ respawn timers and detects any colony whose deployed HQ Explorer was destroyed. */
export function stepHqRespawns(state: PlanetState, ctx: StepContext): void {
  const tracker = syncHqColonyTracker(state, ctx.tick);
  let map = getHqRespawns(state);
  let changed = false;

  for (const [colIdStr, info] of Object.entries(tracker)) {
    const colonyId = Number(colIdStr);
    if (ctx.flags.has('W18')) {
      const col = state.colonies[colonyId];
      if (col?.status === 'eliminated') continue;
      const qList = Array.isArray(col?.queue) ? col.queue : [];
      const hasHubReprint = qList.some(
        (item) =>
          item &&
          typeof item === 'object' &&
          (item as { lane?: string }).lane === 'units' &&
          ((item as { task?: { unit?: string } }).task?.unit === 'hq'),
      );
      if (hasHubReprint) continue;
    }
    if (info.deployed && !hasAliveHq(state, colonyId) && !hasDescendingPod(state, colonyId) && !map[colonyId]) {
      initiateHqRespawn(state, colonyId, info.lastQ, info.lastR, ctx.tick, ctx);
      map = getHqRespawns(state);
    }
  }

  for (const rec of Object.values(map)) {
    if (hasAliveHq(state, rec.colonyId)) {
      delete map[rec.colonyId];
      changed = true;
      continue;
    }
    if (!rec.emitted) {
      rec.emitted = true;
      changed = true;
      ctx.emit({
        kind: 'hqDestroyed',
        severity: 'critical',
        colonyIds: [rec.colonyId],
        data: {
          colonyId: rec.colonyId,
          q: rec.q,
          r: rec.r,
          lastHqQ: rec.lastHqQ,
          lastHqR: rec.lastHqR,
          countdownS: HQ_RESPAWN_COUNTDOWN_S,
          respawnAtTick: rec.respawnAtTick,
        },
      });
    }
    if (ctx.tick > rec.deadAtTick) {
      rec.ticksRemaining = Math.max(0, rec.ticksRemaining - ctx.dt);
      changed = true;
    }
    if (rec.ticksRemaining <= 0) {
      launchReplacementPod(state, rec, ctx);
      delete map[rec.colonyId];
      changed = true;
    }
  }

  if (changed) saveHqRespawns(state, map, ctx.tick);
}
