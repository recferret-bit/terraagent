import { describe, expect, it } from 'vitest';
import { eventDef, parseWaves } from '@terra/contracts';
import {
  applyDiff,
  claimTerritoryRadius,
  createPlanet,
  extractTileChanges,
  getColonyCaps,
  getColonyStock,
  getConstructionOrders,
  getHubFootprintTiles,
  hexDistance,
  hexIndex,
  placeBuildingOrder,
  PREP,
  setColonyStock,
  setTilePrep,
  SimHost,
  spawnColonyLanding,
  spawnHqUnit,
  systemActor,
  treasury,
  unrecorded,
  type PlanetState,
  type SimCommand,
} from '../../src';

let cmdSeq = 0;
function mkCmd(kind: string, args: unknown, colonyIndex: number | null = 0, prefix = 'tc'): SimCommand {
  return { colonyIndex, source: 'player', commandId: `${prefix}_${++cmdSeq}`, kind, args };
}

function createW01Host(radius = 20): SimHost {
  const host = new SimHost({ flags: parseWaves('..01') });
  host.load(createPlanet({ type: 'flat', seed: 'territory-claim-test', radius }));
  return host;
}

function prepareHubSite(host: SimHost, centerQ: number, centerR: number): void {
  const state = host.state;
  const idx = hexIndex(state.grid.radius);
  for (const pos of getHubFootprintTiles(centerQ, centerR)) {
    setTilePrep(state.grid, idx.indexOf(pos.q, pos.r), PREP.prepared);
  }
}

function verifyOverlappingDisks(
  state: PlanetState,
  expectedColony0Anchors: number,
): { overlapFrozenCount: number; colony0OwnedCount: number } {
  const hex = hexIndex(state.grid.radius);
  const ownerLayer = state.grid.layers.owner as Int8Array;
  const anchorsLayer = state.grid.layers.anchors as Uint8Array;
  let overlapFrozenCount = 0;
  let colony0OwnedCount = 0;

  for (let i = 0; i < hex.count; i++) {
    const q = hex.q[i];
    const r = hex.r[i];
    const inColony0R10 = hexDistance(3, 0, q, r) <= 10;
    const inColony1R6 = hexDistance(12, 0, q, r) <= 6;

    if (inColony1R6) {
      expect(ownerLayer[i]).toBe(1);
      expect(anchorsLayer[i]).toBe(1);
      if (inColony0R10) overlapFrozenCount++;
    } else if (inColony0R10) {
      expect(ownerLayer[i]).toBe(0);
      expect(anchorsLayer[i]).toBe(expectedColony0Anchors);
      colony0OwnedCount++;
    } else {
      expect(ownerLayer[i]).toBe(-1);
      expect(anchorsLayer[i]).toBe(0);
    }
  }
  return { overlapFrozenCount, colony0OwnedCount };
}

describe('W01-17: Territory claim R 10 & immutable border collision (SIM-G-TER)', () => {
  it('acceptance: completing a Hub next to a neighbour border leaves the shared border unchanged (frozen) and claims the rest of R 10', () => {
    const host = createW01Host(20);
    const state = host.state;
    const hex = hexIndex(state.grid.radius);
    const ownerLayer = state.grid.layers.owner as Int8Array;
    const anchorsLayer = state.grid.layers.anchors as Uint8Array;

    // 1. Pre-claim neighbour colony 1 territory at (12, 0) with radius 6
    const neighbourClaim = claimTerritoryRadius(state, {
      colonyId: 1,
      q: 12,
      r: 0,
      radius: 6,
      tick: 0,
    });
    expect(neighbourClaim.claimedCount).toBe(127); // 3 * 6 * 7 + 1 = 127 hexes in R=6 disc
    expect(neighbourClaim.anchoredCount).toBe(0);
    expect(neighbourClaim.frozenCount).toBe(0);

    for (let i = 0; i < hex.count; i++) {
      if (ownerLayer[i] === 1) expect(anchorsLayer[i]).toBe(1);
    }

    // 2. Spawn colony 0 HQ, prepare 3x3 Hub site at (3, 0), and complete Hub construction
    spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    setColonyStock(state, 0, {
      'metals.t1': 600,
      'minerals.t1': 350,
      'bio.biomass': 200,
      'bio.water': 200,
    });
    prepareHubSite(host, 3, 0);

    const placeRes = placeBuildingOrder(state, { colonyId: 0, q: 3, r: 0, buildingKind: 'commandHub' });
    expect(placeRes.ok).toBe(true);

    // 100 ticks (20.0 s at 1.5x HQ workRate) completes the Hub
    host.step(100);
    expect(getConstructionOrders(state, 0)[0]?.status).toBe('completed');

    // 3. Verify territory ownership across the entire grid
    const { overlapFrozenCount, colony0OwnedCount } = verifyOverlappingDisks(state, 1);
    expect(overlapFrozenCount).toBeGreaterThan(0);
    expect(colony0OwnedCount + overlapFrozenCount).toBe(331); // 3 * 10 * 11 + 1 = 331 hexes in R=10 disc

    // 4. Adding a second anchor on colony 0's territory increments anchors to 2 on own tiles while keeping colony 1 frozen
    const secondAnchor = claimTerritoryRadius(state, {
      colonyId: 0,
      q: 3,
      r: 0,
      radius: 10,
      tick: host.tick,
    });
    expect(secondAnchor.claimedCount).toBe(0);
    expect(secondAnchor.anchoredCount).toBe(colony0OwnedCount);
    expect(secondAnchor.frozenCount).toBe(overlapFrozenCount);
    verifyOverlappingDisks(state, 2);
  });
});

