import { describe, expect, it } from 'vitest';
import { parseCommandArgs, parseWaves, REJECT_CODES } from '@terra/contracts';
import {
  createPlanet,
  ENTITY_KIND,
  ENTITY_STATE,
  getBuildingFootprintTiles,
  getConstructionOrders,
  getHubFootprintTiles,
  hasColonyHub,
  hexIndex,
  insertRow,
  PREP,
  rowOf,
  setTileOwner,
  setTilePrep,
  setTileTerrain,
  SimHost,
  spawnHqUnit,
  TERRAIN,
  validateBuildingPlacement,
  validateHubPlacement,
  type SimCommand,
} from '../../src';

let cmdSeq = 0;
function mkCmd(kind: string, args: unknown, colonyIndex: number | null = 0): SimCommand {
  return { colonyIndex, source: 'player', commandId: `hub_${++cmdSeq}`, kind, args };
}

function createW01Host(radius = 12): SimHost {
  const host = new SimHost({ flags: parseWaves('..01') });
  host.load(createPlanet({ type: 'flat', seed: 'hub-placement-test', radius }));
  return host;
}

describe('W01-14: Command Hub 3x3 placement validation & UO-TF-05 unclaimed exception', () => {
  it('acceptance: placing a Command Hub on a 3x3 footprint containing a foreign-owned tile rejects with not_own_territory', () => {
    const host = createW01Host();
    const state = host.state;
    spawnHqUnit(state, { owner: 0, q: 0, r: 0 });

    const idx = hexIndex(state.grid.radius);
    // Center at (3, 0); mark corner tile (4, -1) as owned by colony 1
    const foreignTileIdx = idx.indexOf(4, -1);
    setTileOwner(state.grid, foreignTileIdx, 1);

    const directCheck = validateHubPlacement(state, { colonyId: 0, q: 3, r: 0 });
    expect(directCheck.ok).toBe(false);
    expect(directCheck.reason).toBe('not_own_territory');

    const cmdArgs = { building: 'commandHub', q: 3, r: 0 };
    expect(parseCommandArgs('placeBuilding', cmdArgs).success).toBe(true);

    host.submit(mkCmd('placeBuilding', cmdArgs, 0));
    const stepRes = host.step(1);
    expect(stepRes.outcomes).toHaveLength(1);
    expect(stepRes.outcomes[0]?.code).toBe('not_own_territory');
    expect(hasColonyHub(state, 0)).toBe(false);
  });

  it('allows Command Hub placement on unclaimed (owner === -1) Flat tiles (UO-TF-05), while rejecting non-Hub buildings on unclaimed tiles with not_own_territory', () => {
    const host = createW01Host();
    const state = host.state;
    spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const idx = hexIndex(state.grid.radius);

    // Unclaimed Flat 3x3 centered at (3, 0)
    const footprint = getHubFootprintTiles(3, 0);
    expect(footprint).toHaveLength(9);
    for (const pos of footprint) {
      expect(state.grid.layers.owner[idx.indexOf(pos.q, pos.r)]).toBe(-1);
    }

    // Non-Hub building on unclaimed tile rejects with not_own_territory
    const nonHubCheck = validateBuildingPlacement(state, {
      colonyId: 0,
      q: 3,
      r: 0,
      buildingKind: 'solar',
    });
    expect(nonHubCheck.ok).toBe(false);
    expect(nonHubCheck.reason).toBe('not_own_territory');

    host.submit(mkCmd('placeBuilding', { building: 'solar', q: 3, r: 0 }, 0));
    expect(host.step(1).outcomes[0]?.code).toBe('not_own_territory');

    // Command Hub on the same unclaimed 3x3 succeeds (UO-TF-05 exception)
    const hubCheck = validateHubPlacement(state, { colonyId: 0, q: 3, r: 0 });
    expect(hubCheck.ok).toBe(true);
    expect(hubCheck.unpreparedCount).toBe(9);
    expect(hubCheck.preparedCount).toBe(0);

    host.submit(mkCmd('placeBuilding', { building: 'commandHub', q: 3, r: 0 }, 0));
    const stepRes = host.step(1);
    expect(stepRes.outcomes[0]?.code).toBeUndefined();
    expect(hasColonyHub(state, 0)).toBe(true);

    const orders = getConstructionOrders(state, 0);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      colonyId: 0,
      building: 'commandHub',
      q: 3,
      r: 0,
      status: 'waiting_site',
      waitingReason: 'waiting(site: 0/9)',
      preparedTiles: 0,
      totalTiles: 9,
    });
  });
});

