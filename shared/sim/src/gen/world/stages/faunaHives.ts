import { HEX_DIRS, hexDistance, hexIndex } from '../../../grid/hex';
import { DEPOSIT, PREP, TERRAIN } from '../../../grid/layers';
import { nextInt, seedStream } from '../../../kernel/rng';
import { setBlob, type PlanetState } from '../../../kernel/state';
import {
  SPECIES_ORDER,
  WORLDGEN_HIVE_SITES_BLOB,
  type WorldgenHiveSite,
  type WorldgenHiveSitesBlob,
} from '../../../systems/fauna/types';
import { getSpawnSlots } from '../../spawnSlots';
import type { WorldGenContext, WorldStage } from '../context';

export interface PlanHiveSitesOptions {
  minExclusionRadius?: number;
  minSpacingTiles?: number;
  count?: number;
  allowCompactMap?: boolean;
}

function isPassableHiveLand(
  terrain: ArrayLike<number>,
  prep: ArrayLike<number>,
  deposit: ArrayLike<number>,
  idx: number,
): boolean {
  if (idx < 0) return false;
  const t = terrain[idx];
  if (t !== TERRAIN.flat && t !== TERRAIN.slope) return false;
  const p = prep[idx];
  if (p === PREP.ridge || p === PREP.moat) return false;
  return deposit[idx] === DEPOSIT.none;
}

function findValidEntranceForSite(
  state: PlanetState,
  q: number,
  r: number,
  slots: ReadonlyArray<{ q: number; r: number }>,
  minExclusion: number,
): { entranceQ: number; entranceR: number } | null {
  const hex = hexIndex(state.grid.radius);
  const { terrain, prep, deposit } = state.grid.layers;

  for (const [dq, dr] of HEX_DIRS) {
    const nq = q + dq;
    const nr = r + dr;
    const ni = hex.indexOf(nq, nr);
    if (!isPassableHiveLand(terrain, prep, deposit, ni)) continue;
    if (!slots.every((sl) => hexDistance(sl.q, sl.r, nq, nr) > minExclusion)) continue;

    let openNeighbors = 0;
    for (const [edq, edr] of HEX_DIRS) {
      const ei = hex.indexOf(nq + edq, nr + edr);
      if (isPassableHiveLand(terrain, prep, deposit, ei)) openNeighbors++;
    }
    if (openNeighbors >= 2) {
      return { entranceQ: nq, entranceR: nr };
    }
  }
  return null;
}

function isDryTile(terrain: ArrayLike<number>, prep: ArrayLike<number>, ti: number): boolean {
  if (ti < 0) return false;
  const t = terrain[ti];
  if (t === TERRAIN.shallow || t === TERRAIN.deep) return false;
  const p = prep[ti];
  return p !== PREP.ridge && p !== PREP.moat;
}

function isDryHivePad(
  hex: ReturnType<typeof hexIndex>,
  terrain: ArrayLike<number>,
  prep: ArrayLike<number>,
  cq: number,
  cr: number,
  planarRadius: number,
  hexRadius: number,
): boolean {
  const bound = Math.max(hexRadius, Math.ceil((planarRadius * 2) / Math.sqrt(3)) + 1);
  for (let dr = -bound; dr <= bound; dr++) {
    for (let dq = -bound; dq <= bound; dq++) {
      const pDist = Math.sqrt(dq * dq + dq * dr + dr * dr);
      if (pDist > planarRadius && hexDistance(0, 0, dq, dr) > hexRadius) continue;
      if (!isDryTile(terrain, prep, hex.indexOf(cq + dq, cr + dr))) return false;
    }
  }
  return true;
}

/** Ensures all 9 tiles of the 3×3 hive footprint are dry in-bounds tiles. */
function isDryFootprint3x3(
  hex: ReturnType<typeof hexIndex>,
  terrain: ArrayLike<number>,
  prep: ArrayLike<number>,
  cq: number,
  cr: number,
): boolean {
  for (let fr = -1; fr <= 1; fr++) {
    for (let fq = -1; fq <= 1; fq++) {
      if (!isDryTile(terrain, prep, hex.indexOf(cq + fq, cr + fr))) return false;
    }
  }
  return true;
}

/** Ensures the 3×3 hive footprint and every footprint tile's 6 axial neighbors are dry in-bounds tiles (`R2`). */
function isDryFootprintHexCore(
  hex: ReturnType<typeof hexIndex>,
  terrain: ArrayLike<number>,
  prep: ArrayLike<number>,
  cq: number,
  cr: number,
): boolean {
  for (let fr = -1; fr <= 1; fr++) {
    for (let fq = -1; fq <= 1; fq++) {
      const q = cq + fq;
      const r = cr + fr;
      if (!isDryTile(terrain, prep, hex.indexOf(q, r))) return false;
      for (const [dq, dr] of HEX_DIRS) {
        if (!isDryTile(terrain, prep, hex.indexOf(q + dq, r + dr))) return false;
      }
    }
  }
  return true;
}

