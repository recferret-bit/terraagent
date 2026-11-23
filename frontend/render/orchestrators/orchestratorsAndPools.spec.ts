import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { hexCount, hexIndex } from '@terra/sim/grid/hex';
import { getInsectAnimator } from '../animation/insects/InsectAnimationController';
import { vertebrateBodyMatrix, vertebratePartMatrix } from '../animation/vertebrates/pose';
import { getVertebrateConfig } from '../animation/vertebrates/rig';
import { BirdFlockSimulator } from '../biosphere/BirdFlockSim';
import { buildHexHabitatIndex } from '../biosphere/habitatIndex';
import { BIRDS_BY_BIOME, LAND_ANIMALS_BY_BIOME } from '../biosphere/speciesCatalog';
import { ArchetypeCatalog, createArchetypeMesh, setArchetypeBuildProgress, setArchetypeRuin } from '../kitbash';
import { extractArchetype } from '../kitbash/validate/extract';
import { PLANET_SPECS } from '../planets/PlanetSpec';
import {
  createHexTerrain,
  createHexTerrainInWorker,
  HEX_DEPOSIT,
  HEX_PREP,
  HEX_TERRAIN,
  specForPlanetType,
} from '../planets/hex';
import {
  BUILDING_POOL_THRESHOLDS,
  ObjectPool,
  PooledMeshEntry,
  PooledSlotObject,
  UNIT_POOL_THRESHOLDS,
} from '../pools';
import {
  BiomeOrchestrator,
  BiomeWorkerClient,
  buildBiomeOrchestratorConfig,
  BuildingsOrchestrator,
  BuildingsOrchestator,
  BugsOrchestrator,
  parseBiomeOrchestratorConfig,
  serializeBiomeOrchestratorConfig,
  UnitsOrchestrator,
} from './index';

function makePlanetTiles(radius: number) {
  const count = hexCount(radius);
  const hx = hexIndex(radius);
  const terrain = new Uint8Array(count).fill(HEX_TERRAIN.flat);
  const prep = new Uint8Array(count).fill(HEX_PREP.wild);
  const height = new Float32Array(count).fill(0.32);
  const deposit = new Uint8Array(count);
  const richness = new Uint16Array(count).fill(10000);
  const depositTier = new Uint8Array(count).fill(1);

  for (let i = 0; i < count; i++) {
    const q = hx.q[i]!, r = hx.r[i]!;
    if (q < -radius / 2) terrain[i] = HEX_TERRAIN.deep;
    else if (q === Math.floor(-radius / 2)) terrain[i] = HEX_TERRAIN.shallow;
    else if ((q + r) % 3 === 0) terrain[i] = HEX_TERRAIN.forest;
    else if ((q - r) % 6 === 0) terrain[i] = HEX_TERRAIN.rock;
    if (q === 2 && (r === 0 || r === 1 || r === -1)) {
      deposit[i] = r === 0 ? HEX_DEPOSIT.metals : r === 1 ? HEX_DEPOSIT.minerals : HEX_DEPOSIT.oil;
      depositTier[i] = 2;
    }
  }
  return { terrain, prep, height, deposit, richness, depositTier };
}

