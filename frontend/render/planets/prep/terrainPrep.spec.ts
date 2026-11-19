import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { hexIndex } from '@terra/sim/grid/hex';
import {
  enqueueDeferredDispose,
  flushDeferredDispose,
  pendingDeferredDisposeCount,
  stepDeferredDispose,
} from '../../core/deferredDispose';
import { PLANET_SPECS } from '../PlanetSpec';
import { createHexTerrain, HEX_DEPOSIT, HEX_PREP, HEX_TERRAIN, type HexTiles } from '../hex';
import { createPlanetGlobe } from '../PlanetGlobe';
import { createPlanetSurface } from '../surface';
import {
  TerrainPrepClient,
  buildSphereBuffers,
  computeHexTerrainPrep,
  computeSurfacePrep,
  handleTerrainPrepRequest,
  type PrepWorkerLike,
  type TerrainPrepRequest,
  type TerrainPrepResponse,
} from './index';

function buildSyntheticPlanetTiles(radius: number): {
  tiles: HexTiles;
  terrain: Uint8Array;
  height: Float32Array;
  prep: Uint8Array;
  deposit: Uint8Array;
  depositTier: Uint8Array;
  richness: Uint16Array;
  owner: Int16Array;
} {
  const hx = hexIndex(radius);
  const terrain = new Uint8Array(hx.count);
  const height = new Float32Array(hx.count);
  const prep = new Uint8Array(hx.count);
  const deposit = new Uint8Array(hx.count);
  const depositTier = new Uint8Array(hx.count);
  const richness = new Uint16Array(hx.count).fill(8000);
  const owner = new Int16Array(hx.count).fill(-1);

  for (let i = 0; i < hx.count; i++) {
    const q = hx.q[i]!;
    const r = hx.r[i]!;
    const d = Math.hypot(q, r);
    if (d < 4) {
      terrain[i] = HEX_TERRAIN.flat;
      prep[i] = HEX_PREP.prepared;
      height[i] = 0.2;
    } else if ((q + r) % 7 === 0) {
      terrain[i] = HEX_TERRAIN.shallow;
      height[i] = -0.25;
    } else if ((q - r) % 11 === 0) {
      terrain[i] = HEX_TERRAIN.deep;
      height[i] = -0.7;
    } else if (i % 5 === 0) {
      terrain[i] = HEX_TERRAIN.forest;
      height[i] = 0.6;
    } else if (i % 9 === 0) {
      terrain[i] = HEX_TERRAIN.rock;
      height[i] = 1.4;
    } else {
      terrain[i] = HEX_TERRAIN.slope;
      height[i] = 0.4;
    }
    if (i % 29 === 0 && terrain[i] === HEX_TERRAIN.flat) {
      deposit[i] = HEX_DEPOSIT.metals;
      depositTier[i] = 2;
    }
  }
  return {
    tiles: { terrain, height, prep, deposit, depositTier, richness, owner },
    terrain, height, prep, deposit, depositTier, richness, owner,
  };
}