function collectEligibleHiveCandidates(
  state: PlanetState,
  minExclusion: number,
  mode: 'full' | 'hexCore' | 'minimal' = 'full',
): Array<{ q: number; r: number; entranceQ: number; entranceR: number }> {
  const hex = hexIndex(state.grid.radius);
  const { terrain, prep, deposit } = state.grid.layers;
  const slots = getSpawnSlots(state);
  const hexPadRadius = 4;
  const planarRadius = state.meta.planetType === 'desert' ? 5.2 : 4.5;
  const fullRimInset = Math.max(hexPadRadius, Math.ceil((planarRadius * 2) / Math.sqrt(3)));
  const coreRimInset = state.grid.radius >= 5 ? 3 : 2;
  const minimalRimInset = state.grid.radius >= 2 ? 2 : 0;
  const maxRim = Math.max(
    0,
    state.grid.radius - (mode === 'full' ? fullRimInset : mode === 'hexCore' ? coreRimInset : minimalRimInset),
  );
  const candidates: Array<{ q: number; r: number; entranceQ: number; entranceR: number }> = [];

  for (let i = 0; i < hex.count; i++) {
    const q = hex.q[i]!;
    const r = hex.r[i]!;
    if (hexDistance(0, 0, q, r) > maxRim) continue;
    if (!isPassableHiveLand(terrain, prep, deposit, i)) continue;
    if (mode === 'full' && !isDryHivePad(hex, terrain, prep, q, r, planarRadius, hexPadRadius)) continue;
    if (mode === 'hexCore' && state.grid.radius >= 5 && !isDryFootprintHexCore(hex, terrain, prep, q, r)) continue;
    if (mode === 'minimal' && state.grid.radius >= 2 && !isDryFootprint3x3(hex, terrain, prep, q, r)) continue;
    if (!slots.every((sl) => hexDistance(sl.q, sl.r, q, r) > minExclusion)) continue;

    const entrance = findValidEntranceForSite(state, q, r, slots, minExclusion);
    if (!entrance) continue;
    candidates.push({ q, r, entranceQ: entrance.entranceQ, entranceR: entrance.entranceR });
  }
  return candidates;
}

/**
 * Plans deterministic species hive sites on passable land strictly outside the 25-tile landing
 * exclusion zones (`fauna-hives-spec.md` §3).
 */
export function planWorldgenHiveSites(
  state: PlanetState,
  opts?: PlanHiveSitesOptions,
): WorldgenHiveSite[] {
  const minExclusion = opts?.minExclusionRadius ?? 25;
  const minSpacing = opts?.minSpacingTiles ?? 14;
  let fullPadPool = collectEligibleHiveCandidates(state, minExclusion, 'full');
  let corePadPool = collectEligibleHiveCandidates(state, minExclusion, 'hexCore');
  let minimalPool = collectEligibleHiveCandidates(state, minExclusion, 'minimal');
  if (minimalPool.length === 0 && opts?.allowCompactMap) {
    fullPadPool = collectEligibleHiveCandidates(state, 4, 'full');
    corePadPool = collectEligibleHiveCandidates(state, 4, 'hexCore');
    minimalPool = collectEligibleHiveCandidates(state, 4, 'minimal');
  }
  if (minimalPool.length === 0) return [];

  const { terrain, prep, deposit } = state.grid.layers;
  let passableLandTiles = 0;
  for (let i = 0; i < state.grid.count; i++) {
    if (isPassableHiveLand(terrain, prep, deposit, i)) passableLandTiles++;
  }

  const desertMult = state.meta.planetType === 'desert' ? 0.7 : 1.0;
  const densityCount = Math.round((passableLandTiles / 400) * desertMult);
  const desiredCount =
    opts?.count !== undefined
      ? opts.count
      : Math.max(3, Math.min(18, densityCount));
  const targetCount = Math.min(minimalPool.length, desiredCount);
  const minRequired =
    opts?.count !== undefined ? targetCount : Math.min(targetCount, SPECIES_ORDER.length);
  const relaxedTenSpacing = Math.min(minSpacing, Math.max(10, Math.floor(minSpacing * 0.75)));

  const rng = seedStream(String(state.meta.seed), 'faunaHives');
  const chosen: WorldgenHiveSite[] = [];
  const passes: ReadonlyArray<{ pool: typeof minimalPool; spacing: number; limit: number }> = [
    { pool: fullPadPool, spacing: minSpacing, limit: targetCount },
    { pool: corePadPool, spacing: minSpacing, limit: targetCount },
    { pool: fullPadPool, spacing: relaxedTenSpacing, limit: targetCount },
    { pool: corePadPool, spacing: relaxedTenSpacing, limit: targetCount },
    { pool: corePadPool, spacing: Math.max(4, Math.floor(minSpacing / 2)), limit: minRequired },
    { pool: minimalPool, spacing: Math.max(4, Math.floor(minSpacing / 2)), limit: minRequired },
    { pool: minimalPool, spacing: 2, limit: minRequired },
  ];

  for (const { pool: sourcePool, spacing, limit } of passes) {
    while (chosen.length < limit) {
      const pool = sourcePool.filter((cand) =>
        chosen.every((c) => hexDistance(c.q, c.r, cand.q, cand.r) >= spacing),
      );
      if (pool.length === 0) break;
      const pick = pool[nextInt(rng, 0, pool.length - 1)]!;
      const siteIndex = chosen.length;
      chosen.push({
        siteIndex,
        species: SPECIES_ORDER[siteIndex % SPECIES_ORDER.length]!,
        q: pick.q,
        r: pick.r,
        entranceQ: pick.entranceQ,
        entranceR: pick.entranceR,
      });
    }
    if (chosen.length >= targetCount) break;
  }

  return chosen;
}

export function getWorldgenHiveSites(state: PlanetState): WorldgenHiveSite[] {
  const raw = state.blobs[WORLDGEN_HIVE_SITES_BLOB]?.value as
    | Partial<WorldgenHiveSitesBlob>
    | undefined;
  if (raw && Array.isArray(raw.sites)) {
    return raw.sites.map((s) => ({ ...s }));
  }
  return planWorldgenHiveSites(state);
}

export const faunaHives: WorldStage = {
  id: 'faunaHives',
  run(ctx: WorldGenContext) {
    const sites = planWorldgenHiveSites(ctx.state);
    setBlob(ctx.state, WORLDGEN_HIVE_SITES_BLOB, { sites }, 0);
  },
};
