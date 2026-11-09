import { DEPOSIT_CODES, TERRAIN_CODES } from '@terra/contracts/tiles/codes';
import { tileXZ, type HexTerrain } from '@terra/render/planets/hex';
import { ENTITY_KIND, ENTITY_STATE } from '@terra/sim';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { ClientTiles, ClientView } from '../../store/replica/viewCodec';
import type { EntityMeshRecord } from './EntityMeshes';
import { buildActiveWorkSites, computeBotToolOrigins, computeWorkTarget } from './workTargetResolver';

function makeRecord(overrides: Partial<EntityMeshRecord> & { id: number; kind: number }): EntityMeshRecord {
  const mesh = new THREE.Mesh();
  mesh.position.set(0, 0, 0);
  return {
    id: overrides.id,
    kind: overrides.kind,
    owner: overrides.owner ?? 0,
    q: overrides.q ?? 0,
    r: overrides.r ?? 0,
    x: overrides.x ?? 0,
    y: overrides.y ?? 0,
    rot: overrides.rot ?? 0,
    hp: overrides.hp ?? 100,
    hpMax: overrides.hpMax ?? 100,
    state: overrides.state ?? ENTITY_STATE.working,
    progress: overrides.progress ?? 0.5,
    buildStage: overrides.buildStage ?? 1,
    mesh,
    targetPos: overrides.targetPos ?? new THREE.Vector3(),
    targetYaw: overrides.targetYaw ?? 0,
    walk: overrides.walk ?? 0,
    work: overrides.work ?? 1,
    track: overrides.track ?? ({} as EntityMeshRecord['track']),
    trackMoving: overrides.trackMoving ?? false,
  };
}

describe('workTargetResolver: workJobs & orientation', () => {
  it('resolves workJobs repair and terrainKey targets and rotates working bots toward the target', () => {
    const worker = makeRecord({ id: 1, kind: ENTITY_KIND.hq, q: 0, r: 0, state: ENTITY_STATE.working });
    const targetBuilding = makeRecord({ id: 2, kind: ENTITY_KIND.commandHub, q: 2, r: 0, state: ENTITY_STATE.active });
    targetBuilding.mesh.position.set(3.4, 0, 0);

    const records = new Map<number, EntityMeshRecord>([
      [1, worker],
      [2, targetBuilding],
    ]);

    const repairView = {
      planet: { radius: 4 },
      blobs: {
        workJobs: {
          byId: {
            j1: { workerEntityId: 1, targetEntityId: 2, mode: 'repair', q: 2, r: 0 },
          },
        },
      },
    } as unknown as ClientView;

    const repairSites = buildActiveWorkSites({
      records,
      view: repairView,
      tiles: null,
      terrain: null,
      biomeKey: 'oceanForest',
    });
    expect(repairSites).toHaveLength(1);
    expect(repairSites[0].targetKind).toBe('repair');
    expect(repairSites[0].toolOrigins).toHaveLength(2);
    expect(worker.targetYaw).toBeCloseTo(Math.PI / 2, 2);

    const treeView = {
      planet: { radius: 4 },
      blobs: {
        workJobs: {
          byId: {
            j2: { workerEntityId: 1, mode: 'terraform', terrainKey: 'forest', q: 1, r: 0 },
          },
        },
      },
    } as unknown as ClientView;

    const treeSites = buildActiveWorkSites({
      records,
      view: treeView,
      tiles: null,
      terrain: null,
      biomeKey: 'oceanForest',
    });
    expect(treeSites).toHaveLength(1);
    expect(treeSites[0].targetKind).toBe('tree');
  });
});

describe('workTargetResolver: harvest assignments & tile fallbacks', () => {
  it('resolves harvest assignments and tile terrain/deposit codes across biomes', () => {
    const worker = makeRecord({ id: 5, kind: ENTITY_KIND.worker, tier: 1, q: 0, r: 0, state: ENTITY_STATE.harvesting });
    const records = new Map<number, EntityMeshRecord>([[5, worker]]);

    const harvestView = {
      planet: { radius: 2 },
      blobs: {
        harvest: {
          assignments: {
            '5': { entityId: 5, mode: 'harvest', q: 1, r: 0, resourceKey: 'minerals.t1' },
          },
        },
      },
    } as unknown as ClientView;

    const mineralSites = buildActiveWorkSites({
      records,
      view: harvestView,
      tiles: null,
      terrain: null,
      biomeKey: 'forestRock',
    });
    expect(mineralSites).toHaveLength(1);
    expect(mineralSites[0].targetKind).toBe('minerals');

    worker.state = ENTITY_STATE.working;
    worker.q = 0;
    worker.r = 0;
    const tiles: ClientTiles = {
      q: [0],
      r: [0],
      terrain: [TERRAIN_CODES.slope],
      deposit: [DEPOSIT_CODES.none],
    } as unknown as ClientTiles;

    const duneSites = buildActiveWorkSites({
      records,
      view: { planet: { radius: 0 }, blobs: {} } as unknown as ClientView,
      tiles,
      terrain: null,
      biomeKey: 'dune',
    });
    expect(duneSites).toHaveLength(1);
    expect(duneSites[0].targetKind).toBe('dune');
  });
});

