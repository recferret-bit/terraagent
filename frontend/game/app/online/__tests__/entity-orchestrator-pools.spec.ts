// @vitest-environment jsdom
import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ENTITY_KIND, ENTITY_STATE } from '@terra/sim';
import { createArchetypeMesh } from '@terra/render/kitbash';
import { packEntities, type ClientTiles, type ClientView, type EntityRow } from '../../../store/replica/viewCodec';
import { LocalHost } from '../../../store/local/LocalHost';
import { Gameplay } from '../../Gameplay';
import { EntityMeshes } from '../EntityMeshes';
import { OnlineSession } from '../OnlineSession';
import { SessionTerrainLoader } from '../parts/sessionTerrainLoader';
import { createSafeViewport, listSceneEntities } from '../viewportHelper';
import { PLANET_SPECS } from '@terra/render/planets/PlanetSpec';
import { hexCount } from '@terra/sim/grid/hex';

beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

function makeView(tick: number, rows: Array<Partial<EntityRow> & { id: number; kind: number }>): ClientView {
  const fullRows: EntityRow[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    owner: r.owner ?? 0,
    q: r.q ?? 0,
    r: r.r ?? 0,
    x: r.x ?? r.q ?? 0,
    y: r.y ?? r.r ?? 0,
    rot: r.rot ?? 0,
    hp: r.hp ?? 100,
    hpMax: r.hpMax ?? 100,
    state: r.state ?? ENTITY_STATE.active,
    progress: r.progress ?? 1,
    tier: r.tier ?? 1,
  }));
  return {
    tick,
    planet: { id: 'pl_pool_test', type: 'temperate', radius: 16, seed: 'pool-seed' },
    count: fullRows.length,
    entities: packEntities(fullRows as unknown as Parameters<typeof packEntities>[0]),
    colonies: [{ index: 0, id: 'col_0', status: 'active' }],
  } as unknown as ClientView;
}

describe('EntityMeshes integration with BuildingsOrchestrator, UnitsOrchestrator & BugsOrchestrator pools', () => {
  it('recycles buildings, workers, ships, and bugs without re-spawning or leaking parked meshes into listSceneEntities', () => {
    const scene = new THREE.Scene();
    const createdByArchetype = new Map<string, number>();
    const entities = new EntityMeshes(scene, (id, biome) => {
      createdByArchetype.set(id, (createdByArchetype.get(id) ?? 0) + 1);
      return createArchetypeMesh(id, biome);
    });

    expect(entities.unitsOrchestrator.getThreshold('robot.hero').threshold).toBe(10);
    expect(entities.unitsOrchestrator.getThreshold('robot.miner').threshold).toBe(100);
    expect(entities.buildingsOrchestrator.getThreshold('building.commandHub').threshold).toBe(10);

    // Tick 1: spawn HQ, 1 worker, 1 solar building, 1 blackAnt
    entities.syncView(
      makeView(1, [
        { id: 1, kind: ENTITY_KIND.hq, q: 0, r: 0 },
        { id: 2, kind: ENTITY_KIND.worker, q: 1, r: 0, tier: 1 },
        { id: 3, kind: ENTITY_KIND.solar, q: 2, r: 0 },
        { id: 4, kind: ENTITY_KIND.blackAnt, owner: -1, q: 5, r: 0 },
      ]),
      null,
      'forestRock',
    );
    const workerMesh1 = entities.getRecord(2)!.mesh;
    const solarMesh1 = entities.getRecord(3)!.mesh;
    const antMesh1 = entities.getRecord(4)!.mesh;
    const minerCreationsAfterTick1 = createdByArchetype.get('robot.miner')!;
    const solarCreationsAfterTick1 = createdByArchetype.get('building.solar')!;
    const antCreationsAfterTick1 = createdByArchetype.get('fauna.blackAnt')!;
    expect(listSceneEntities(scene).map((e) => e.id).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);

    // Tick 2: despawn worker, solar, and ant:
    // - worker & solar are immediately parked in their pools (invisible, excluded from listSceneEntities)
    // - ant plays its 2.4s corpse linger (`InsectPresentation`), then returns to BugsOrchestrator pool!
    entities.syncView(makeView(2, [{ id: 1, kind: ENTITY_KIND.hq, q: 0, r: 0 }]), null, 'forestRock');
    entities.update(0.5, null, 0.5);
    expect(workerMesh1.visible).toBe(false);
    expect(solarMesh1.visible).toBe(false);
    expect(listSceneEntities(scene).map((e) => e.id).sort((a, b) => a - b)).toEqual([1, 4]);

    entities.update(2.1, null, 2.1);
    expect(listSceneEntities(scene).map((e) => e.id)).toEqual([1]);
    expect(antMesh1.visible).toBe(false);

    // Tick 3: spawn new worker (id 20), new solar (id 30), new ant (id 40) -> reuses pooled meshes with ZERO new factory calls!
    entities.syncView(
      makeView(3, [
        { id: 1, kind: ENTITY_KIND.hq, q: 0, r: 0 },
        { id: 20, kind: ENTITY_KIND.worker, q: -1, r: 2, tier: 1 },
        { id: 30, kind: ENTITY_KIND.solar, q: -3, r: 1 },
        { id: 40, kind: ENTITY_KIND.blackAnt, owner: -1, q: 4, r: -1 },
      ]),
      null,
      'forestRock',
    );
    expect(createdByArchetype.get('robot.miner')).toBe(minerCreationsAfterTick1);
    expect(createdByArchetype.get('building.solar')).toBe(solarCreationsAfterTick1);
    expect(createdByArchetype.get('fauna.blackAnt')).toBe(antCreationsAfterTick1);
    expect(entities.getRecord(20)!.mesh.visible).toBe(true);
    expect(entities.getRecord(30)!.mesh.visible).toBe(true);
    expect(antMesh1.parent).toBe(entities.group);

    // Tick 4: upgrade worker 20 from T1 (`robot.miner`) -> T2 (`robot.builder`) seamlessly swaps pooled meshes
    entities.syncView(
      makeView(4, [
        { id: 1, kind: ENTITY_KIND.hq, q: 0, r: 0 },
        { id: 20, kind: ENTITY_KIND.worker, q: -1, r: 2, tier: 2 },
      ]),
      null,
      'forestRock',
    );
    expect(entities.getRecord(20)!.mesh.name).toBe('robot.builder');
    entities.update(2.5, null, 2.5);
    expect(listSceneEntities(scene).map((e) => e.id).sort((a, b) => a - b)).toEqual([1, 20]);
    entities.dispose();
  });
});

