import { parseWaves } from '@terra/contracts';
import {
  buildPipeline,
  createPlanet,
  ENTITY_KIND,
  ENTITY_STATE,
  evaluatePlacement,
  getLandingPods,
  getWorkJobsMap,
  hexDistance,
  hexIndex,
  inHex,
  insertRow,
  placementWorldFromState,
  PREP,
  setColonyStock,
  setTileOwner,
  SimHost,
  TERRAIN,
  type WorkJobRecord,
} from '@terra/sim';
import { describe, expect, it } from 'vitest';

function createBootedHost(waves = '..05', seed = 'pod-tf-spec', land = true) {
  const host = new SimHost(buildPipeline(parseWaves(waves).list, {}));
  host.load(createPlanet({ id: 'p1', seed, type: 'temperate', planetType: 'temperate', radius: 28 }));
  host.submit({
    commandId: 'spawn_0',
    colonyIndex: 0,
    source: 'system',
    kind: 'system.spawnColony',
    args: { colonyId: 'col_0', playerId: 'pl_0', name: 'Frontier' },
  });
  if (land) {
    for (let i = 0; i < 40; i++) host.step(1);
  }
  setColonyStock(host.state, 0, {
    'metals.t1': 1000,
    'minerals.t1': 1000,
    'bio.biomass': 1000,
    'bio.water': 1000,
  });
  return host;
}

function findEntityRow(host: SimHost, kind: number, owner = 0): number {
  const e = host.state.entities;
  for (let r = 0; r < e.count; r++) {
    if (e.cols.kind[r] === kind && e.cols.owner[r] === owner) return r;
  }
  return -1;
}

function jobsMap(host: SimHost): Record<string, WorkJobRecord> {
  return getWorkJobsMap(host.state);
}