describe('TerrainPrep Surface & Progressive HexTerrain Parity', () => {
  it('computes PlanetSurface & Descent PlanetGlobe sphere buffers off-thread with parity to synchronous build', () => {
    const sph = buildSphereBuffers(4000, 64, 32);
    const ref = new THREE.SphereGeometry(4000, 64, 32);
    expect(sph.pos.length).toBe(ref.getAttribute('position').array.length);
    expect(sph.idx.length).toBe(ref.getIndex()!.array.length);
    ref.dispose();

    for (const kind of ['dune', 'oceanForest', 'forestRock'] as const) {
      const spec = PLANET_SPECS[kind];
      const { grid, transfer } = computeSurfacePrep({ kind, seed: spec.seed, halfSize: 32, quality: 'low', includeDescentGlobe: kind === 'dune' });
      expect(transfer.length).toBeGreaterThanOrEqual(kind === 'dune' ? 15 : 6);
      if (kind === 'dune') {
        expect(grid.globeSpheres?.surface.widthSegments).toBe(512);
        const globe = createPlanetGlobe(spec, {
          radius: 4000, segments: 160, cloudScale: 1 + 150 / 4000, atmScale: 1.035, precomputedSpheres: grid.globeSpheres,
        });
        expect((globe.clouds.geometry.getAttribute('position') as THREE.BufferAttribute).count).toBe((384 + 1) * (192 + 1));
        globe.dispose();
      }
      const fromWorker = createPlanetSurface(spec, { halfSize: 32, quality: 'low', precomputedGrid: grid });
      const syncBuilt = createPlanetSurface(spec, { halfSize: 32, quality: 'low' });

      for (const [x, z] of [[0, 0], [12.5, -8.3], [-21.1, 19.4], [28, 28]] as const) {
        expect(fromWorker.heightAt(x, z)).toBeCloseTo(syncBuilt.heightAt(x, z), 5);
        expect(fromWorker.isLiquid(x, z)).toBe(syncBuilt.isLiquid(x, z));
      }
      fromWorker.dispose();
      syncBuilt.dispose();
    }
  });

  it('precomputes HexTerrain buffers, transfers ArrayBuffers, and assembles progressively with identical geometry & props', () => {
    const radius = 36;
    const L = buildSyntheticPlanetTiles(radius);
    const look = PLANET_SPECS.oceanForest;

    const { data, transfer } = computeHexTerrainPrep({
      radius,
      kind: look.kind,
      seed: look.seed,
      tiles: {
        terrain: Uint8Array.from(L.terrain),
        height: Float32Array.from(L.height),
        prep: Uint8Array.from(L.prep),
        deposit: Uint8Array.from(L.deposit),
        depositTier: Uint8Array.from(L.depositTier),
        richness: Uint16Array.from(L.richness),
        owner: Int16Array.from(L.owner),
      },
    });
    expect(transfer.length).toBeGreaterThan(15);

    const syncTerrain = createHexTerrain({ radius, tiles: L.tiles, look });
    const progTerrain = createHexTerrain({
      radius, tiles: L.tiles, look, precomputed: data, progressive: true, priorityTile: { q: 4, r: -3 },
    });

    expect(progTerrain.isBuildComplete()).toBe(false);
    for (let steps = 0; !progTerrain.stepProgressiveBuild(0.5) && steps < 50; steps++) {
      /* step slice */
    }
    expect(progTerrain.isBuildComplete()).toBe(true);
    expect(progTerrain.chunks.length).toBe(syncTerrain.chunks.length);
    expect(progTerrain.water.waterTileCount).toBe(syncTerrain.water.waterTileCount);
    expect(progTerrain.props.counts()).toEqual(syncTerrain.props.counts());

    for (const [x, z] of [[0, 0], [15, -10], [-24, 18]] as const) {
      expect(progTerrain.heightAt(x, z)).toBeCloseTo(syncTerrain.heightAt(x, z), 5);
    }

    const midProg = createHexTerrain({ radius, tiles: L.tiles, look, progressive: true });
    expect(midProg.isBuildComplete()).toBe(false);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 50, 0), new THREE.Vector3(0, -1, 0));
    expect(midProg.pick(ray)).toEqual({ q: 0, r: 0, i: expect.any(Number) });
    expect(midProg.isBuildComplete()).toBe(true);

    midProg.dispose();
    progTerrain.dispose();
    syncTerrain.dispose();
  });
});