describe('ObjectPool, PooledObject & smart domain thresholds', () => {
  it('enforces smart thresholds (10 HQ vs 100 workers), prewarming, hardCap, overflow trimming, and double-release safety', () => {
    expect(UNIT_POOL_THRESHOLDS['robot.hero']?.threshold).toBe(10);
    expect(BUILDING_POOL_THRESHOLDS['building.commandHub']?.threshold).toBe(10);
    expect(UNIT_POOL_THRESHOLDS['robot.miner']?.threshold).toBe(100);
    expect(UNIT_POOL_THRESHOLDS['robot.builder']?.threshold).toBe(100);
    expect(UNIT_POOL_THRESHOLDS['ship.dropPod']?.threshold).toBe(10);
    expect(BUILDING_POOL_THRESHOLDS['building.pylon']?.threshold).toBeGreaterThan(UNIT_POOL_THRESHOLDS['robot.hero']!.threshold * 5);

    // 1. Soft-threshold pool: keeps <= threshold items warm, trims temporary burst overflow on release
    let disposedCount = 0;
    class TestSlot extends PooledSlotObject<{ value: number }> {
      override dispose(): void {
        disposedCount++;
        super.dispose();
      }
    }
    const softPool = new ObjectPool<TestSlot>({
      key: 'test:soft',
      initialSize: 2,
      threshold: 3,
      create: (idx, key) => new TestSlot(key, idx, { value: idx }, (d) => { d.value = -1; }),
    });
    expect(softPool.stats()).toMatchObject({ active: 0, available: 2, allocated: 2, threshold: 3, allocations: 2 });

    const a = softPool.acquire();
    const b = softPool.acquire();
    const c = softPool.acquire();
    const burst = softPool.acquire(); // 4th active item exceeds threshold=3
    expect(softPool.activeCount).toBe(4);
    expect(softPool.stats().reuseHits).toBe(2);

    // Double-release is a safe no-op; releasing burst trims back down to threshold=3
    softPool.release(burst);
    softPool.release(burst);
    expect(disposedCount).toBe(1);
    expect(softPool.stats().trimmedOverflow).toBe(1);

    softPool.release(c);
    softPool.release(b);
    softPool.release(a);
    expect(disposedCount).toBe(1); // items within threshold=3 are NEVER disposed!
    expect(softPool.stats()).toMatchObject({ active: 0, available: 3, allocated: 3 });
    softPool.dispose();
    expect(disposedCount).toBe(4);

    // 2. Hard-cap pool (used by birds & animals): never allocates beyond threshold
    const hardPool = new ObjectPool<PooledSlotObject<number>>({
      key: 'test:hard',
      initialSize: 2,
      threshold: 2,
      hardCap: true,
      create: (idx, key) => new PooledSlotObject(key, idx, idx),
    });
    const h1 = hardPool.acquire();
    const h2 = hardPool.acquire();
    expect(hardPool.tryAcquire()).toBeNull();
    expect(() => hardPool.acquire()).toThrow(/exhausted hard threshold/);
    hardPool.release(h1);
    expect(hardPool.tryAcquire()).toBe(h1);
    hardPool.release(h1);
    hardPool.release(h2);
    hardPool.dispose();
  });

  it('resets PooledMeshEntry shader uniforms, ruin state, scaffold progress, extractor tint, and insect animator on reuse', () => {
    const bugMesh = createArchetypeMesh('fauna.blackAnt', 'dune');
    const entry = new PooledMeshEntry('bug:dune:fauna.blackAnt', 0, 'fauna.blackAnt', 'dune', bugMesh);
    entry.acquire();
    entry.bindEntity(42);
    setArchetypeRuin(bugMesh, 1);
    setArchetypeBuildProgress(bugMesh, 0.33);
    bugMesh.userData.uniforms.uSelected.value = 1;
    (bugMesh.material as THREE.MeshStandardMaterial).color.setHex(0xb8a0ff);
    getInsectAnimator(bugMesh)!.die();
    expect(getInsectAnimator(bugMesh)!.state).toBe('dying');

    entry.release();
    expect(bugMesh.visible).toBe(false);
    expect((bugMesh.userData as { entityId?: number }).entityId).toBeUndefined();

    entry.acquire();
    entry.bindEntity(99);
    expect(bugMesh.visible).toBe(true);
    expect((bugMesh.userData as { entityId?: number }).entityId).toBe(99);
    expect(bugMesh.userData.uniforms.uSelected.value).toBe(0);
    expect(bugMesh.userData.uniforms.uRuin.value).toBe(0);
    expect(bugMesh.userData.uniforms.uBuildStage.value).toBe(1);
    expect((bugMesh.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0xffffff);
    expect(getInsectAnimator(bugMesh)!.state).toBe('idle');
    entry.dispose();
  });
});

describe('Size-dependent bird wing animation, real-world group patterns & glitch-free zero-collision flight', () => {
  it('animates wings differently by bird size (fast passerine flutter-bursts vs slow phase-lagged giant soarers)', () => {
    const tinyGeo = ArchetypeCatalog.getGeometry('fauna.bird.brookKingfisher');
    const giantGeo = ArchetypeCatalog.getGeometry('fauna.bird.seaAlbatross');
    const tinyCfg = getVertebrateConfig(tinyGeo);
    const giantCfg = getVertebrateConfig(giantGeo);
    tinyGeo.dispose();
    giantGeo.dispose();

    expect(tinyCfg.birdSize!).toBeLessThan(0.10);
    expect(giantCfg.birdSize!).toBeGreaterThan(0.90);
    expect(tinyCfg.gaitFreq).toBeGreaterThan(giantCfg.gaitFreq * 4.5);

    // Sample outer wing tip height across time: tiny passerine modulates cruise strokes in bursts; giant albatross has deep wrist lag & soaring dihedral
    const tinyModel = extractArchetype('fauna.bird.brookKingfisher');
    const giantModel = extractArchetype('fauna.bird.seaAlbatross');
    const tinyOuter = tinyModel.parts.find((p) => p.vertRig?.role === 8)!;
    const giantOuter = giantModel.parts.find((p) => p.vertRig?.role === 8)!;

    const tinyCruiseA = vertebratePartMatrix(tinyOuter.vertRig!, { time: 0.12, walk: 0.75, run: 0, work: 0, sleep: 0, config: tinyCfg });
    const tinyCruiseB = vertebratePartMatrix(tinyOuter.vertRig!, { time: 1.45, walk: 0.75, run: 0, work: 0, sleep: 0, config: tinyCfg });
    expect(tinyCruiseA.elements).not.toEqual(tinyCruiseB.elements);

    const giantGlide = vertebratePartMatrix(giantOuter.vertRig!, { time: 0.5, walk: 0.05, run: 0, work: 0, sleep: 0, config: giantCfg });
    const tinyGlide = vertebratePartMatrix(tinyOuter.vertRig!, { time: 0.5, walk: 0.05, run: 0, work: 0, sleep: 0, config: tinyCfg });
    expect(giantGlide.elements[5]).not.toBeCloseTo(tinyGlide.elements[5], 3);
    expect(vertebrateBodyMatrix({ time: 0.3, walk: 0.8, run: 0, work: 0, sleep: 0, config: giantCfg }).determinant()).toBeCloseTo(1, 5);
  });

  it('preloads 2 flocks per biome bird species in pools, uses real-world formations, and flies smoothly with zero collision glitches', () => {
    const radius = 16;
    const tiles = makePlanetTiles(radius);
    const look = specForPlanetType('ocean');
    // Inject extreme jagged terrain spikes along flight paths to prove per-bird ground collision checks are completely off!
    const hab = buildHexHabitatIndex(radius, { ...tiles, kind: look.kind, seed: look.seed }, look, (x, z) =>
      Math.sin(x * 3.7) * Math.cos(z * 4.1) > 0.2 ? 45 : 0.2,
    );
    const sim = new BirdFlockSimulator('oceanForest', 1234, hab);

    // Strictly 5 oceanForest bird species * 2 groups each = 10 flocks; zero dune/forestRock species
    expect(sim.speciesList.map((s) => s.id)).toEqual(BIRDS_BY_BIOME.oceanForest.map((s) => s.id));
    expect(sim.flocks).toHaveLength(10);
    for (let slot = 0; slot < 5; slot++) {
      expect(sim.flocks.filter((f) => f.speciesSlot === slot)).toHaveLength(2);
    }

    const formations = new Set(sim.flocks.map((f) => f.formation));
    expect(formations.has('thermalKettle')).toBe(true);
    expect(formations.has('jEchelon')).toBe(true);
    expect(formations.has('pelotonWave')).toBe(true);
    expect(formations.has('canopyCarousel')).toBe(true);
    expect(formations.has('ridgeSweep')).toBe(true);

    const allocBefore = [...sim.pools.values()].map((p) => p.stats().allocations);
    const prevYaws = sim.flocks.map((f) => f.members.map((m) => m.yaw));
    const prevRolls = sim.flocks.map((f) => f.members.map((m) => m.roll));

    for (let frame = 0; frame < 120; frame++) {
      sim.step(1 / 30, hab, [], []);
      sim.flocks.forEach((f, fi) => {
        f.members.forEach((m, mi) => {
          expect(Number.isFinite(m.x + m.y + m.z + m.yaw + m.pitch + m.roll)).toBe(true);
          let dy = Math.abs(m.yaw - prevYaws[fi]![mi]!);
          if (dy > Math.PI) dy = Math.PI * 2 - dy;
          const dr = Math.abs(m.roll - prevRolls[fi]![mi]!);
          // Zero frame-to-frame yaw/roll glitch spikes!
          expect(dy).toBeLessThan(0.45);
          expect(dr).toBeLessThan(0.35);
          prevYaws[fi]![mi] = m.yaw;
          prevRolls[fi]![mi] = m.roll;
        });
      });
    }

    // Zero runtime allocations or deletions across 120 simulation frames
    expect([...sim.pools.values()].map((p) => p.stats().allocations)).toEqual(allocBefore);
    sim.dispose();
  });
});

describe('BiomeOrchestrator JSON config, Worker thread generation, and Buildings/Units/Bugs orchestrators', () => {
  it('parses big JSON config, filters biome-exclusive assets, generates terrain + biome in Worker thread, and recycles resource/tree pools', async () => {
    const radius = 14;
    const tiles = makePlanetTiles(radius);
    const look = PLANET_SPECS.dune;
    const rawConfig = buildBiomeOrchestratorConfig(look, radius);
    const jsonString = serializeBiomeOrchestratorConfig(rawConfig);
    expect(jsonString.length).toBeGreaterThan(1500);

    // Negative / sanitization check: malformed JSON throws; foreign species injected into JSON are stripped!
    expect(() => parseBiomeOrchestratorConfig('{}')).toThrow(/missing "planet"/);
    const injected = parseBiomeOrchestratorConfig(
      JSON.stringify({
        ...rawConfig,
        groundObjects: { ...rawConfig.groundObjects, floraKinds: ['saguaro', 'reeds', 'wildflower'] },
        birds: { ...rawConfig.birds, species: [...BIRDS_BY_BIOME.dune, ...BIRDS_BY_BIOME.forestRock] },
        animals: { ...rawConfig.animals, species: [...LAND_ANIMALS_BY_BIOME.dune, ...LAND_ANIMALS_BY_BIOME.oceanForest] },
      }),
    );
    expect(injected.groundObjects.floraKinds).toEqual(['saguaro']);
    expect(injected.birds.species).toHaveLength(5);
    expect(injected.animals.species).toHaveLength(4);

    // Worker-thread generation (`BiomeWorkerClient` -> `BiomeWorkerController`) + main-thread hydration
    const workerClient = new BiomeWorkerClient();
    const workerTerrain = await createHexTerrainInWorker({
      radius,
      tiles,
      look,
      biomeConfigJson: jsonString,
      workerClient,
    });
    const syncTerrain = createHexTerrain({ radius, tiles, look, biomeConfigJson: jsonString });

    expect(workerTerrain.biomeOrchestrator).toBeInstanceOf(BiomeOrchestrator);
    expect(workerTerrain.biomeOrchestrator.loadedViaWorker).toBe(true);
    expect(syncTerrain.biomeOrchestrator.loadedViaWorker).toBe(false);
    expect(workerTerrain.chunks.length).toBe(syncTerrain.chunks.length);
    expect(workerTerrain.props.counts()).toEqual(syncTerrain.props.counts());
    expect(workerTerrain.flora.counts()).toEqual(syncTerrain.flora.counts());
    expect(workerTerrain.biosphere.counts().birdSpecies).toBe(5);
    expect(workerTerrain.biosphere.counts().birdFlocks).toBe(10);
    expect(workerTerrain.biosphere.counts().landSpecies).toBe(4);

    // Dune planet allocates ZERO lush `pine`, `reeds`, or `wildflower` pools
    const stats = workerTerrain.biomeOrchestrator.poolStats();
    expect(stats.trees.some((s) => s.key.includes('pine'))).toBe(false);
    expect(stats.trees.some((s) => s.key.includes('duneTree'))).toBe(true);
    expect(stats.groundObjects.some((s) => s.key.includes('reeds') || s.key.includes('wildflower'))).toBe(false);
    expect(stats.resources.find((s) => s.key === 'resource:depositNode')!.active).toBeGreaterThan(0);

    // Mining a metals deposit from full -> half -> depleted recycles pooled buckets & deposit slots without leaking
    const allocBeforeMine = workerTerrain.biomeOrchestrator.resourcesOrchestrator.layer
      .poolStats()
      .find((s) => s.key === 'hexProp:metals')!.allocations;
    workerTerrain.setTileState(2, 0, undefined, undefined, undefined, HEX_DEPOSIT.metals, 3500);
    workerTerrain.setTileState(2, 0, undefined, undefined, undefined, HEX_DEPOSIT.metals, 0);
    const metalsAfter = workerTerrain.biomeOrchestrator.resourcesOrchestrator.layer
      .poolStats()
      .find((s) => s.key === 'hexProp:metals')!;
    expect(metalsAfter.allocations).toBe(allocBeforeMine);
    expect(metalsAfter.reuseHits).toBeGreaterThanOrEqual(2);

    workerClient.dispose();
    workerTerrain.dispose();
    syncTerrain.dispose();
  });
});

describe('BuildingsOrchestrator, UnitsOrchestrator, BugsOrchestrator & edge-case boundaries', () => {
  it('recycles buildings, robots, ships, and bugs across BuildingsOrchestrator, UnitsOrchestrator, and BugsOrchestrator', () => {
    expect(BuildingsOrchestator).toBe(BuildingsOrchestrator);
    const group = new THREE.Group();
    let meshCreations = 0;
    const factory = (id: string, biome: string) => {
      meshCreations++;
      return createArchetypeMesh(id, biome);
    };

    const buildings = new BuildingsOrchestrator(
      group,
      JSON.stringify({ biomeKey: 'forestRock', pools: { 'building.commandHub': { initialSize: 1, threshold: 10 } } }),
      factory,
    );
    const units = new UnitsOrchestrator(
      group,
      JSON.stringify({
        biomeKey: 'forestRock',
        pools: {
          'robot.hero': { initialSize: 1, threshold: 10 },
          'robot.miner': { initialSize: 2, threshold: 100 },
        },
      }),
      factory,
    );
    const bugs = new BugsOrchestrator(
      group,
      JSON.stringify({ biomeKey: 'forestRock', pools: { 'fauna.blackAnt': { initialSize: 2, threshold: 128 } } }),
      factory,
    );

    expect(buildings.getThreshold('building.commandHub').threshold).toBe(10);
    expect(units.getThreshold('robot.hero').threshold).toBe(10);
    expect(units.getThreshold('robot.miner').threshold).toBe(100);

    const hub1 = buildings.acquire(101, 'building.commandHub', 'forestRock');
    const createdAfterHub = meshCreations;
    buildings.release(101);
    expect(hub1.visible).toBe(false);
    const hub2 = buildings.acquire(202, 'building.commandHub', 'forestRock');
    expect(hub2).toBe(hub1);
    expect(meshCreations).toBe(createdAfterHub);

    const worker1 = units.acquire(11, 'robot.miner', 'forestRock');
    const createdAfterWorker = meshCreations;
    units.release(11);
    const worker2 = units.acquire(22, 'robot.miner', 'forestRock');
    expect(worker2).toBe(worker1);
    expect(meshCreations).toBe(createdAfterWorker);

    const ant1 = bugs.acquire(501, 'fauna.blackAnt', 'forestRock');
    const createdAfterAnt = meshCreations;
    bugs.release(501);
    const ant2 = bugs.acquire(502, 'fauna.blackAnt', 'forestRock');
    expect(ant2).toBe(ant1);
    expect(meshCreations).toBe(createdAfterAnt);

    buildings.dispose();
    units.dispose();
    bugs.dispose();
  });
});

describe('BiomeWorkerClient & barren radius=1 edge-case boundaries', () => {
  it('handles barren radius=1 edge maps, extreme dt boundaries, worker error recovery, and in-flight worker disposal', async () => {
    const barrenCount = hexCount(1);
    const barrenTiles = {
      terrain: new Uint8Array(barrenCount).fill(HEX_TERRAIN.deep),
      prep: new Uint8Array(barrenCount).fill(HEX_PREP.wild),
      height: new Float32Array(barrenCount).fill(-0.8),
    };
    const look = PLANET_SPECS.forestRock;
    const client = new BiomeWorkerClient();

    // 1. Malformed JSON rejects cleanly without breaking subsequent worker requests
    await expect(client.generate('{bad-json', barrenTiles)).rejects.toThrow();

    // 2. Barren deep-water radius=1 map with zero deposits, zero trees, and zero dry anchors
    const json = serializeBiomeOrchestratorConfig(buildBiomeOrchestratorConfig(look, 1));
    const barren = await createHexTerrainInWorker({ radius: 1, tiles: barrenTiles, look, biomeConfigJson: json, workerClient: client });
    expect(barren.props.counts()).toEqual({ pine: 0, duneTree: 0, boulder: 0, spire: 0, metals: 0, minerals: 0, oil: 0 });
    expect(Object.values(barren.flora.counts()).reduce((a, b) => a + b, 0)).toBe(0);
    expect(barren.biosphere.counts().birdFlocks).toBe(10);
    // Boundary dt values: 0, negative, and huge 5.0s spike
    barren.tick(0);
    barren.tick(-0.5);
    barren.tick(5.0);
    for (const flock of barren.biosphere.getBirdFlocks()) {
      for (const m of flock.members) {
        expect(Number.isFinite(m.x + m.y + m.z + m.yaw)).toBe(true);
      }
    }
    barren.dispose();

    // 3. Disposing BiomeWorkerClient while a request is pending rejects cleanly
    let postCount = 0;
    const hangingClient = new BiomeWorkerClient(() => ({
      onmessage: null,
      onerror: null,
      postMessage() { postCount++; },
      terminate() {},
    }));
    const pendingPromise = hangingClient.generate(json, barrenTiles);
    expect(postCount).toBe(1);
    hangingClient.dispose();
    await expect(pendingPromise).rejects.toThrow(/disposed/);
    client.dispose();
  });
});