describe('Terraforming the landed drop pod (pre-Hub & post-Hub)', () => {
  it('allows terraforming a landed pod pre-Hub, prepares the hex, removes the pod, and refuses a second terraform', () => {
    const host = createBootedHost('..05', 'pod-tf-prehub', true);
    const podRow = findEntityRow(host, ENTITY_KIND.pod, 0);
    expect(podRow).toBeGreaterThanOrEqual(0);
    const pq = host.state.entities.cols.q[podRow]!;
    const pr = host.state.entities.cols.r[podRow]!;
    const podId = host.state.entities.cols.id[podRow]!;

    host.submit({
      commandId: 'tf_pod_1',
      colonyIndex: 0,
      source: 'player',
      kind: 'enqueueTask',
      args: { terraform: { op: 'work', intent: 'terraform', tiles: [{ q: pq, r: pr }] } },
    });
    const res1 = host.step(1);
    expect(res1.outcomes[0]?.code).toBeUndefined();
    const job = jobsMap(host).tf_pod_1;
    expect(job).toMatchObject({ mode: 'terraform', terrainKey: 'pod', targetEntityId: podId, q: pq, r: pr });

    // Re-queuing the same pod tile while work is open is rejected cleanly as already_queued.
    host.submit({
      commandId: 'tf_pod_dup',
      colonyIndex: 0,
      source: 'player',
      kind: 'enqueueTask',
      args: { terraform: { op: 'work', intent: 'terraform', tiles: [{ q: pq, r: pr }] } },
    });
    expect(host.step(1).outcomes[0]?.code).toBe('already_queued');

    for (let i = 0; i < 200; i++) host.step(1);

    expect(findEntityRow(host, ENTITY_KIND.pod, 0)).toBe(-1);
    const idx = hexIndex(host.state.grid.radius).indexOf(pq, pr);
    expect(host.state.grid.layers.terrain[idx]).toBe(TERRAIN.flat);
    expect(host.state.grid.layers.prep[idx]).toBe(PREP.prepared);
    expect(getLandingPods(host.state).some((p) => p.colonyId === 0 && p.deployed)).toBe(true);

    // Repeating terraform on the cleared, prepared tile is now a no-op reject.
    host.submit({
      commandId: 'tf_pod_again',
      colonyIndex: 0,
      source: 'player',
      kind: 'enqueueTask',
      args: { terraform: { op: 'work', intent: 'terraform', tiles: [{ q: pq, r: pr }] } },
    });
    expect(host.step(1).outcomes[0]?.code).toBe('already_terraformed');
  });

  it('enforces landing distance and lets HQ build Hub after terraforming the pod away pre-Hub', () => {
    const host = createBootedHost('..05', 'pod-tf-prehub', true);
    const podRow = findEntityRow(host, ENTITY_KIND.pod, 0);
    const pq = host.state.entities.cols.q[podRow]!;
    const pr = host.state.entities.cols.r[podRow]!;

    host.submit({
      commandId: 'tf_pod_build',
      colonyIndex: 0,
      source: 'player',
      kind: 'enqueueTask',
      args: { terraform: { op: 'work', intent: 'terraform', tiles: [{ q: pq, r: pr }] } },
    });
    for (let i = 0; i < 200; i++) host.step(1);
    expect(findEntityRow(host, ENTITY_KIND.pod, 0)).toBe(-1);

    const idxMap = hexIndex(host.state.grid.radius);
    let farTile = { q: 0, r: 0 };
    for (let i = 0; i < idxMap.count; i++) {
      const q = idxMap.q[i]!;
      const r = idxMap.r[i]!;
      if (inHex(q, r, host.state.grid.radius) && hexDistance(q, r, pq, pr) === 15) {
        farTile = { q, r };
        break;
      }
    }
    const farSite = evaluatePlacement(placementWorldFromState(host.state), {
      colonyId: 0,
      building: 'commandHub',
      q: farTile.q,
      r: farTile.r,
      data: host.pipeline.config.data,
    });
    expect(farSite.ok).toBe(false);
    expect(farSite.block).toBe('farFromLanding');

    host.submit({
      commandId: 'hub_after_pod_tf',
      colonyIndex: 0,
      source: 'player',
      kind: 'placeBuilding',
      args: { building: 'commandHub', q: pq, r: pr },
    });
    expect(host.step(1).outcomes[0]?.code).toBeUndefined();
    for (let i = 0; i < 6000; i++) host.step(1);
    const hubRow = findEntityRow(host, ENTITY_KIND.commandHub, 0);
    expect(hubRow).toBeGreaterThanOrEqual(0);
    expect(host.state.entities.cols.state[hubRow]).toBe(ENTITY_STATE.active);
  });
});