describe('EntityMeshes retired insect entityId rollback guard', () => {
  it('never releases a newly acquired mesh or double-allocates when a retired insect entityId is reused on rollback', () => {
    const scene = new THREE.Scene();
    const entities = new EntityMeshes(scene);
    entities.syncView(
      makeView(5, [
        { id: 1, kind: ENTITY_KIND.hq, q: 0, r: 0 },
        { id: 40, kind: ENTITY_KIND.blackAnt, owner: -1, q: 2, r: 0 },
      ]),
      null,
      'forestRock',
    );
    entities.syncView(makeView(6, [{ id: 1, kind: ENTITY_KIND.hq, q: 0, r: 0 }]), null, 'forestRock');
    entities.syncView(
      makeView(7, [
        { id: 1, kind: ENTITY_KIND.hq, q: 0, r: 0 },
        { id: 40, kind: ENTITY_KIND.blueBeetle, owner: -1, q: 2, r: 0 },
        { id: 41, kind: ENTITY_KIND.blueBeetle, owner: -1, q: 3, r: 0 },
      ]),
      null,
      'forestRock',
    );
    expect(entities.getRecord(40)!.mesh).not.toBe(entities.getRecord(41)!.mesh);
    expect(entities.getRecord(40)!.mesh.visible).toBe(true);
    expect(entities.getRecord(41)!.mesh.visible).toBe(true);
    // Tick 4: reuse retired insect entityId (42) for a non-insect worker within <2.4s without duplicate scene entityIds
    entities.syncView(
      makeView(8, [
        { id: 1, kind: ENTITY_KIND.hq, q: 0, r: 0 },
        { id: 42, kind: ENTITY_KIND.blackAnt, owner: -1, q: 4, r: 0 },
      ]),
      null,
      'forestRock',
    );
    entities.syncView(makeView(9, [{ id: 1, kind: ENTITY_KIND.hq, q: 0, r: 0 }]), null, 'forestRock');
    entities.syncView(
      makeView(10, [
        { id: 1, kind: ENTITY_KIND.hq, q: 0, r: 0 },
        { id: 42, kind: ENTITY_KIND.worker, owner: 0, q: 1, r: 1 },
      ]),
      null,
      'forestRock',
    );
    expect(listSceneEntities(scene).filter((e) => e.id === 42)).toHaveLength(1);
    entities.dispose();
  });
});