describe('workTargetResolver: idle work-decay suppression & terraformTasks', () => {
  it('does not emit a bogus fallback site when a worker transitions to idle while rec.work is still decaying', () => {
    const finishedWorker = makeRecord({
      id: 9,
      kind: ENTITY_KIND.hq,
      q: 0,
      r: 0,
      state: ENTITY_STATE.idle,
      work: 0.85,
    });
    const records = new Map<number, EntityMeshRecord>([[9, finishedWorker]]);
    const sites = buildActiveWorkSites({
      records,
      view: { planet: { radius: 2 }, blobs: {} } as unknown as ClientView,
      tiles: null,
      terrain: null,
      biomeKey: 'oceanForest',
    });
    expect(sites).toHaveLength(0);
  });

  it('resolves terraformTasks op kinds and colony hq.targetQ/R coordinates', () => {
    const hqWorker = makeRecord({ id: 11, kind: ENTITY_KIND.hq, owner: 0, q: 0, r: 0, state: ENTITY_STATE.working });
    const records = new Map<number, EntityMeshRecord>([[11, hqWorker]]);

    const terraformTaskView = {
      planet: { radius: 3 },
      blobs: {
        hq: {
          byColony: {
            '0': { entityId: 11, targetQ: 1, targetR: 0 },
          },
        },
        terraformTasks: {
          byColony: {
            '0': [
              { id: 't1', q: 1, r: 0, op: 'fill' },
            ],
          },
        },
      },
    } as unknown as ClientView;

    const holeSites = buildActiveWorkSites({
      records,
      view: terraformTaskView,
      tiles: null,
      terrain: null,
      biomeKey: 'oceanForest',
    });
    expect(holeSites).toHaveLength(1);
    expect(holeSites[0].targetKind).toBe('hole');
  });

  it('computes computeWorkTarget for units and buildings', () => {
    expect(computeWorkTarget(ENTITY_KIND.hq, ENTITY_STATE.working, true)).toBe(1);
    expect(computeWorkTarget(ENTITY_KIND.worker, ENTITY_STATE.harvesting, false)).toBe(1);
    expect(computeWorkTarget(ENTITY_KIND.worker, ENTITY_STATE.moving, true)).toBe(0);
    expect(computeWorkTarget(ENTITY_KIND.solar, ENTITY_STATE.active, true)).toBe(1);
    expect(computeWorkTarget(ENTITY_KIND.solar, ENTITY_STATE.active, false)).toBe(0);
  });
});

