import * as THREE from 'three';
import { hexIndex } from '@terra/sim/grid/hex';
import { getWindUniforms } from '../core/windConfig';
import type { PlanetSpec } from '../planets/PlanetSpec';
import { createBorderController } from '../planets/hex/borderController';
import { buildChunk, computeEffectiveHeights, type HexTileLayers } from '../planets/hex/chunkMesh';
import { chunkKey, chunkLayout, type ChunkDef } from '../planets/hex/chunks';
import { makeHeightSampler } from '../planets/hex/heightSampler';
import { createHexAmbient } from '../planets/hex/hexAmbient';
import { addHexEdges } from '../planets/hex/hexEdges';
import { planetExtent } from '../planets/hex/hexMath';
import { createHexWater, HEX_WATER_LEVEL, type HexWater } from '../planets/hex/hexWater';
import type { TerritoryBorderStats } from '../planets/hex/territoryBorder';
import { createHexTileTint } from '../planets/hex/tileTint';
import { createTerrainMaterial, terrainUniforms } from '../visuals/terrain/terrainMaterial';
import type { BiomeOrchestratorConfig } from './BiomeConfig';
import type { WorkerChunkGeometryData } from './worker/protocol';

function createTerrainDepthMaterial(): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aRock;\nvarying float vRock;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRock = aRock;\ntransformed.y -= 0.08;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vRock;')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vRock < 0.001) discard;');
  };
  return mat;
}