describe('Rapid back-to-back planet switches during combat & flat/implicit biome resolution', () => {
  it('prunes all stale biome pools immediately across forestRock -> oceanForest -> dune switches with lingering corpses and handles flat/implicit planet types', () => {
    const scene = new THREE.Scene();
    const entities = new EntityMeshes(scene);

    // 1. 'flat' SimPlanetType never creates invalid 'flat:*' pools; falls back to 'forestRock'
    entities.syncView(
      { ...makeView(1, [{ id: 1, kind: ENTITY_KIND.hq }]), planet: { id: 'pl_flat', type: 'flat', radius: 12, seed: 's1' } } as unknown as ClientView,
      null,
    );
    expect(entities.poolStats().buildings.every((s) => s.key.startsWith('building:forestRock:'))).toBe(true);

    // 2. Spawn + kill insects on forestRock ('pl_fr'), then switch within <0.2s to oceanForest ('pl_of'), spawn + kill insects, then switch to dune ('pl_du') — omitting explicit biomeKey!
    entities.syncView(
      {
        ...makeView(2, [
          { id: 1, kind: ENTITY_KIND.hq },
          { id: 10, kind: ENTITY_KIND.blackAnt, owner: -1, hp: 5 },
          { id: 11, kind: ENTITY_KIND.blueBeetle, owner: -1, hp: 5 },
        ]),
        planet: { id: 'pl_fr', type: 'temperate', radius: 12, seed: 'fr' },
      } as unknown as ClientView,
      null,
    );
    entities.syncView(
      { ...makeView(3, [{ id: 1, kind: ENTITY_KIND.hq }]), planet: { id: 'pl_fr', type: 'temperate', radius: 12, seed: 'fr' } } as unknown as ClientView,
      null,
    );
    entities.update(0.1, null, 0.1);

    // Switch to oceanForest (via view.planet.type = 'ocean', no explicit biomeKey!)
    entities.syncView(
      {
        ...makeView(4, [
          { id: 1, kind: ENTITY_KIND.hq, q: 4, r: -2 },
          { id: 20, kind: ENTITY_KIND.greenSpitter, owner: -1, hp: 5 },
        ]),
        planet: { id: 'pl_of', type: 'ocean', radius: 12, seed: 'of' },
      } as unknown as ClientView,
      null,
    );
    expect(entities.poolStats().buildings.every((s) => s.key.startsWith('building:oceanForest:'))).toBe(true);
    expect(entities.poolStats().units.every((s) => s.key.startsWith('unit:oceanForest:'))).toBe(true);
    expect(entities.poolStats().bugs.every((s) => s.key.startsWith('bug:oceanForest:'))).toBe(true);
    expect(listSceneEntities(scene).map((e) => e.id).sort((a, b) => a - b)).toEqual([1, 20]);

    // Retire spitter on oceanForest, then immediately switch within 0.1s to dune (via view.planet.type = 'desert')!
    entities.syncView(
      { ...makeView(5, [{ id: 1, kind: ENTITY_KIND.hq, q: 4, r: -2 }]), planet: { id: 'pl_of', type: 'ocean', radius: 12, seed: 'of' } } as unknown as ClientView,
      null,
    );
    entities.update(0.1, null, 0.1);
    entities.syncView(
      { ...makeView(6, [{ id: 1, kind: ENTITY_KIND.hq, q: -3, r: 3 }]), planet: { id: 'pl_du', type: 'desert', radius: 12, seed: 'du' } } as unknown as ClientView,
      null,
    );

    // Immediately at t=0 on dune, ALL prior biome pools (including bugs!) are pruned and zero stale corpses remain
    expect(entities.poolStats().buildings.every((s) => s.key.startsWith('building:dune:'))).toBe(true);
    expect(entities.poolStats().units.every((s) => s.key.startsWith('unit:dune:'))).toBe(true);
    expect(entities.poolStats().bugs.every((s) => s.key.startsWith('bug:dune:'))).toBe(true);
    expect(listSceneEntities(scene).map((e) => e.id)).toEqual([1]);

    // Advancing past 2.4s causes zero double-disposal or errors
    entities.update(3.0, null, 3.0);
    expect(entities.poolStats().bugs).toHaveLength(3);
    entities.dispose();
  });
});

