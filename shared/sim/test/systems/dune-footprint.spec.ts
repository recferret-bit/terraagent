import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createRegistryPipeline,
  createState,
  DEPOSIT,
  dunePadHeight,
  duneWorkTiles,
  DUNE_TIME_MULT,
  ensureColonyLedger,
  flattenDuneFootprint,
  hexDistance,
  hexIndex,
  isHexTile,
  PREP,
  setTilePrep,
  setTileTerrain,
  spawnHqUnit,
  step,
  TERRAIN,
  TERRAFORM_TIME_TABLE,
  type PlanetState,
  type SimCommand,
  type WorkJobRecord,
} from '../../src';

/** A level flat world with colony 0 and its HQ at (0, 0). */
function flatWorld(seed: string, radius = 8) {
  const state = createState({ planetId: `p-${seed}`, planetType: 'temperate', seed, radius });
  state.colonies.push(ensureColonyLedger({ index: 0, id: 'col-0', name: 'A', color: 0xff6b00, status: 'active', changedAt: 0 }));
  const L = state.grid.layers;
  for (let k = 0; k < state.grid.count; k++) {
    setTileTerrain(state, k, TERRAIN.flat, 0);
    setTilePrep(state.grid, k, PREP.wild, 0);
    L.height[k] = 0;
    L.owner[k] = -1;
  }
  const hx = hexIndex(radius);
  const at = (q: number, r: number) => hx.indexOf(q, r);
  spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
  const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });
  const run = (cmds: SimCommand[] = [], n = 1) => step(state, cmds, n, pipeline);
  return { state, at, hx, run, L };
}

const work = (id: string, tiles: Array<{ q: number; r: number }>): SimCommand => ({
  commandId: id, colonyIndex: 0, source: 'player', kind: 'enqueueTask', args: { terraform: { op: 'work', tiles } },
});

const jobsOf = (state: PlanetState) =>
  (state.blobs.workJobs?.value as { byId?: Record<string, WorkJobRecord> } | undefined)?.byId ?? {};

function runUntil(run: () => unknown, done: () => boolean, max = 2500): number {
  for (let t = 1; t <= max; t++) {
    run();
    if (done()) return t;
  }
  return -1;
}

describe('dune work disc', () => {
  it('lists the slope hexes of a 5-wide disc and skips rock, forest and deposits', () => {
    const radius = 6;
    const hx = hexIndex(radius);
    const terrain = new Uint8Array(hx.count).fill(TERRAIN.slope);
    const deposit = new Uint8Array(hx.count);
    terrain[hx.indexOf(1, 0)] = TERRAIN.rock;
    terrain[hx.indexOf(0, 1)] = TERRAIN.forest;
    deposit[hx.indexOf(-1, 0)] = DEPOSIT.metals;
    const tiles = duneWorkTiles(radius, 0, 0, terrain, deposit);
    expect(tiles).toHaveLength(16);
    expect(tiles.some((t) => t.q === 2 && t.r === 0)).toBe(true);
    expect(tiles.some((t) => hexDistance(0, 0, t.q, t.r) > 2)).toBe(false);
    expect(tiles.some((t) => t.q === 1 && t.r === 0)).toBe(false);
    expect(tiles.some((t) => t.q === 0 && t.r === 1)).toBe(false);
    expect(tiles.some((t) => t.q === -1 && t.r === 0)).toBe(false);
  });

  it('cuts a dune with no flat shoulder down to the build plane', () => {
    const radius = 4;
    const hx = hexIndex(radius);
    const terrain = new Uint8Array(hx.count).fill(TERRAIN.slope);
    const height = new Float32Array(hx.count).fill(4.2);
    expect(dunePadHeight(radius, 0, 0, { terrain, height })).toBe(0);
    terrain[hx.indexOf(3, 0)] = TERRAIN.flat;
    height[hx.indexOf(3, 0)] = 1.25;
    expect(dunePadHeight(radius, 0, 0, { terrain, height })).toBe(1.25);
  });

  it('one slope work job clears the 5-wide disc, leaves rock and the next ring, and takes five times as long', () => {
    const w = flatWorld('dune-disc');
    const center = { q: 3, r: 0 };
    for (let i = 0; i < w.state.grid.count; i++) {
      const q = w.hx.q[i]!, r = w.hx.r[i]!;
      const d = hexDistance(center.q, center.r, q, r);
      if (d > 2 && !(q === 6 && r === 0)) continue;
      if (q === 1 && r === 0) continue; // flat stand, in reach of the HQ
      setTileTerrain(w.state, i, TERRAIN.slope, 0);
      w.L.height[i] = 4;
    }
    setTileTerrain(w.state, w.at(4, 0), TERRAIN.rock, 0); // cap inside the disc
    setTileTerrain(w.state, w.at(3, 1), TERRAIN.forest, 0);
    w.L.height[w.at(4, 0)] = 6;
    w.L.height[w.at(3, 1)] = 4;

    w.run([work('w1', [center])]);
    const job = jobsOf(w.state)['w1']!;
    expect(job.terrainKey).toBe('slope');
    expect(job.durationTicks).toBe(TERRAFORM_TIME_TABLE.slope.durationTicks * DUNE_TIME_MULT);
    expect(job.energyCost).toBe(TERRAFORM_TIME_TABLE.slope.energyCost * DUNE_TIME_MULT);

    expect(runUntil(w.run, () => w.L.terrain[w.at(3, 0)] === TERRAIN.flat)).toBeGreaterThan(0);

    for (let i = 0; i < w.state.grid.count; i++) {
      const q = w.hx.q[i]!, r = w.hx.r[i]!;
      const d = hexDistance(3, 0, q, r);
      if (d > 2 || (q === 4 && r === 0) || (q === 3 && r === 1) || (q === 1 && r === 0)) continue;
      expect(w.L.terrain[i], `${q},${r}`).toBe(TERRAIN.flat);
      expect(w.L.prep[i], `${q},${r}`).toBe(PREP.prepared);
      expect(w.L.height[i], `${q},${r}`).toBe(0);
    }
    expect(w.L.terrain[w.at(4, 0)]).toBe(TERRAIN.rock);
    expect(w.L.height[w.at(4, 0)]).toBe(6);
    expect(w.L.terrain[w.at(3, 1)]).toBe(TERRAIN.forest);
    expect(w.L.terrain[w.at(6, 0)]).toBe(TERRAIN.slope);
    expect(w.L.height[w.at(6, 0)]).toBe(4);
    expect(w.L.terrain[w.at(1, 0)]).toBe(TERRAIN.flat);
    expect(w.L.prep[w.at(1, 0)]).not.toBe(PREP.prepared);
  });
});

