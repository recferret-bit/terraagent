import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  buildPowerGraph,
  compileData,
  createPlanet,
  DEPOSIT,
  ENTITY_STATE,
  evaluatePlacement,
  getHubFootprintTiles,
  hasColonyHub,
  hexIndex,
  PREP,
  placementWorldFromState,
  rowOf,
  setTileDeposit,
  setTileHeight,
  setTilePrep,
  setTileTerrain,
  SimHost,
  spawnHqUnit,
  startBuildingConstruction,
  TERRAIN,
  type CompiledDataLike,
  type SimCommand,
} from '../../src';

let seq = 0;
const mkCmd = (args: unknown, kind = 'placeBuilding'): SimCommand => ({ colonyIndex: 0, source: 'player', commandId: `pr_${++seq}`, kind, args });

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
  { name: 'uneven ramp', mutate: (h, i) => setTileHeight(h.state.grid, i, 0.32), code: 'terrain_unbuildable', block: 'uneven' },
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

  it('real loop, before any territory: Clear the trees + Break the rock via enqueueTask, then the same site is accepted', () => {
    const h = host();
    const idx = hexIndex(h.state.grid.radius);
    const fp = getHubFootprintTiles(3, 0);
    const tree = fp[1], rock = fp[7];
    setTileTerrain(h.state.grid, idx.indexOf(tree.q, tree.r), TERRAIN.forest);
    setTileTerrain(h.state.grid, idx.indexOf(rock.q, rock.r), TERRAIN.rock);
    h.submit(mkCmd({ building: 'commandHub', q: 3, r: 0 }));
    expect(h.step(1).outcomes[0]?.code).toBe('terrain_unbuildable');

    h.submit(mkCmd({ terraform: { op: 'clear', tiles: [tree] } }, 'enqueueTask'));
    expect(h.step(1).outcomes[0]?.code).toBeUndefined();
    h.submit(mkCmd({ terraform: { op: 'break', tiles: [rock] } }, 'enqueueTask'));
    expect(h.step(1).outcomes[0]?.code).toBeUndefined();
    for (let t = 0; t < 400 && h.state.grid.layers.terrain[idx.indexOf(rock.q, rock.r)] !== TERRAIN.flat; t++) h.step(1);
    expect(h.state.grid.layers.terrain[idx.indexOf(tree.q, tree.r)]).toBe(TERRAIN.flat);
    expect(h.state.grid.layers.terrain[idx.indexOf(rock.q, rock.r)]).toBe(TERRAIN.flat);

    h.submit(mkCmd({ building: 'commandHub', q: 3, r: 0 }));
    expect(h.step(1).outcomes[0]?.code).toBeUndefined();
    expect(hasColonyHub(h.state, 0)).toBe(true);
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

/** D-37, W02-08/09: the W02 buildings (Metals Extractor, Solar) run the same `evaluatePlacement` as the Hub. */
describe('shared placement rules: W02 building rows', () => {
  function w02Host(): SimHost {
    const h = new SimHost({ flags: parseWaves('..02') });
    h.load(createPlanet({ type: 'flat', seed: 'placement-rules-w02', radius: 12 }));
    spawnHqUnit(h.state, { owner: 0, q: 0, r: 0 });
    return h;
  }
  const at = (h: SimHost, q: number, r: number): number => hexIndex(h.state.grid.radius).indexOf(q, r);
  const evalAt = (h: SimHost, building: string, q: number, r: number) =>
    evaluatePlacement(placementWorldFromState(h.state), { colonyId: 0, building, q, r, requireBuilder: false });

  it('a Solar may not stand on any deposit tile (also a depleted one); free Flat ground is fine', () => {
    const h = w02Host();
    expect(evalAt(h, 'solar', 4, 2).ok).toBe(true);
    setTileDeposit(h.state.grid, at(h, 5, 3), DEPOSIT.minerals, 10000);
    expect(evalAt(h, 'solar', 4, 2)).toMatchObject({ ok: false, code: 'terrain_unbuildable', block: 'deposit' });
    setTileDeposit(h.state.grid, at(h, 5, 3), DEPOSIT.minerals, 0);
    expect(evalAt(h, 'solar', 4, 2)).toMatchObject({ ok: false, block: 'deposit' });
  });

  it('a Metals Extractor must cover a non-depleted metals deposit (site_blocked otherwise)', () => {
    const h = w02Host();
    expect(evalAt(h, 'metalsExtractor', 4, 2)).toMatchObject({ ok: false, code: 'site_blocked', block: 'noDeposit' });
    setTileDeposit(h.state.grid, at(h, 5, 2), DEPOSIT.metals, 10000);
    expect(evalAt(h, 'metalsExtractor', 4, 2).ok).toBe(true);
    setTileDeposit(h.state.grid, at(h, 5, 2), DEPOSIT.metals, 0);
    expect(evalAt(h, 'metalsExtractor', 4, 2)).toMatchObject({ ok: false, block: 'noDeposit' });
  });

  it('refuses foreign territory and trees, through evaluatePlacement and the enqueueTask build path', () => {
    const h = w02Host();
    h.state.grid.layers.owner[at(h, 4, 2)] = 1;
    expect(evalAt(h, 'solar', 4, 2)).toMatchObject({ ok: false, code: 'not_own_territory', block: 'foreign' });
    setTileTerrain(h.state.grid, at(h, 5, -3), TERRAIN.forest);
    h.submit(mkCmd({ taskId: 'w02-a', task: { kind: 'build', building: 'solar', q: 4, r: 2 } }, 'enqueueTask'));
    h.submit(mkCmd({ taskId: 'w02-b', task: { kind: 'build', building: 'solar', q: 4, r: -3 } }, 'enqueueTask'));
    setTileDeposit(h.state.grid, at(h, -4, 2), DEPOSIT.oil, 10000);
    h.submit(mkCmd({ taskId: 'w02-c', task: { kind: 'build', building: 'solar', q: -4, r: 2 } }, 'enqueueTask'));
    const out = h.step(1);
    expect(out.outcomes.map((o) => [o.code, o.detail])).toEqual([
      ['not_own_territory', 'not your territory'],
      ['terrain_unbuildable', 'trees: clear them first'],
      ['terrain_unbuildable', 'resource deposit'],
    ]);
  });

  it('placeBuilding still builds only the Command Hub (GP-05)', () => {
    const h = w02Host();
    h.submit(mkCmd({ building: 'solar', q: 4, r: 2 }));
    expect(h.step(1).outcomes[0]?.code).toBe('invalid_args');
  });
});

/**
 * W03 power zone (owner feedback, Protoss pylons): every building but the Command Hub stands inside the union of the
 * zones of the colony's Hubs (radius 6) and Power Pylons (radius 5); the power graph powers exactly what the zone allows.
 */
describe('shared placement rules: W03 power zone', () => {
  const W03 = compileData(parseWaves('..03'));
  function w03Host(withHub = true): SimHost {
    const h = new SimHost({ flags: parseWaves('..03') });
    h.load(createPlanet({ type: 'flat', seed: 'placement-rules-w03', radius: 14 }));
    spawnHqUnit(h.state, { owner: 0, q: -2, r: 3 });
    if (withHub) startBuildingConstruction(h.state, { owner: 0, building: 'commandHub', q: 0, r: 0, instant: true, costOverride: {}, tick: 0 });
    return h;
  }
  const evalAt = (h: SimHost, building: string, q: number, r: number, data: CompiledDataLike = W03) =>
    evaluatePlacement(placementWorldFromState(h.state), { colonyId: 0, building, q, r, requireBuilder: false, data });
  const pylonAt = (h: SimHost, q: number, r: number, built = true): number => {
    const res = startBuildingConstruction(h.state, { owner: 0, building: 'pylon', q, r, instant: true, costOverride: {}, tick: 0 });
    if (!res.ok) throw new Error(`pylon at ${q},${r}: ${res.code}`);
    if (!built) h.state.entities.cols.state[rowOf(h.state.entities, res.entityId)] = ENTITY_STATE.constructing;
    return res.entityId;
  };

  it('accepts a building inside the Hub zone and rejects one outside it (outside_power_zone), also through enqueueTask', () => {
    const h = w03Host();
    expect(evalAt(h, 'solar', 3, -3).ok).toBe(true);
    expect(evalAt(h, 'solar', 6, 0)).toMatchObject({ ok: false, code: 'outside_power_zone', block: 'outsidePowerZone' });
    h.submit(mkCmd({ taskId: 'far-solar', task: { kind: 'build', building: 'solar', q: 6, r: 0 } }, 'enqueueTask'));
    expect(h.step(1).outcomes[0]).toMatchObject({ code: 'outside_power_zone', detail: 'outside the power zone' });
  });

  it('a Power Pylon inside the zone extends it; a pylon outside every zone is rejected', () => {
    const h = w03Host();
    expect(evalAt(h, 'pylon', 6, 0).ok).toBe(true);
    expect(evalAt(h, 'pylon', 7, 0).block).toBe('outsidePowerZone');
    pylonAt(h, 6, 0);
    expect(evalAt(h, 'solar', 9, 0).ok).toBe(true);
    expect(evalAt(h, 'pylon', 11, 0).ok).toBe(true);
    expect(evalAt(h, 'pylon', 12, 0).block).toBe('outsidePowerZone');
  });

  it('chains: a pylon under construction and a queued pylon order already extend the zone for placement', () => {
    const h = w03Host();
    pylonAt(h, 6, 0, false); // site placed, not built
    expect(evalAt(h, 'pylon', 11, 0).ok).toBe(true);
    h.submit(mkCmd({ taskId: 'p-north', task: { kind: 'build', building: 'pylon', q: 0, r: -6 } }, 'enqueueTask'));
    expect(h.step(1).outcomes[0]?.code).toBeUndefined();
    h.submit(mkCmd({ taskId: 's-north', task: { kind: 'build', building: 'solar', q: 0, r: -10 } }, 'enqueueTask'));
    expect(h.step(1).outcomes[0]?.code).toBeUndefined();
  });

  it('the Command Hub is exempt; with no Hub nothing else is placeable; W02-only data has no zone rule', () => {
    const h = w03Host(false);
    expect(evalAt(h, 'commandHub', 6, 0).ok).toBe(true);
    expect(evalAt(h, 'solar', 3, -3).block).toBe('outsidePowerZone');
    expect(evalAt(h, 'solar', 3, -3, compileData(parseWaves('..02'))).ok).toBe(true);
  });

  it('every site the zone allows is powered once its relays are built (graph attach = zone)', () => {
    const h = w03Host();
    pylonAt(h, 6, 0);
    const okSites: Array<{ q: number; r: number }> = [];
    for (let q = -10; q <= 12; q++) for (let r = -10; r <= 10; r++) if (evalAt(h, 'solar', q, r).ok) okSites.push({ q, r });
    expect(okSites.length).toBeGreaterThan(50);
    for (const s of okSites) {
      const res = startBuildingConstruction(h.state, { owner: 0, building: 'solar', q: s.q, r: s.r, instant: true, costOverride: {}, tick: 0 });
      if (!res.ok) throw new Error(res.code);
      const graph = buildPowerGraph(h.state, 0, W03);
      expect(graph.componentByBuildingId.get(res.entityId), `solar at ${s.q},${s.r}`).toBe(0);
      h.state.entities.cols.hp[rowOf(h.state.entities, res.entityId)] = 0; // out of the way for the next site
    }
    const outside = startBuildingConstruction(h.state, { owner: 0, building: 'solar', q: -9, r: 0, instant: true, costOverride: {}, tick: 0 });
    if (!outside.ok) throw new Error(outside.code);
    expect(buildPowerGraph(h.state, 0, W03).componentByBuildingId.get(outside.entityId)).toBe(-1);
  });
});