describe('OnlineSession & Gameplay Worker terrain loading and fallback', () => {
  it('loads OnlineSession HexTerrain through BiomeWorkerClient during level boot and shares BugsOrchestrator', async () => {
    const root = document.createElement('div');
    const body = document.createElement('div');
    document.body.replaceChildren(body);
    body.appendChild(root);

    const host = new LocalHost({ radius: 12, seed: 'worker-seed-1' });
    const session = new OnlineSession(root, 'scenario', {
      uiParent: body,
      localHost: host,
      planetKind: 'oceanForest',
      fromSpaceDescent: true,
      loadMode: 'pod',
      skipDescent: false,
      makeMesh: (id) => {
        const g = new THREE.Group();
        g.name = id;
        g.userData = { archetypeId: id, uniforms: { uTime: { value: 0 }, uWalkWeight: { value: 0 }, uWorkWeight: { value: 0 } } };
        return g;
      },
    });

    // Calling skipLanding() while Worker generation is still in flight must NOT abort the Worker thread!
    session.skipLanding();
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
    expect(session.terrain).not.toBeNull();
    expect(session.terrain!.biomeOrchestrator.loadedViaWorker).toBe(true);
    expect(session.terrain!.biomeOrchestrator.bugsOrchestrator).toBe(session.entities.bugsOrchestrator);
    const activeBiome = session.terrain!.biomeOrchestrator.look.biomeKey;
    expect(session.terrain!.biomeOrchestrator.poolStats().bugs).toHaveLength(3);
    expect(session.terrain!.biomeOrchestrator.poolStats().bugs.every((s) => s.key.startsWith(`bug:${activeBiome}:`) && s.allocated >= s.initialSize && s.initialSize > 0)).toBe(true);
    expect(session.entities.buildingsOrchestrator.poolStats().length).toBeGreaterThanOrEqual(19);
    expect(session.entities.unitsOrchestrator.poolStats().length).toBeGreaterThanOrEqual(9);
    expect(session.entities.buildingsOrchestrator.poolStats().every((s) => s.key.startsWith(`building:${activeBiome}:`) && s.allocated >= s.initialSize)).toBe(true);
    expect(session.entities.unitsOrchestrator.poolStats().every((s) => s.key.startsWith(`unit:${activeBiome}:`) && s.allocated >= s.initialSize)).toBe(true);
    expect(session.terrain!.biosphere.counts().birdSpecies).toBe(5);
    expect(session.terrain!.biosphere.counts().birdFlocks).toBe(10);
    session.dispose();
  });

  it('switches planet biomes cleanly in EntityMeshes & SessionTerrainLoader, swapping active meshes and pruning stale biome pools', async () => {
    const scene = new THREE.Scene();
    const entities = new EntityMeshes(scene);

    // Load empty oceanForest view -> prewarms all pools for oceanForest even with 0 spawned entities
    entities.syncView(
      { ...makeView(1, []), planet: { id: 'pl_ocean', type: 'ocean', radius: 12, seed: '1' } } as unknown as ClientView,
      null,
    );
    expect(entities.poolStats().buildings.every((s) => s.key.startsWith('building:oceanForest:') && s.allocated >= s.initialSize)).toBe(true);
    expect(entities.poolStats().units.every((s) => s.key.startsWith('unit:oceanForest:') && s.allocated >= s.initialSize)).toBe(true);
    expect(entities.poolStats().bugs.every((s) => s.key.startsWith('bug:oceanForest:') && s.allocated >= s.initialSize)).toBe(true);

    // Spawn HQ + solar + ant on oceanForest, then retire ant (corpse linger) and switch planet to dune!
    entities.syncView(
      makeView(2, [
        { id: 1, kind: ENTITY_KIND.hq, q: 0, r: 0 },
        { id: 2, kind: ENTITY_KIND.solar, q: 2, r: 0 },
        { id: 3, kind: ENTITY_KIND.blackAnt, owner: -1, q: 4, r: 0 },
      ]),
      null,
      'oceanForest',
    );
    // Retire ant (starts corpse linger) while switching planet to dune: HQ & solar swap to dune immediately;
    // oceanForest building & unit pools prune immediately, and lingering ant's oceanForest bug pool prunes once linger ends!
    entities.syncView(
      makeView(3, [
        { id: 1, kind: ENTITY_KIND.hq, q: 0, r: 0 },
        { id: 2, kind: ENTITY_KIND.solar, q: 2, r: 0 },
      ]),
      null,
      'dune',
    );
    expect((entities.getRecord(1)!.mesh.userData as { biomeKey?: string }).biomeKey).toBe('dune');
    expect((entities.getRecord(2)!.mesh.userData as { biomeKey?: string }).biomeKey).toBe('dune');
    expect(entities.poolStats().buildings.every((s) => s.key.startsWith('building:dune:'))).toBe(true);
    expect(entities.poolStats().units.every((s) => s.key.startsWith('unit:dune:'))).toBe(true);

    entities.update(2.6, null, 2.6);
    expect(entities.poolStats().bugs.every((s) => s.key.startsWith('bug:dune:'))).toBe(true);
    entities.dispose();
  });
});