function makeChunkMeshFromBuffers(
  cq: number,
  cr: number,
  b: {
    position: Float32Array;
    normal: Float32Array;
    aAO: Float32Array;
    aRock: Float32Array;
    aHexShore: Float32Array;
    index: Uint32Array;
  },
  material: THREE.Material,
  depthMaterial: THREE.MeshDepthMaterial,
): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(b.position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(b.normal, 3));
  geo.setAttribute('aAO', new THREE.BufferAttribute(b.aAO, 1));
  geo.setAttribute('aRock', new THREE.BufferAttribute(b.aRock, 1));
  geo.setAttribute('aHexShore', new THREE.BufferAttribute(b.aHexShore, 1));
  geo.setIndex(new THREE.BufferAttribute(b.index, 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = `hexChunk ${cq},${cr}`;
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.customDepthMaterial = depthMaterial;
  return mesh;
}

/**
 * Sub-orchestrator managing hex terrain chunk meshes, effective heights, tile tints,
 * hydro water, territory borders, and ambient atmospheric motes.
 * Hydrates directly from Worker-generated typed arrays on initial level load.
 */
export class TerrainOrchestrator {
  readonly group: THREE.Group;
  readonly material: THREE.MeshStandardMaterial;
  readonly uniforms: Record<string, THREE.IUniform>;
  readonly water: HexWater;
  readonly borderMesh: THREE.Mesh;
  readonly halfSize: number;
  readonly heightAt: (x: number, z: number) => number;
  readonly chunkMeshes = new Map<string, THREE.Mesh>();

  private readonly byKey: Map<string, ChunkDef>;
  private readonly depthMaterial = createTerrainDepthMaterial();
  private readonly tint: ReturnType<typeof createHexTileTint>;
  private readonly borders: ReturnType<typeof createBorderController>;
  private readonly ambient: ReturnType<typeof createHexAmbient>;
  private effHeights: Float32Array;

  constructor(
    private readonly config: BiomeOrchestratorConfig,
    readonly look: PlanetSpec,
    initialLayers: HexTileLayers,
    opts: { colorBlindMode?: boolean; colonyColors?: Record<number, number>; precomputedEffHeights?: Float32Array } = {},
  ) {
    const { radius, edges } = config.planet;
    this.group = new THREE.Group();
    this.group.name = 'hexTerrain';
    const defs = chunkLayout(radius);
    this.byKey = new Map(defs.map((d) => [`${d.cq},${d.cr}`, d]));
    const ext = planetExtent(radius);
    this.halfSize = ext.z;

    this.effHeights = opts.precomputedEffHeights ?? computeEffectiveHeights(radius, initialLayers);
    this.heightAt = makeHeightSampler(radius, () => this.effHeights);
    this.tint = createHexTileTint(radius, initialLayers);

    this.uniforms = {
      ...terrainUniforms(look, HEX_WATER_LEVEL, ext.x * 1.2, [0, 0], this.tint.terraformTexture),
      ...this.tint.uniforms,
      uWind: getWindUniforms().uWindDir,
    };
    const edgeU: THREE.IUniform<number> = { value: edges };
    this.material = createTerrainMaterial(this.uniforms, (sh) => addHexEdges(sh, edgeU));
    this.material.customProgramCacheKey = () => 'taHexTerrain';

    this.water = createHexWater(radius, look, initialLayers);
    this.borders = createBorderController(radius, initialLayers, this.effHeights, opts.colorBlindMode ?? false, opts.colonyColors);
    this.borderMesh = this.borders.mesh;
    this.ambient = createHexAmbient(look, ext.z);

    this.group.add(this.water.group, this.borderMesh, this.ambient.points);
  }

  get chunks(): THREE.Mesh[] {
    return [...this.chunkMeshes.values()];
  }

  get effectiveHeights(): Float32Array {
    return this.effHeights;
  }

  hydrateFromWorkerChunks(effHeights: Float32Array, workerChunks: readonly WorkerChunkGeometryData[]): void {
    this.effHeights = effHeights;
    for (const wc of workerChunks) {
      const old = this.chunkMeshes.get(wc.key);
      if (old) {
        this.group.remove(old);
        old.geometry.dispose();
      }
      const m = makeChunkMeshFromBuffers(wc.cq, wc.cr, wc, this.material, this.depthMaterial);
      this.chunkMeshes.set(wc.key, m);
      this.group.add(m);
    }
  }

  /** Rebuilds dirty terrain chunks and returns the chunk definitions rebuilt so prop/resource orchestrators stay synced. */
  updateDirtyChunks(layers: HexTileLayers, changed?: ArrayLike<number>): ChunkDef[] {
    const { radius } = this.config.planet;
    const reach = this.config.terrain.dirtyReach;
    this.effHeights = computeEffectiveHeights(radius, layers);
    this.tint.update(layers, changed);
    this.water.update(layers, changed);

    const dirtyKeys: string[] = [];
    if (!changed) {
      dirtyKeys.push(...this.byKey.keys());
    } else {
      const hx = hexIndex(radius);
      const seen = new Set<string>();
      for (let n = 0; n < changed.length; n++) {
        const i = changed[n]!;
        if (i < 0 || i >= hx.count) continue;
        const q = hx.q[i]!, r = hx.r[i]!;
        for (let dq = -reach; dq <= reach; dq++) {
          for (let dr = -reach; dr <= reach; dr++) {
            const k = chunkKey(q + dq, r + dr);
            if (this.byKey.has(k) && !seen.has(k)) {
              seen.add(k);
              dirtyKeys.push(k);
            }
          }
        }
      }
    }

    const rebuilt: ChunkDef[] = [];
    for (const k of dirtyKeys) {
      const def = this.byKey.get(k)!;
      const old = this.chunkMeshes.get(k);
      if (old) {
        this.group.remove(old);
        old.geometry.dispose();
      }
      const buf = buildChunk(radius, def.tiles, layers, undefined, this.effHeights);
      const m = makeChunkMeshFromBuffers(def.cq, def.cr, buf, this.material, this.depthMaterial);
      this.chunkMeshes.set(k, m);
      this.group.add(m);
      rebuilt.push(def);
    }
    return rebuilt;
  }

  rebuildBorders(tiles: HexTileLayers): void {
    this.borders.rebuild(tiles, this.effHeights);
  }

  getTerritoryBorderStats(): TerritoryBorderStats {
    return this.borders.getStats();
  }

  setColorBlindMode(enabled: boolean, tiles: HexTileLayers): void {
    this.borders.setColorBlindMode(enabled, tiles, this.effHeights);
  }

  setColonyColors(colors: Record<number, number>, tiles: HexTileLayers): void {
    this.borders.setColonyColors(colors, tiles, this.effHeights);
  }

  tick(elapsedTime: number): void {
    if (this.uniforms.uTime) this.uniforms.uTime.value = elapsedTime;
    if (this.water.uniforms.uTime) this.water.uniforms.uTime.value = elapsedTime;
    this.water.cullToFocus();
    this.ambient.setTime(elapsedTime);
  }

  dispose(): void {
    for (const m of this.chunkMeshes.values()) {
      m.geometry.dispose();
      m.removeFromParent();
    }
    this.chunkMeshes.clear();
    this.depthMaterial.dispose();
    this.water.dispose();
    this.borders.dispose();
    this.material.dispose();
    this.tint.dispose();
    this.ambient.dispose();
  }
}
