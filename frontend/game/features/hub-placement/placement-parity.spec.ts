import { parseWaves } from '@terra/contracts';
import {
  buildPipeline,
  createPlanet,
  evaluatePlacement,
  findPlacementSite,
  placementWorldFromState,
  restore,
  SimHost,
  snapshot,
  spawnHqUnit,
  startBuildingConstruction,
  view,
  type BalanceOverrides,
  type CompiledDataLike,
  type PlanetType,
} from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { packView, unpackView } from '../../store/replica/viewCodec';
import { evaluateHubGhost, ghostPlacementWorld } from './GhostEvaluator';

/**
 * Client/server parity: the client ghost runs the same `evaluatePlacement` as the `placeBuilding` handler, on the replica
 * view that crossed the real client path (welcome snapshot `{ forClient: true }` → replica → Worker → main thread view
 * codec). For every tile of a generated planet (forest, rock, water, deposits, dune relief) both must agree, with the
 * same balance data on both sides.
 */
function checkEveryTile(planetType: PlanetType, radius: number, overrides?: BalanceOverrides): { invalid: number; codes: Set<string>; blocks: Set<string> } {
  const host = new SimHost(buildPipeline(parseWaves('..01').list, overrides ?? {}));
  host.load(createPlanet({ id: 'pl', seed: `parity-${planetType}`, type: 'temperate', planetType, radius }));
  spawnHqUnit(host.state, { owner: 0, q: 0, r: 0 });
  const data: CompiledDataLike = host.pipeline.config.data;
  const replica = restore(snapshot(host.state, { forClient: true }));
  const { view: wire } = packView(view(replica), true);
  const clientView = unpackView(wire);
  expect(clientView.tiles?.deposit).toBeDefined();
  expect(clientView.tiles?.height).toBeDefined();

  const serverWorld = placementWorldFromState(host.state);
  const clientWorld = ghostPlacementWorld(clientView);
  const R = host.state.grid.radius;
  const codes = new Set<string>(), blocks = new Set<string>();
  let invalid = 0;
  for (let r = -R; r <= R; r++) {
    for (let q = -R; q <= R; q++) {
      if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) > R) continue;
      const s = evaluatePlacement(serverWorld, { colonyId: 0, q, r, building: 'commandHub', data });
      const c = evaluatePlacement(clientWorld, { colonyId: 0, q, r, building: 'commandHub', data });
      expect([c.ok, c.code, c.block]).toEqual([s.ok, s.code, s.block]);
      const g = evaluateHubGhost(clientView, { colonyId: 0, q, r, data });
      expect([g.valid, g.reasonCode]).toEqual([s.ok, s.code]);
      if (!s.ok) invalid++;
      if (s.code) codes.add(s.code);
      if (s.block) blocks.add(s.block);
    }
  }
  return { invalid, codes, blocks };
}

describe('placement parity: authoritative state vs client replica view', () => {
  for (const planetType of ['desert', 'ocean', 'temperate'] as const) {
    it(`${planetType} (radius 14): ghost verdict and reason equal the host verdict for every tile`, () => {
      const { invalid, codes } = checkEveryTile(planetType, 14);
      expect(invalid).toBeGreaterThan(0);
      expect(codes.has('terrain_unbuildable')).toBe(true);
    });
  }

  it('desert (radius 56, full relief): agrees on every tile, including the uneven-ground rule', () => {
    const { blocks } = checkEveryTile('desert', 56);
    expect(blocks.has('uneven')).toBe(true);
    expect(blocks.has('rock')).toBe(true);
  });

  it('with balance overrides on both sides (tuned hub.t1): still agrees on every tile', () => {
    const { blocks } = checkEveryTile('temperate', 14, { hub: { t1: { allowUnclaimedPlacement: false } } });
    expect(blocks.has('unclaimed')).toBe(true);
  });
});