describe('Standalone Gameplay orchestrator pools & SessionTerrainLoader crash resilience', () => {
  it('wires BuildingsOrchestrator & UnitsOrchestrator into standalone Gameplay and falls back cleanly when a Worker throws', async () => {
    // 1. Standalone Gameplay acquires hero, rovers, and colony buildings through pooled orchestrators
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(28, 16 / 9, 0.5, 500);
    const dom = document.createElement('div');
    const hero = createArchetypeMesh('robot.hero', 'forestRock');
    const surface = {
      group: new THREE.Group(),
      halfSize: 64,
      landingSite: new THREE.Vector3(0, 0.5, 0),
      heightAt: () => 0.5,
      slopeAt: () => 0.02,
      isLiquid: () => false,
      waterLevel: 0,
      dispose: () => {},
    } as unknown as ConstructorParameters<typeof Gameplay>[3];

    const gameplay = new Gameplay(
      scene,
      cam,
      dom,
      surface,
      PLANET_SPECS.forestRock,
      hero,
      {} as ConstructorParameters<typeof Gameplay>[6],
      { position: new THREE.Vector3(18, 22, 18), target: new THREE.Vector3(0, 0, 0) },
    );
    expect(gameplay.buildingsOrchestrator.activeCount).toBeGreaterThan(0);
    expect(gameplay.unitsOrchestrator.activeCount).toBeGreaterThan(0);
    expect(gameplay.buildingsOrchestrator.poolStats().length).toBeGreaterThanOrEqual(19);
    expect(gameplay.unitsOrchestrator.poolStats().length).toBeGreaterThanOrEqual(9);
    expect(gameplay.buildingsOrchestrator.poolStats().every((s) => s.key.startsWith('building:forestRock:') && s.allocated >= s.initialSize)).toBe(true);
    expect(gameplay.unitsOrchestrator.poolStats().every((s) => s.key.startsWith('unit:forestRock:') && s.allocated >= s.initialSize)).toBe(true);
    expect(gameplay.buildingsOrchestrator.getThreshold('building.commandHub').threshold).toBe(10);
    expect(gameplay.unitsOrchestrator.getThreshold('robot.miner').threshold).toBe(100);
    gameplay.update(1 / 30);
    gameplay.dispose();
    expect(gameplay.buildingsOrchestrator.activeCount).toBe(0);
    expect(gameplay.unitsOrchestrator.activeCount).toBe(0);

    // 2. SessionTerrainLoader falls back to synchronous terrain creation if the Worker errors
    const vpRoot = document.createElement('div');
    const viewport = createSafeViewport(vpRoot);
    let mountedTerrain: unknown = null;
    let biomeKey = 'forestRock';
    let storedTiles: Parameters<SessionTerrainLoader['onTiles']>[1] | null = null;
    const loader = new SessionTerrainLoader(
      {
        viewport,
        get terrain() { return mountedTerrain as never; },
        set terrain(t) { mountedTerrain = t; },
        cam: null,
        planetKind: 'dune',
        getPlanetSeed: () => 42,
        getBiomeKey: () => biomeKey,
        setBiomeKey: (k) => { biomeKey = k; },
        getTiles: () => storedTiles,
        setTiles: (t) => { storedTiles = t; },
        isInSpace: () => false,
        getShowSpaceTerrain: () => false,
        getDeferReveal: () => false,
        getCameraTargetTile: () => ({ q: 0, r: 0 }),
        onTerrainMounted: () => {},
      },
      () => ({
        onmessage: null,
        onerror: null,
        postMessage() {
          queueMicrotask(() => this.onerror?.({ message: 'simulated worker crash' }));
        },
        terminate() {},
      }),
    );

    const n = hexCount(8);
    const tiles: ClientTiles = {
      count: n,
      terrain: new Uint8Array(n).fill(1),
      prep: new Uint8Array(n),
      height: new Float32Array(n).fill(0.25),
      deposit: new Uint8Array(n),
      richness: new Float32Array(n),
      owner: new Int16Array(n).fill(-1),
    };
    loader.onTiles(
      { ...makeView(1, []), planet: { id: 'pl_fallback', type: 'desert', radius: 8, seed: '42' } } as unknown as ClientView,
      tiles,
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(mountedTerrain).not.toBeNull();
    loader.dispose();
    (mountedTerrain as { dispose(): void })?.dispose();
    viewport.dispose();
  });
});