describe('Terraforming the landed drop pod: rejections & post-Hub', () => {
  it('rejects terraforming a descending pod, a foreign pod, and an occupied pod tile', () => {
    // 1) Descending pod before landing completes
    const descendingHost = createBootedHost('..05', 'pod-tf-desc', false);
    descendingHost.step(1);
    const descPodRow = findEntityRow(descendingHost, ENTITY_KIND.pod, 0);
    expect(descendingHost.state.entities.cols.state[descPodRow]).toBe(ENTITY_STATE.descending);
    const dq = descendingHost.state.entities.cols.q[descPodRow]!;
    const dr = descendingHost.state.entities.cols.r[descPodRow]!;
    descendingHost.submit({
      commandId: 'tf_desc',
      colonyIndex: 0,
      source: 'player',
      kind: 'enqueueTask',
      args: { terraform: { op: 'work', intent: 'terraform', tiles: [{ q: dq, r: dr }] } },
    });
    expect(descendingHost.step(1).outcomes[0]?.code).toBe('already_terraformed');
    expect(findEntityRow(descendingHost, ENTITY_KIND.pod, 0)).toBeGreaterThanOrEqual(0);

    // 2) Occupied pod tile (Command Hub built on top of pod) -> site_blocked
    const occupiedHost = createBootedHost('..05', 'pod-tf-occ', true);
    const podRow = findEntityRow(occupiedHost, ENTITY_KIND.pod, 0);
    const pq = occupiedHost.state.entities.cols.q[podRow]!;
    const pr = occupiedHost.state.entities.cols.r[podRow]!;
    occupiedHost.submit({
      commandId: 'hub_over',
      colonyIndex: 0,
      source: 'player',
      kind: 'placeBuilding',
      args: { building: 'commandHub', q: pq, r: pr },
    });
    expect(occupiedHost.step(1).outcomes[0]?.code).toBeUndefined();
    for (let i = 0; i < 600; i++) occupiedHost.step(1);
    expect(findEntityRow(occupiedHost, ENTITY_KIND.commandHub, 0)).toBeGreaterThanOrEqual(0);
    occupiedHost.submit({
      commandId: 'tf_under_hub',
      colonyIndex: 0,
      source: 'player',
      kind: 'enqueueTask',
      args: { terraform: { op: 'work', intent: 'terraform', tiles: [{ q: pq, r: pr }] } },
    });
    expect(occupiedHost.step(1).outcomes[0]?.code).toBe('site_blocked');

    // 3) Foreign landed pod on foreign tile -> not_own_territory
    const fRow = insertRow(occupiedHost.state.entities, occupiedHost.state.meta.nextEntityId++, 1);
    occupiedHost.state.entities.cols.kind[fRow] = ENTITY_KIND.pod;
    occupiedHost.state.entities.cols.owner[fRow] = 1;
    occupiedHost.state.entities.cols.q[fRow] = pq + 4;
    occupiedHost.state.entities.cols.r[fRow] = pr;
    occupiedHost.state.entities.cols.hp[fRow] = 500;
    occupiedHost.state.entities.cols.hpMax[fRow] = 500;
    occupiedHost.state.entities.cols.state[fRow] = ENTITY_STATE.idle;
    const fIdx = hexIndex(occupiedHost.state.grid.radius).indexOf(pq + 4, pr);
    setTileOwner(occupiedHost.state.grid, fIdx, 1);

    occupiedHost.submit({
      commandId: 'tf_foreign_pod',
      colonyIndex: 0,
      source: 'player',
      kind: 'enqueueTask',
      args: { terraform: { op: 'work', intent: 'terraform', tiles: [{ q: pq + 4, r: pr }] } },
    });
    expect(occupiedHost.step(1).outcomes[0]?.code).toBe('not_own_territory');
  });

  it('allows terraforming own landed pod post-Hub even when outside claimed territory', () => {
    const host = createBootedHost('..05', 'pod-tf-unclaimed-posthub', true);
    const podRow = findEntityRow(host, ENTITY_KIND.pod, 0);
    const pq = host.state.entities.cols.q[podRow]!;
    const pr = host.state.entities.cols.r[podRow]!;
    const podIdx = hexIndex(host.state.grid.radius).indexOf(pq, pr);

    // Simulate Hub placed far enough away or tile unclaimed while own Hub is active.
    const hubRow = insertRow(host.state.entities, host.state.meta.nextEntityId++, 1);
    host.state.entities.cols.kind[hubRow] = ENTITY_KIND.commandHub;
    host.state.entities.cols.owner[hubRow] = 0;
    host.state.entities.cols.q[hubRow] = pq + 6;
    host.state.entities.cols.r[hubRow] = pr;
    host.state.entities.cols.hp[hubRow] = 1000;
    host.state.entities.cols.hpMax[hubRow] = 1000;
    host.state.entities.cols.state[hubRow] = ENTITY_STATE.active;
    expect(host.state.grid.layers.owner[podIdx]).toBe(-1);

    host.submit({
      commandId: 'tf_pod_post',
      colonyIndex: 0,
      source: 'player',
      kind: 'enqueueTask',
      args: { terraform: { op: 'work', intent: 'terraform', tiles: [{ q: pq, r: pr }] } },
    });
    expect(host.step(1).outcomes[0]?.code).toBeUndefined();
    for (let i = 0; i < 200; i++) host.step(1);
    expect(findEntityRow(host, ENTITY_KIND.pod, 0)).toBe(-1);
  });
});
