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

function collectEligibleHiveCandidates(
  state: PlanetState,
  minExclusion: number,
): Array<{ q: number; r: number; entranceQ: number; entranceR: number }> {
  const hex = hexIndex(state.grid.radius);
  const { terrain, prep, deposit } = state.grid.layers;
  const slots = getSpawnSlots(state);
  const maxRim = Math.max(0, state.grid.radius - 2);
  const candidates: Array<{ q: number; r: number; entranceQ: number; entranceR: number }> = [];

  for (let i = 0; i < hex.count; i++) {
    const q = hex.q[i]!;
    const r = hex.r[i]!;
    if (hexDistance(0, 0, q, r) > maxRim) continue;
    if (!isPassableHiveLand(terrain, prep, deposit, i)) continue;
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
  let eligible = collectEligibleHiveCandidates(state, minExclusion);
  if (eligible.length === 0 && opts?.allowCompactMap) {
    eligible = collectEligibleHiveCandidates(state, 4);
  }
  if (eligible.length === 0) return [];

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
  const targetCount = Math.min(eligible.length, desiredCount);

  const rng = seedStream(String(state.meta.seed), 'faunaHives');
  const chosen: WorldgenHiveSite[] = [];

  for (const spacing of [minSpacing, Math.max(4, Math.floor(minSpacing / 2)), 2]) {
    while (chosen.length < targetCount) {
      const pool = eligible.filter((cand) =>
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