describe('placement parity: second colony, an existing Hub, a colony without HQ (FF-14)', () => {
  it('client and host agree on every tile for the Hub owner and for a colony with no HQ', () => {
    const host = new SimHost(buildPipeline(parseWaves('..01').list, {}));
    host.load(createPlanet({ id: 'pl', seed: 'parity-two', type: 'temperate', planetType: 'temperate', radius: 14 }));
    spawnHqUnit(host.state, { owner: 0, q: 0, r: 0 });
    const data: CompiledDataLike = host.pipeline.config.data;
    const site = findPlacementSite(placementWorldFromState(host.state), { colonyId: 0, q: 0, r: 0, building: 'commandHub', data }, 6);
    expect(site).not.toBeNull();
    host.submit({ colonyIndex: 0, source: 'player', commandId: 'hub', kind: 'placeBuilding', args: { building: 'commandHub', ...site } });
    expect(host.step(1).outcomes[0]?.code).toBeUndefined();

    const { view: wire } = packView(view(restore(snapshot(host.state, { forClient: true }))), true);
    const clientWorld = ghostPlacementWorld(unpackView(wire));
    const serverWorld = placementWorldFromState(host.state);
    const blocks = new Set<string>();
    const R = host.state.grid.radius;
    for (const colonyId of [0, 1]) {
      for (let r = -R; r <= R; r++) {
        for (let q = -R; q <= R; q++) {
          if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) > R) continue;
          const s = evaluatePlacement(serverWorld, { colonyId, q, r, building: 'commandHub', data });
          const c = evaluatePlacement(clientWorld, { colonyId, q, r, building: 'commandHub', data });
          expect([colonyId, q, r, c.ok, c.code, c.block]).toEqual([colonyId, q, r, s.ok, s.code, s.block]);
          if (s.block) blocks.add(s.block);
        }
      }
    }
    expect(blocks.has('hubExists')).toBe(true);
    expect(blocks.has('noBuilder')).toBe(true);
  });
});

describe('placement parity: W03 power zone (Hub, built pylon, queued pylon order)', () => {
  it('client and host agree on every tile for a Solar and a Power Pylon, out-of-zone rejects included', () => {
    const host = new SimHost(buildPipeline(parseWaves('..03').list, {}));
    host.load(createPlanet({ id: 'pl', seed: 'parity-zone', type: 'flat', planetType: 'temperate', radius: 16 }));
    spawnHqUnit(host.state, { owner: 0, q: -2, r: 3 });
    const data: CompiledDataLike = host.pipeline.config.data;
    startBuildingConstruction(host.state, { owner: 0, building: 'commandHub', q: 0, r: 0, instant: true, costOverride: {}, tick: 0 });
    startBuildingConstruction(host.state, { owner: 0, building: 'pylon', q: 6, r: 0, instant: true, costOverride: {}, tick: 0 });
    const order = { taskId: 'p-north', task: { kind: 'build', building: 'pylon', q: 0, r: -6 } };
    host.submit({ colonyIndex: 0, source: 'player', commandId: 'p', kind: 'enqueueTask', args: order });
    expect(host.step(1).outcomes[0]?.code).toBeUndefined();

    const { view: wire } = packView(view(restore(snapshot(host.state, { forClient: true }))), true);
    const clientWorld = ghostPlacementWorld(unpackView(wire));
    const serverWorld = placementWorldFromState(host.state);
    expect(clientWorld.plannedSites).toEqual(serverWorld.plannedSites);
    const codes = new Set<string>();
    const R = host.state.grid.radius;
    for (const building of ['solar', 'pylon']) {
      for (let r = -R; r <= R; r++) {
        for (let q = -R; q <= R; q++) {
          if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) > R) continue;
          const s = evaluatePlacement(serverWorld, { colonyId: 0, q, r, building, requireBuilder: false, data });
          const c = evaluatePlacement(clientWorld, { colonyId: 0, q, r, building, requireBuilder: false, data });
          expect([building, q, r, c.ok, c.code, c.block]).toEqual([building, q, r, s.ok, s.code, s.block]);
          if (s.code) codes.add(s.code);
        }
      }
    }
    expect(codes.has('outside_power_zone')).toBe(true);
    // the queued pylon at (0, -6) extends the zone on both sides
    expect(evaluatePlacement(clientWorld, { colonyId: 0, q: 0, r: -10, building: 'solar', requireBuilder: false, data }).ok).toBe(true);
  });
});
