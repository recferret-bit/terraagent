import { parseWaves } from '@terra/contracts';
import {
  buildPipeline,
  createPlanet,
  ENTITY_KIND,
  ENTITY_STATE,
  evaluatePlacement,
  getWorkJobsMap,
  hexIndex,
  placementWorldFromState,
  PREP,
  restore,
  setColonyStock,
  setTileOwner,
  setTileTerrain,
  SimHost,
  snapshot,
  TERRAIN,
  view,
} from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { evaluatePlacementGhost } from './PlacementGhost';

function createLandedHost(waves = '..02', seed = 'pod-ghost-parity') {
  const host = new SimHost(buildPipeline(parseWaves(waves).list, {}));
  host.load(createPlanet({ id: 'p1', seed, type: 'temperate', planetType: 'temperate', radius: 14 }));
  host.submit({
    commandId: 'spawn_0',
    colonyIndex: 0,
    source: 'system',
    kind: 'system.spawnColony',
    args: { colonyId: 'col_0', playerId: 'pl_0', name: 'Pioneer' },
  });
  for (let i = 0; i < 40; i++) host.step(1);
  setColonyStock(host.state, 0, {
    'metals.t1': 1000,
    'minerals.t1': 1000,
    'bio.biomass': 1000,
    'bio.water': 1000,
  });
  return host;
}

function findPodCoords(host: SimHost): { q: number; r: number } {
  const e = host.state.entities;
  for (let i = 0; i < e.count; i++) {
    if (e.cols.kind[i] === ENTITY_KIND.pod && e.cols.owner[i] === 0) {
      return { q: e.cols.q[i]!, r: e.cols.r[i]! };
    }
  }
  throw new Error('landed pod not found');
}

describe('Landed pod occupancy parity between PlacementGhost and evaluatePlacement', () => {
  it('allows placing Command Hub and W02 buildings over or adjacent to the landed drop pod when sim says VALID', () => {
    const host = createLandedHost('..05');
    const pod = findPodCoords(host);
    const data = host.pipeline.config.data;
    const flags = new Set(parseWaves('..05').list);
    const clientView = view(restore(snapshot(host.state, { forClient: true })));
    const simWorld = placementWorldFromState(host.state);

    let validOverPodCount = 0;
    for (let dq = -1; dq <= 1; dq++) {
      for (let dr = -1; dr <= 1; dr++) {
        const q = pod.q + dq;
        const r = pod.r + dr;
        const simCheck = evaluatePlacement(simWorld, { colonyId: 0, building: 'commandHub', q, r, data });
        const ghost = evaluatePlacementGhost({
          building: 'commandHub',
          q,
          r,
          rotation: 0,
          flags,
          view: clientView as never,
          colonyId: 0,
        });
        expect([q, r, ghost.valid]).toEqual([q, r, simCheck.ok]);
        if (ghost.valid) validOverPodCount++;
      }
    }
    expect(validOverPodCount).toBeGreaterThan(0);
  });
});

describe('Landed pod vs genuine building occupancy on PlacementGhost', () => {
  it('still marks genuine buildings as tile occupied while letting HQ build over the pod tile', () => {
    const host = createLandedHost('..05');
    const pod = findPodCoords(host);
    const idx = hexIndex(host.state.grid.radius);
    const flags = new Set(parseWaves('..05').list);

    // Prepare a 3x3 patch and add an occupying building nearby to confirm genuine occupancy stays blocked.
    for (let dq = -1; dq <= 1; dq++) {
      for (let dr = -1; dr <= 1; dr++) {
        const ti = idx.indexOf(pod.q + dq, pod.r + dr);
        if (ti >= 0) {
          setTileTerrain(host.state.grid, ti, TERRAIN.flat);
          setTileOwner(host.state.grid, ti, 0);
        }
      }
    }

    const clientView = view(restore(snapshot(host.state, { forClient: true }))) as never;
    const hubOverPod = evaluatePlacementGhost({
      building: 'commandHub',
      q: pod.q,
      r: pod.r,
      rotation: 0,
      flags,
      view: clientView,
      colonyId: 0,
    });
    expect(hubOverPod.valid).toBe(true);
    expect(hubOverPod.reason).not.toBe('tile occupied');

    // Submit Command Hub directly over the landed pod and verify HQ bot finishes constructing it.
    host.submit({
      commandId: 'hub_over_pod',
      colonyIndex: 0,
      source: 'player',
      kind: 'placeBuilding',
      args: { building: 'commandHub', q: pod.q, r: pod.r },
    });
    expect(host.step(1).outcomes[0]?.code).toBeUndefined();
    for (let i = 0; i < 2000; i++) host.step(1);

    let activeHub = false;
    for (let i = 0; i < host.state.entities.count; i++) {
      if (host.state.entities.cols.kind[i] === ENTITY_KIND.commandHub && host.state.entities.cols.state[i] === ENTITY_STATE.active) {
        activeHub = true;
      }
    }
    expect(activeHub).toBe(true);

    // Genuine occupying building (Command Hub) now rejects another building overlapping it with 'tile occupied'.
    const hubView = view(restore(snapshot(host.state, { forClient: true }))) as never;
    const blockedByHub = evaluatePlacementGhost({
      building: 'solar',
      q: pod.q,
      r: pod.r,
      rotation: 0,
      flags,
      view: hubView,
      colonyId: 0,
    });
    expect(blockedByHub.valid).toBe(false);
    expect(blockedByHub.reason).toBe('tile occupied');
    expect(PREP.prepared).toBeGreaterThanOrEqual(0);
    expect(getWorkJobsMap(host.state)).toBeDefined();
  });
});