describe('W01-17: Colony stats (storage cap 500, supply cap 10, Founder Core +8 E/s) & colonyFounded event', () => {
  it('updates colony caps, supplyCap, founderCoreEPerS, status, and emits schema-valid colonyFounded on Hub completion', () => {
    const host = createW01Host(20);
    const state = host.state;

    spawnColonyLanding(state, {
      colonyId: 0,
      colonyIdStr: 'col_0',
      playerId: 'plr_founder_1',
      name: 'Horizon One',
      q: 0,
      r: 0,
    });
    host.submit({ colonyIndex: 0, source: 'dev', commandId: 'land_now', kind: 'dev.land', args: {} });
    host.step(1);

    expect(state.colonies[0]?.status).toBe('founding');
    prepareHubSite(host, 3, 0);

    host.submit(mkCmd('placeBuilding', { building: 'commandHub', q: 3, r: 0 }, 0, 'hub_found'));
    const allEvents = [];
    const tickBeforeComplete = host.tick + 99;
    const replica = host.clone();

    for (let i = 0; i < 100; i++) {
      if (host.tick === tickBeforeComplete) replica.load(host.snapshot());
      allEvents.push(...host.step(1).events);
    }

    const order = getConstructionOrders(state, 0)[0]!;
    expect(order.status).toBe('completed');

    const col = state.colonies[0]!;
    expect(col.status).toBe('active');
    expect(col.caps).toEqual({ metals: 500, minerals: 500, energy: 0, bio: 500, item: 0 });
    expect(getColonyCaps(state, 0)).toEqual({ metals: 500, minerals: 500, energy: 0, bio: 500, item: 0 });
    expect(col.supplyCap).toBe(10);
    expect(col.founderCoreEPerS).toBe(8);
    expect(col.powerGenEPerS).toBe(8);
    expect(col.hubEntityId).toBe(order.entityId);

    const capped = treasury(state, unrecorded(state.meta.tick)).add({
      colony: 0,
      amounts: { 'metals.t1': 500, 'minerals.t1': 500, 'bio.biomass': 500 },
      reason: 'admin.correction',
      actor: systemActor('admin'),
      clampToCap: true,
    });
    expect(capped.ok && capped.overflow).toEqual({ 'metals.t1': 400, 'minerals.t1': 250, 'bio.biomass': 300 });
    const cappedStock = getColonyStock(state, 0);
    expect(cappedStock['metals.t1']).toBe(500);
    expect(cappedStock['minerals.t1']).toBe(500);
    expect(cappedStock['bio.biomass'] + cappedStock['bio.water']).toBe(500);

    const foundedEvents = allEvents.filter((e) => e.kind === 'colonyFounded');
    expect(foundedEvents).toHaveLength(1);
    expect(foundedEvents[0].colonyIds).toEqual(['col_0']);
    expect(foundedEvents[0].data).toEqual({
      colonyId: 'col_0',
      playerId: 'plr_founder_1',
      hubId: order.entityId,
      q: 3,
      r: 0,
    });
    expect(eventDef('colonyFounded').data.safeParse(foundedEvents[0].data).success).toBe(true);

    const diff = host.diffSince(tickBeforeComplete);
    const tileChanges = extractTileChanges(diff);
    expect(tileChanges.length).toBe(331);
    expect(tileChanges.every((t) => t.owner === 0 && t.anchors === 1)).toBe(true);

    applyDiff(replica.state, diff);
    expect(replica.state).toEqual(host.state);
  });
});
