import {
  creditResource,
  DEPOSIT,
  ensureColonyLedger,
  ENTITY_KIND,
  ENTITY_STATE,
  hexDistance,
  indexOf,
  insertRow,
  placeSpawnedEntity,
  PREP,
  revealVision,
  rowOf,
  spawnWorkerUnit,
  setTilePrep,
  startBuildingConstruction,
  syncColonyTerraformStats,
  TERRAIN,
  type PlanetState,
} from '@terra/sim';
import { defineScenario } from './_define';

/** What a patch is made of: tile terrain / prep codes, and how the patch's height (m) is shaped. */
export type W05TerrainPatchId =
  | 'forest' | 'rock' | 'mountain' | 'ridge' | 'moat' | 'living' | 'shallow' | 'deep' | 'craters' | 'hills' | 'dunes' | 'prepared';

export interface W05TerrainPatch {
  readonly id: W05TerrainPatchId;
  readonly label: string;
  /** Centre of the patch (a Hex r=1 of 7 tiles for most; `dunes` is two crest rows, see `patchTiles`). */
  readonly center: readonly [number, number];
  /** The Terraform op this obstacle is cleared with, or `null` when the sim has none (shown, not orderable). */
  readonly op: 'clear' | 'break' | 'level' | 'fill' | 'reclaim' | 'deepReclaim' | 'grade' | null;
}

/** Twelve patches on ring 8 around the Hub (every centre is 8 hexes from `(0, 0)`, neighbours >= 4 apart: one free hex between). */
export const W05_TERRAIN_PATCHES: readonly W05TerrainPatch[] = [
  { id: 'forest', label: 'Forest', center: [8, 0], op: 'clear' },
  { id: 'rock', label: 'Rocks', center: [8, -4], op: 'break' },
  { id: 'mountain', label: 'Mountain (tall rock massif)', center: [8, -8], op: 'break' },
  { id: 'ridge', label: 'Ridge (not terraformable)', center: [4, -8], op: null },
  { id: 'moat', label: 'Moat (not terraformable)', center: [0, -8], op: null },
  { id: 'living', label: 'Living (already terraformed)', center: [-4, -4], op: null },
  { id: 'shallow', label: 'Shallow water', center: [-8, 0], op: 'reclaim' },
  { id: 'deep', label: 'Deep water (needs a T2 worker)', center: [-8, 4], op: 'deepReclaim' },
  { id: 'craters', label: 'Craters (holes)', center: [-8, 8], op: 'fill' },
  { id: 'hills', label: 'Hills (slopes)', center: [-4, 8], op: 'level' },
  { id: 'dunes', label: 'Dunes (sand ridges)', center: [0, 8], op: 'level' },
  { id: 'prepared', label: 'Plain ground (Grade -> Irrigate -> Seed)', center: [4, 4], op: 'grade' },
];

const HEX_DIRS: ReadonlyArray<readonly [number, number]> = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

/** Tiles of one patch: centre + its six neighbours (`dunes`: three crest rows of 3, running along q, offset like sand waves). */
export function patchTiles(patch: W05TerrainPatch): ReadonlyArray<readonly [number, number]> {
  const [cq, cr] = patch.center;
  if (patch.id === 'dunes') {
    return [-1, 0, 1].flatMap((dq) => [[cq + dq, cr], [cq + dq - 1, cr + 1], [cq + dq, cr - 1]] as const).filter(
      (t, i, a) => a.findIndex((u) => u[0] === t[0] && u[1] === t[1]) === i,
    );
  }
  return [[cq, cr], ...HEX_DIRS.map(([dq, dr]) => [cq + dq, cr + dr] as const)];
}

/** Tier of the worker that can run Deep Reclaim (T2 gate). A T1 HQ is also present. */
export const W05_TERRAIN_WORKER_TIER = 2;

function setTile(state: PlanetState, q: number, r: number, terrain: number, prep: number, height: number): void {
  const idx = indexOf(state.grid.radius, q, r);
  if (idx < 0) return;
  state.grid.layers.terrain[idx] = terrain;
  state.grid.layers.height[idx] = height;
  setTilePrep(state, idx, prep, 0);
}

function applyPatch(state: PlanetState, patch: W05TerrainPatch): void {
  const tiles = patchTiles(patch);
  tiles.forEach(([q, r], i) => {
    const centre = i === 0;
    switch (patch.id) {
      case 'forest': return setTile(state, q, r, TERRAIN.forest, PREP.flat, 0.08);
      case 'rock': return setTile(state, q, r, TERRAIN.rock, PREP.flat, 0.2);
      case 'mountain': return setTile(state, q, r, TERRAIN.rock, PREP.flat, centre ? 2.4 : 1.2);
      case 'ridge': return setTile(state, q, r, TERRAIN.flat, PREP.ridge, centre ? 1.6 : 0.9);
      case 'moat': return setTile(state, q, r, TERRAIN.flat, PREP.moat, -0.35);
      case 'living': return setTile(state, q, r, TERRAIN.flat, PREP.living, 0.08);
      case 'shallow': return setTile(state, q, r, TERRAIN.shallow, PREP.flat, 0.01);
      case 'deep': return setTile(state, q, r, centre ? TERRAIN.deep : TERRAIN.shallow, PREP.flat, centre ? -0.05 : 0.01);
      case 'craters': return setTile(state, q, r, TERRAIN.hole, PREP.flat, centre ? -0.1 : 0.02);
      case 'hills': return setTile(state, q, r, TERRAIN.slope, PREP.flat, centre ? 0.95 : 0.5);
      case 'dunes': return setTile(state, q, r, TERRAIN.slope, PREP.flat, r === patch.center[1] ? 0.55 : 0.28);
      case 'prepared': return setTile(state, q, r, TERRAIN.flat, PREP.prepared, 0.08);
    }
  });
}