describe('TerrainPrepClient Worker Lifecycle & DeferredDisposer', () => {
  it('deduplicates requests, clones caller arrays, unloads & terminates on landing, and respawns on demand', async () => {
    let createdWorkers = 0;
    let terminatedWorkers = 0;
    let transferredBuffers = 0;

    const makeFakeWorker = (): PrepWorkerLike => {
      createdWorkers++;
      const w: PrepWorkerLike = {
        onmessage: null,
        onerror: null,
        postMessage(msg: TerrainPrepRequest, transfer: Transferable[]) {
          transferredBuffers += transfer.length;
          queueMicrotask(() => {
            const { response } = handleTerrainPrepRequest(msg);
            w.onmessage?.({ data: response });
          });
        },
        terminate() {
          terminatedWorkers++;
        },
      };
      return w;
    };

    const client = new TerrainPrepClient(makeFakeWorker);
    expect(client.hasActiveWorker).toBe(false);

    const [g1, g2] = await Promise.all([
      client.preloadSurface('dune', 101, 'low', 32),
      client.preloadSurface('dune', 101, 'low', 32),
    ]);
    expect(g1).toBe(g2);
    expect(createdWorkers).toBe(1);
    expect(client.hasActiveWorker).toBe(true);
    expect(client.cachedSurfaceCount).toBe(1);

    const callerTerrain = new Uint8Array(91).fill(1);
    const callerHeight = new Float32Array(91).fill(0.5);
    const callerDeposit = new Uint8Array(91);
    const callerRichness = new Float32Array(91);
    callerDeposit[0] = 1;
    callerRichness[0] = 0.4; // fractional Float32 richness (> 0 = 'half', must not truncate to 0 = 'depleted')
    const hexData = await client.preloadHexTerrain(5, 'forestRock', 7, {
      terrain: callerTerrain,
      height: callerHeight,
      deposit: callerDeposit,
      richness: callerRichness,
    });
    expect(callerTerrain.byteLength).toBe(91);
    expect(transferredBuffers).toBeGreaterThanOrEqual(4);
    expect(hexData.radius).toBe(5);
    const metalProps = Object.values(hexData.chunks).flatMap((c) => c.props.metals);
    expect(metalProps.length).toBeGreaterThan(0);
    expect(metalProps.every((p) => p.stage === 'half')).toBe(true);

    client.unloadLanded(true);
    expect(client.cachedSurfaceCount).toBe(0);
    expect(client.hasActiveWorker).toBe(false);
    expect(terminatedWorkers).toBe(1);

    const g3 = await client.preloadSurface('oceanForest', 202, 'low', 32);
    expect(g3.V).toBe(241);
    expect(createdWorkers).toBe(2);

    // Bounded Orbit cache (<= 2 entries) + unloadEpoch race safety against late worker responses
    await client.preloadSurface('dune', 101, 'low', 32);
    await client.preloadSurface('forestRock', 303, 'low', 32);
    expect(client.cachedSurfaceCount).toBeLessThanOrEqual(2);

    let delayedReply: ((msg: TerrainPrepResponse) => void) | null = null;
    const slowClient = new TerrainPrepClient(() => {
      const w: PrepWorkerLike = {
        onmessage: null,
        postMessage(req) {
          delayedReply = (res) => w.onmessage?.({ data: res });
          void req;
        },
        terminate() {},
      };
      return w;
    });
    const pending = slowClient.preloadSurface('dune', 999, 'low', 32);
    slowClient.unloadLanded(false);
    const { response } = handleTerrainPrepRequest({ id: 1, type: 'surface', kind: 'dune', seed: 999, halfSize: 32, quality: 'low', includeDescentGlobe: false });
    delayedReply!(response);
    await pending;
    expect(slowClient.cachedSurfaceCount).toBe(0);

    client.unloadLanded(true);
    expect(terminatedWorkers).toBe(2);
  });
});

describe('DeferredDisposer Frame Budget & Max-Task Slicing', () => {
  it('drains DeferredDisposer incrementally within maxTasks and isolates throwing tasks', () => {
    flushDeferredDispose();
    const origRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (() => 1) as unknown as typeof requestAnimationFrame;
    try {
      const order: number[] = [];
      enqueueDeferredDispose(
        () => order.push(1),
        () => { throw new Error('simulated GPU dispose error'); },
        () => order.push(3),
        () => order.push(4),
      );
      expect(stepDeferredDispose(50, 2)).toBe(2);
      expect(order).toEqual([1]);
      expect(pendingDeferredDisposeCount()).toBe(2);
      flushDeferredDispose();
      expect(order).toEqual([1, 3, 4]);
      expect(pendingDeferredDisposeCount()).toBe(0);
    } finally {
      globalThis.requestAnimationFrame = origRaf;
    }
    expect(stepDeferredDispose(1)).toBe(0);
  });
});
