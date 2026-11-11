import { ENTITY_KIND, ENTITY_STATE } from '../../../ecs/columns';
import { hexIndex } from '../../../grid/hex';
import { DEPOSIT, PREP, TERRAIN } from '../../../grid/layers';
import { TICK_MS } from '../../../kernel/constants';
import { setBlob, type PlanetState } from '../../../kernel/state';
import { footprintTilesOfEntity } from '../../weather/types';
import { getLandingPods } from '../index';

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

export function saveHqColonyTracker(
  state: PlanetState,
  tracker: Record<number, HqColonyTrackerEntry>,
  tick: number,
): void {
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

export function saveHqRespawns(state: PlanetState, map: Record<number, HqRespawnRecord>, tick: number): void {
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

export function collectOccupiedTileIndices(state: PlanetState, colonyId: number): Set<number> {
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

export function isTerraformedPrep(prep: number): boolean {
  return prep === PREP.flat || prep === PREP.prepared || prep === PREP.irrigated || prep === PREP.living;
}

export function isBlockedLandingTile(state: PlanetState, idx: number): boolean {
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