function prepareGround(state: PlanetState): void {
  for (let i = 0; i < state.grid.count; i++) {
    state.grid.layers.terrain[i] = TERRAIN.flat;
    state.grid.layers.height[i] = 0.08;
    state.grid.layers.deposit[i] = DEPOSIT.none;
    state.grid.layers.richness[i] = 0;
    state.grid.layers.owner[i] = -1;
    setTilePrep(state, i, PREP.flat, 0);
  }
  for (let r = -11; r <= 11; r++) {
    for (let q = -11; q <= 11; q++) {
      if (hexDistance(0, 0, q, r) > 11) continue;
      const idx = indexOf(state.grid.radius, q, r);
      if (idx >= 0) state.grid.layers.owner[idx] = 0;
    }
  }
  for (const patch of W05_TERRAIN_PATCHES) applyPatch(state, patch);
}

const STRUCTURES = [[0, -3, 'solar', 2], [3, -3, 'solar', 2], [-3, -2, 'metalsExtractor', 2]] as const;

function prepareFootprints(state: PlanetState): void {
  for (const [q, r, size] of [[0, 0, 3], ...STRUCTURES.map(([sq, sr, , s]) => [sq, sr, s] as const)] as const) {
    const minOff = -Math.floor((size - 1) / 2);
    for (let dr = minOff; dr < minOff + size; dr++) {
      for (let dq = minOff; dq < minOff + size; dq++) {
        const idx = indexOf(state.grid.radius, q + dq, r + dr);
        if (idx >= 0) setTilePrep(state, idx, PREP.prepared, 0);
      }
    }
  }
}

function spawnUnit(state: PlanetState, kind: number, q: number, r: number, tier: number, hp: number, cell: number, workRate: number): void {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, 0);
  state.entities.cols.kind[row] = kind;
  state.entities.cols.owner[row] = 0;
  state.entities.cols.tier[row] = tier;
  placeSpawnedEntity(state.entities, row, q, r, 0);
  state.entities.cols.hp[row] = hp;
  state.entities.cols.hpMax[row] = hp;
  state.entities.cols.cell[row] = cell;
  state.entities.cols.cellMax[row] = cell;
  state.entities.cols.workRate[row] = workRate;
  state.entities.cols.state[row] = ENTITY_STATE.idle;
}

function spawnColony(state: PlanetState): void {
  startBuildingConstruction(state, { owner: 0, building: 'commandHub', q: 0, r: 0, instant: true, costOverride: {}, tick: 0 });
  for (const [q, r, building] of STRUCTURES) {
    startBuildingConstruction(state, { owner: 0, building, q, r, instant: true, costOverride: {}, tick: 0 });
  }
  spawnUnit(state, ENTITY_KIND.hq, 2, 1, 1, 900, 800, 1.5);
  const t2 = spawnWorkerUnit(state, { owner: 0, q: 2, r: 2, tier: 2 });
  const t2Row = rowOf(state.entities, t2);
  state.entities.cols.hp[t2Row] = 150;
  state.entities.cols.hpMax[t2Row] = 150;
  state.entities.cols.cell[t2Row] = 100;
  state.entities.cols.cellMax[t2Row] = 100;
  state.entities.cols.workRate[t2Row] = 1.0;
  spawnWorkerUnit(state, { owner: 0, q: 1, r: 2, tier: W05_TERRAIN_WORKER_TIER });
}

/**
 * W05 Terrain Garden (owner request 2026-11-05): one scene with every terraformable obstacle near the Command Hub so the
 * single Terraform button can be tried on all of them (patch table `W05_TERRAIN_PATCHES`, ring 8 around the Hub).
 * Stage 5 (Deep Reclaim is stage-locked until S5) plus a pre-spawned T2 worker (Deep Reclaim needs a T2 worker).
 * Sim reality: there are no separate dune / mountain terrain codes. Dunes and hills are `slope` (Level), a mountain is tall
 * `rock` (Break); `ridge` / `moat` are `prep` codes with no terraform op (they are shown, never orderable).
 */
export default defineScenario({
  id: 'w05-terrain',
  title: 'W05 Terrain Garden (every obstacle kind)',
  waves: '..05',
  seed: 'w05-terrain',
  planet: { type: 'temperate', planetType: 'temperate', radius: 16 },
  build(_host, api) {
    const state = api.planet;
    const colony = ensureColonyLedger({
      index: 0,
      id: 'col-0',
      name: 'Terrain Garden',
      color: 0xff6b00,
      status: 'active',
      stage: 5,
      unlockStage: 5,
      changedAt: 0,
    });
    state.colonies[0] = colony;

    prepareGround(state);
    spawnColony(state);
    // The Hub's own claim reaches R=10; re-apply territory and patches so the garden is exactly as authored.
    prepareGround(state);
    prepareFootprints(state);
    syncColonyTerraformStats(state, 0, 0);
    revealVision(state, 0, 0, 0, 14, 0);

    creditResource(colony, 'metals.t1', 1500, 0);
    creditResource(colony, 'minerals.t1', 1200, 0);
    creditResource(colony, 'bio.biomass', 400, 0);
    creditResource(colony, 'bio.water', 800, 0);

    api.command('dev.skipnight', {});
    api.settle(5);
  },
});
