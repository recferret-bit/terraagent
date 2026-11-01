import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createPlanet,
  DEPOSIT,
  evaluatePlacement,
  getHubFootprintTiles,
  hasColonyHub,
  hexIndex,
  PREP,
  placementWorldFromState,
  setTileDeposit,
  setTilePrep,
  setTileTerrain,
  SimHost,
  spawnHqUnit,
  TERRAIN,
  type SimCommand,
} from '../../src';

let seq = 0;
const mkCmd = (args: unknown): SimCommand => ({ colonyIndex: 0, source: 'player', commandId: `pr_${++seq}`, kind: 'placeBuilding', args });

function host(): SimHost {
  const h = new SimHost({ flags: parseWaves('..01') });
  h.load(createPlanet({ type: 'flat', seed: 'placement-rules', radius: 12 }));
  spawnHqUnit(h.state, { owner: 0, q: 0, r: 0 });
  return h;
}

/** One footprint tile of the Hub at (3, 0) gets `mutate`; the expected rejection reason / cause follows. */
const CASES: Array<{ name: string; mutate: (h: SimHost, i: number) => void; code: string; block: string }> = [
  { name: 'trees', mutate: (h, i) => setTileTerrain(h.state.grid, i, TERRAIN.forest), code: 'terrain_unbuildable', block: 'trees' },
  { name: 'rock', mutate: (h, i) => setTileTerrain(h.state.grid, i, TERRAIN.rock), code: 'terrain_unbuildable', block: 'rock' },
  { name: 'slope', mutate: (h, i) => setTileTerrain(h.state.grid, i, TERRAIN.slope), code: 'terrain_unbuildable', block: 'slope' },
  { name: 'hole', mutate: (h, i) => setTileTerrain(h.state.grid, i, TERRAIN.hole), code: 'terrain_unbuildable', block: 'hole' },
  { name: 'shallow water', mutate: (h, i) => setTileTerrain(h.state.grid, i, TERRAIN.shallow), code: 'terrain_unbuildable', block: 'water' },
  { name: 'deep water', mutate: (h, i) => setTileTerrain(h.state.grid, i, TERRAIN.deep), code: 'terrain_unbuildable', block: 'water' },
  { name: 'ridge', mutate: (h, i) => setTilePrep(h.state.grid, i, PREP.ridge), code: 'terrain_unbuildable', block: 'ridge' },
  { name: 'metals deposit', mutate: (h, i) => setTileDeposit(h.state.grid, i, DEPOSIT.metals, 1), code: 'terrain_unbuildable', block: 'deposit' },
  { name: 'oil deposit', mutate: (h, i) => setTileDeposit(h.state.grid, i, DEPOSIT.oil, 1), code: 'terrain_unbuildable', block: 'deposit' },
];

describe('shared placement rules: one function for server handler and client ghost', () => {
  for (const c of CASES) {
    it(`rejects a Command Hub with one ${c.name} tile in the footprint, in the evaluator and through the command handler`, () => {
      const h = host();
      const idx = hexIndex(h.state.grid.radius);
      const fp = getHubFootprintTiles(3, 0);
      const bad = idx.indexOf(fp[4].q, fp[4].r);
      c.mutate(h, bad);

      const res = evaluatePlacement(placementWorldFromState(h.state), { colonyId: 0, q: 3, r: 0, building: 'commandHub' });
      expect(res.ok).toBe(false);
      expect(res.code).toBe(c.code);
      expect(res.block).toBe(c.block);
      expect(res.tiles.filter((t) => !t.ok).map((t) => t.tileIdx)).toEqual([bad]);

      h.submit(mkCmd({ building: 'commandHub', q: 3, r: 0 }));
      expect(h.step(1).outcomes[0]?.code).toBe(c.code);
      expect(hasColonyHub(h.state, 0)).toBe(false);
    });
  }

  it('accepts clean Flat ground (wild, flat or prepared) and bills only Grade ops', () => {
    const h = host();
    const idx = hexIndex(h.state.grid.radius);
    const fp = getHubFootprintTiles(3, 0);
    setTilePrep(h.state.grid, idx.indexOf(fp[0].q, fp[0].r), PREP.prepared);
    const res = evaluatePlacement(placementWorldFromState(h.state), { colonyId: 0, q: 3, r: 0 });
    expect(res.ok).toBe(true);
    expect(res.bill.ops).toEqual({ grade: 8, clear: 0, break: 0 });
    expect(res.bill.tilesToPrepare).toBe(8);
    h.submit(mkCmd({ building: 'commandHub', q: 3, r: 0 }));
    expect(h.step(1).outcomes[0]?.code).toBeUndefined();
    expect(hasColonyHub(h.state, 0)).toBe(true);
  });

  it('becomes valid once the player terraforms the trees away (Clear turns Forest into Flat)', () => {
    const h = host();
    const idx = hexIndex(h.state.grid.radius);
    const i = idx.indexOf(3, 0);
    setTileTerrain(h.state.grid, i, TERRAIN.forest);
    expect(evaluatePlacement(placementWorldFromState(h.state), { colonyId: 0, q: 3, r: 0 }).block).toBe('trees');
    setTileTerrain(h.state.grid, i, TERRAIN.flat);
    expect(evaluatePlacement(placementWorldFromState(h.state), { colonyId: 0, q: 3, r: 0 }).ok).toBe(true);
  });

  it('rejects overlapping an existing building footprint as site_blocked (occupied)', () => {
    const h = host();
    h.submit(mkCmd({ building: 'commandHub', q: 3, r: 0 }));
    h.step(1);
    const res = evaluatePlacement(placementWorldFromState(h.state), { colonyId: 1, q: 4, r: 0 });
    expect(res.code).toBe('site_blocked');
    expect(res.block).toBe('occupied');
  });
});