describe('W01-14: Command Hub map bounds, Deep Water, maxPerColony, and HQ-only rules', () => {
  it('rejects outside the map (site_blocked) and on Deep Water (terrain_unbuildable)', () => {
    const host = createW01Host(6);
    const state = host.state;
    spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const idx = hexIndex(state.grid.radius);

    // At map edge (q = 6, r = 0): (7, 0) is outside radius 6
    const edgeCheck = validateHubPlacement(state, { colonyId: 0, q: 6, r: 0 });
    expect(edgeCheck.ok).toBe(false);
    expect(edgeCheck.reason).toBe('site_blocked');

    host.submit(mkCmd('placeBuilding', { building: 'commandHub', q: 6, r: 0 }, 0));
    expect(host.step(1).outcomes[0]?.code).toBe('site_blocked');

    // Deep water on one tile of the 3x3 centered at (2, 0)
    const deepIdx = idx.indexOf(3, 1);
    setTileTerrain(state.grid, deepIdx, TERRAIN.deep);

    const deepCheck = validateHubPlacement(state, { colonyId: 0, q: 2, r: 0 });
    expect(deepCheck.ok).toBe(false);
    expect(deepCheck.reason).toBe('terrain_unbuildable');
    expect(deepCheck.block).toBe('water');

    host.submit(mkCmd('placeBuilding', { building: 'commandHub', q: 2, r: 0 }, 0));
    expect(host.step(1).outcomes[0]?.code).toBe('terrain_unbuildable');
  });

  it('enforces maxPerColony: 1 (only one Hub per colony) and HQ-only placement (UO-L-03)', () => {
    const host = createW01Host();
    const state = host.state;

    // Colony 0 has no HQ yet -> rejects
    const noHqCheck = validateHubPlacement(state, { colonyId: 0, q: 2, r: 0 });
    expect(noHqCheck.ok).toBe(false);
    expect(REJECT_CODES).toContain(noHqCheck.reason);

    host.submit(mkCmd('placeBuilding', { building: 'commandHub', q: 2, r: 0 }, 0));
    const noHqStep = host.step(1);
    expect(noHqStep.outcomes[0]?.code).toBe('worker_tier_locked');

    // Spawn a non-HQ unit (devProbe) owned by colony 0 -> still rejects
    const probeId = state.meta.nextEntityId++;
    const probeRow = insertRow(state.entities, probeId, state.meta.tick);
    state.entities.cols.kind[probeRow] = ENTITY_KIND.devProbe;
    state.entities.cols.owner[probeRow] = 0;
    state.entities.cols.hp[probeRow] = 100;
    state.entities.cols.hpMax[probeRow] = 100;

    // Spawn a valid HQ for colony 0, but try placing with the non-HQ probe as builderEntityId
    spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const nonHqBuilderCheck = validateHubPlacement(state, {
      colonyId: 0,
      q: 2,
      r: 0,
      builderEntityId: probeId,
    });
    expect(nonHqBuilderCheck.ok).toBe(false);
    expect(nonHqBuilderCheck.reason).toBe('worker_tier_locked');

    // Place first Hub with HQ -> succeeds
    host.submit(mkCmd('placeBuilding', { building: 'commandHub', q: 2, r: 0 }, 0));
    expect(host.step(1).outcomes[0]?.code).toBeUndefined();
    expect(hasColonyHub(state, 0)).toBe(true);

    // Attempt to place a second Hub for colony 0 -> rejects with site_blocked
    const secondCheck = validateHubPlacement(state, { colonyId: 0, q: -3, r: 0 });
    expect(secondCheck.ok).toBe(false);
    expect(secondCheck.reason).toBe('site_blocked');

    host.submit(mkCmd('placeBuilding', { building: 'commandHub', q: -3, r: 0 }, 0));
    expect(host.step(1).outcomes[0]?.code).toBe('site_blocked');
  });

  it('starts Hub entity in ENTITY_STATE.constructing when all 9 footprint tiles are already Prepared', () => {
    const host = createW01Host();
    const state = host.state;
    spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const idx = hexIndex(state.grid.radius);

    for (const pos of getBuildingFootprintTiles(3, 0, 3)) {
      setTilePrep(state.grid, idx.indexOf(pos.q, pos.r), PREP.prepared);
    }

    host.submit(mkCmd('placeBuilding', { building: 'commandHub', q: 3, r: 0 }, 0));
    expect(host.step(1).outcomes[0]?.code).toBeUndefined();

    const orders = getConstructionOrders(state, 0);
    expect(orders).toHaveLength(1);
    expect(orders[0]?.status).toBe('in_progress');
    expect(orders[0]?.preparedTiles).toBe(9);
    const hubRow = rowOf(state.entities, orders[0]!.entityId);
    expect(state.entities.cols.state[hubRow]).toBe(ENTITY_STATE.constructing);
  });
});