describe('dune disc joins a plane (R4)', () => {
  const layersOf = (L: Record<string, ArrayLike<number>>) => ({ terrain: L.terrain!, prep: L.prep, height: L.height! });

  it('R4: a disc joins the level pad it borders (not a stray low tile), levels loose sand inside it, and leaves no gap in the grid', () => {
    const w = flatWorld('dune-join', 10);
    const L = w.L;
    for (let i = 0; i < w.state.grid.count; i++) {
      if (w.hx.q[i]! >= 0) { L.height[i] = 0.85; continue; } // the landing pad, east of q = 0
      setTileTerrain(w.state, i, TERRAIN.slope, 0); // dunes to the west
      L.height[i] = 2;
    }
    const stray = w.at(-3, -2); // a lone low Flat tile on the disc's outer ring
    setTileTerrain(w.state, stray, TERRAIN.flat, 0);
    L.height[stray] = 0.36;
    const loose = w.at(-4, 1); // loose Flat sand inside the disc, off level
    setTileTerrain(w.state, loose, TERRAIN.flat, 0);
    L.height[loose] = 1.4;
    flattenDuneFootprint(w.state, -3, 1, 1);
    expect(L.height[w.at(-3, 1)]).toBeCloseTo(0.85);
    expect(L.height[loose]).toBeCloseTo(0.85);
    expect(L.prep[loose]).toBe(PREP.wild);
    // the disc core and the pad edge beside it are one plane: hex tiles, no gap
    for (const [q, r] of [[-3, 1], [-2, 1], [-2, 0], [-1, 0], [0, 0]] as const) {
      expect(isHexTile(10, w.at(q, r), layersOf(L)), `${q},${r}`).toBe(true);
    }
  });

  it('R4: a disc deep in the dunes joins the nearest level plane, not a pit at 0', () => {
    const w = flatWorld('dune-far', 10);
    const L = w.L;
    for (let i = 0; i < w.state.grid.count; i++) {
      if (w.hx.q[i]! >= 3) { L.height[i] = 0.85; continue; }
      setTileTerrain(w.state, i, TERRAIN.slope, 0);
      L.height[i] = 2;
    }
    // ring 3 of (-3, 0) is all dune; the pad is 6 rings away
    expect(dunePadHeight(10, -3, 0, layersOf(L))).toBeCloseTo(0.85);
  });
});