describe('workTargetResolver: multi-hex reach & prop-aligned targets', () => {
  it('places targetPos directly on a rock 1 or 2 hexes away (2m..4m) and aligns HQ hand laser origins with the target', () => {
    const hqWorker = makeRecord({ id: 21, kind: ENTITY_KIND.hq, owner: 0, q: 0, r: 0, state: ENTITY_STATE.working });
    hqWorker.mesh.userData = {
      archetypeId: 'robot.hero',
      uniforms: {
        uTime: { value: 0.4 },
        uWalkWeight: { value: 0 },
        uWorkWeight: { value: 1 },
      },
    };
    const records = new Map<number, EntityMeshRecord>([[21, hqWorker]]);

    // Target rock at (q=2, r=0), which is 2 hexes (4.0m) away from (0,0)
    const [rockX, rockZ] = tileXZ(2, 0);
    expect(Math.hypot(rockX, rockZ)).toBeGreaterThan(3.5);

    const view = {
      planet: { radius: 4 },
      blobs: {
        workJobs: {
          byId: {
            jRock: { workerEntityId: 21, mode: 'break', terrainKey: 'rock', q: 2, r: 0 },
          },
        },
      },
    } as unknown as ClientView;

    const sites = buildActiveWorkSites({
      records,
      view,
      tiles: null,
      terrain: null,
      biomeKey: 'forestRock',
    });

    expect(sites).toHaveLength(1);
    const site = sites[0];
    expect(site.targetKind).toBe('rock');
    // targetPos must be on the rock (within 0.15m pullback), NEVER clamped to 1.35m!
    const distToRock = Math.hypot(site.targetPos[0] - rockX, site.targetPos[2] - rockZ);
    expect(distToRock).toBeLessThanOrEqual(0.15);

    // Mesh rotation and toolOrigins are synchronized to face the rock
    expect(hqWorker.mesh.rotation.y).toBeCloseTo(hqWorker.targetYaw, 5);
    const expectedHandOrigins = computeBotToolOrigins(
      ENTITY_KIND.hq,
      0,
      0,
      0,
      hqWorker.mesh.rotation.y,
      0.4,
      0,
      1,
    );
    expect(site.toolOrigins[0][0]).toBeCloseTo(expectedHandOrigins[0][0], 5);
    expect(site.toolOrigins[0][1]).toBeCloseTo(expectedHandOrigins[0][1], 5);
    expect(site.toolOrigins[0][2]).toBeCloseTo(expectedHandOrigins[0][2], 5);
  });

  it('targets the nearest prop instance on the target hex and falls back to neighbor obstacles when standing on flat ground', () => {
    const hqWorker = makeRecord({ id: 31, kind: ENTITY_KIND.hq, owner: 0, q: 0, r: 0, state: ENTITY_STATE.working });
    // Facing +X (toward q=1, r=0)
    hqWorker.mesh.rotation.y = Math.PI / 2;
    const records = new Map<number, EntityMeshRecord>([[31, hqWorker]]);

    const tiles = {
      indexOf: (q: number, r: number) => (q === 0 && r === 0 ? 0 : q === 1 && r === 0 ? 1 : -1),
      terrain: [TERRAIN_CODES.flat, TERRAIN_CODES.rock],
      deposit: [DEPOSIT_CODES.none, DEPOSIT_CODES.none],
    } as unknown as ClientTiles;

    const [tile1X, tile1Z] = tileXZ(1, 0);
    const propX = tile1X - 0.25;
    const propZ = tile1Z + 0.18;
    const mockTerrain = {
      heightAt: () => 0,
      props: {
        instancesForTile: (idx: number) =>
          idx === 1
            ? [{ kind: 'boulder', tileQ: 1, tileR: 0, tileIndex: 1, x: propX, y: 0, z: propZ, rot: 0, s: 1, r: 0 }]
            : [],
      },
    } as unknown as HexTerrain;

    const sites = buildActiveWorkSites({
      records,
      view: { planet: { radius: 3 }, blobs: {} } as unknown as ClientView,
      tiles,
      terrain: mockTerrain,
      biomeKey: 'forestRock',
    });

    expect(sites).toHaveLength(1);
    expect(sites[0].targetKind).toBe('rock');
    const blendedX = propX * 0.65 + tile1X * 0.35;
    const blendedZ = propZ * 0.65 + tile1Z * 0.35;
    expect(Math.hypot(sites[0].targetPos[0] - blendedX, sites[0].targetPos[2] - blendedZ)).toBeLessThanOrEqual(0.15);
  });
});

describe('workTargetResolver: grade reads the target tile terrain', () => {
  it('a grade order on a hole tile resolves to hole (not flat / dune)', () => {
    const hq = makeRecord({ id: 11, kind: ENTITY_KIND.hq, owner: 0, q: 0, r: 0, state: ENTITY_STATE.working });
    const view = {
      planet: { radius: 3 },
      blobs: {
        hq: { byColony: { '0': { entityId: 11, targetQ: 1, targetR: 0 } } },
        terraformTasks: { byColony: { '0': [{ id: 't1', q: 1, r: 0, op: 'grade' }] } },
      },
    } as unknown as ClientView;
    const tiles = { indexOf: () => 0, terrain: [TERRAIN_CODES.hole], deposit: [DEPOSIT_CODES.none] } as unknown as ClientTiles;
    const sites = buildActiveWorkSites({ records: new Map([[11, hq]]), view, tiles, terrain: null, biomeKey: 'oceanForest' });
    expect(sites).toHaveLength(1);
    expect(sites[0].targetKind).toBe('hole');
  });
});
