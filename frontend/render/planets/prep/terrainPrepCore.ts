import { PLANET_SPECS } from '../PlanetSpec';
import { createHeightField } from '../../visuals/terrain/heightfields';
import {
  bakeBedrockMask,
  buildTerrainGrid,
  packHeightHalfFloat,
  type PrecomputedGlobeSpheres,
  type SphereGeometryBuffers,
  type TerrainGridData,
} from '../../visuals/terrain/TerrainGrid';
import { buildChunk, computeEffectiveHeights, type HexTileLayers } from '../hex/chunkMesh';
import { chunkLayout } from '../hex/chunks';
import { scatterChunkProps } from '../hex/chunkPropScatter';
import type { PrecomputedChunkEntry } from '../hex/chunkSet';
import type { PrecomputedHexTerrainData } from '../hex/createHexTerrain';
import { makeHeightSampler } from '../hex/heightSampler';
import { computeHexWaterField } from '../hex/hexWater';
import { computeTileTintBuffers } from '../hex/tileTint';
import type {
  HexTerrainPrepRequest,
  HexTileTransferArrays,
  SurfacePrepRequest,
  TerrainPrepRequest,
  TerrainPrepResponse,
} from './types';

function pushTransfer(set: Set<ArrayBuffer>, view: ArrayBufferView | undefined | null): void {
  if (view && view.buffer instanceof ArrayBuffer) {
    set.add(view.buffer);
  }
}

/**
 * Fast, zero-GC sphere tessellation directly into typed arrays (`position`, `normal`, `index`), matching
 * `THREE.SphereGeometry(radius, widthSegments, heightSegments)` without millions of JS `Array.push` allocations.
 */
export function buildSphereBuffers(
  radius: number,
  widthSegments: number,
  heightSegments: number,
): SphereGeometryBuffers {
  const w = Math.max(3, Math.floor(widthSegments));
  const h = Math.max(2, Math.floor(heightSegments));
  const stride = w + 1;
  const vertCount = stride * (h + 1);
  const pos = new Float32Array(vertCount * 3);
  const nor = new Float32Array(vertCount * 3);
  const cosPhi = new Float32Array(stride);
  const sinPhi = new Float32Array(stride);
  for (let ix = 0; ix <= w; ix++) {
    const phi = (ix / w) * Math.PI * 2;
    cosPhi[ix] = Math.cos(phi);
    sinPhi[ix] = Math.sin(phi);
  }
  let vOff = 0;
  for (let iy = 0; iy <= h; iy++) {
    const theta = (iy / h) * Math.PI;
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);
    for (let ix = 0; ix <= w; ix++) {
      const nx = -cosPhi[ix]! * sinT;
      const ny = cosT;
      const nz = sinPhi[ix]! * sinT;
      nor[vOff] = nx;
      nor[vOff + 1] = ny;
      nor[vOff + 2] = nz;
      pos[vOff] = radius * nx;
      pos[vOff + 1] = radius * ny;
      pos[vOff + 2] = radius * nz;
      vOff += 3;
    }
  }
  const idx = new Uint32Array(w * (h - 1) * 6);
  let iOff = 0;
  for (let iy = 0; iy < h; iy++) {
    const row = iy * stride;
    const nextRow = (iy + 1) * stride;
    for (let ix = 0; ix < w; ix++) {
      const a = row + ix + 1;
      const b = row + ix;
      const c = nextRow + ix;
      const d = nextRow + ix + 1;
      if (iy !== 0) {
        idx[iOff++] = a;
        idx[iOff++] = b;
        idx[iOff++] = d;
      }
      if (iy !== h - 1) {
        idx[iOff++] = b;
        idx[iOff++] = c;
        idx[iOff++] = d;
      }
    }
  }
  return { radius, widthSegments: w, heightSegments: h, pos, nor, idx };
}

function buildDescentGlobeSpheres(buffers: Set<ArrayBuffer>): PrecomputedGlobeSpheres {
  const R = 4000;
  const surface = buildSphereBuffers(R, 512, 256);
  const clouds = buildSphereBuffers(R * (1 + 150 / R), 384, 192);
  const atmo = buildSphereBuffers(R * 1.035, 192, 96);
  for (const s of [surface, clouds, atmo]) {
    pushTransfer(buffers, s.pos);
    pushTransfer(buffers, s.nor);
    pushTransfer(buffers, s.idx);
  }
  return { surface, clouds, atmo };
}

export function computeSurfacePrep(req: Omit<SurfacePrepRequest, 'id' | 'type'>): {
  grid: TerrainGridData;
  transfer: Transferable[];
} {
  const spec = { ...PLANET_SPECS[req.kind], seed: req.seed };
  const half = req.halfSize;
  const N = req.quality === 'high' ? 420 : 240;
  const span = half * 4;
  const field = createHeightField(spec, half * 2);
  const grid = buildTerrainGrid(field, span, N);
  const rk = bakeBedrockMask(grid, field);
  const heightTexHalf = packHeightHalfFloat(grid.hs);

  const buffers = new Set<ArrayBuffer>();
  const globeSpheres = req.includeDescentGlobe !== false ? buildDescentGlobeSpheres(buffers) : undefined;
  const out: TerrainGridData = { ...grid, rk, heightTexHalf, ...(globeSpheres ? { globeSpheres } : {}) };

  pushTransfer(buffers, out.hs);
  pushTransfer(buffers, out.pos);
  pushTransfer(buffers, out.nor);
  pushTransfer(buffers, out.ao);
  pushTransfer(buffers, out.idx);
  pushTransfer(buffers, out.rk);
  pushTransfer(buffers, out.heightTexHalf);
  return { grid: out, transfer: [...buffers] };
}

export function computeHexTerrainPrep(req: Omit<HexTerrainPrepRequest, 'id' | 'type'>): {
  data: PrecomputedHexTerrainData;
  transfer: Transferable[];
} {
  const look = { ...PLANET_SPECS[req.kind], seed: req.seed };
  const layers: HexTileLayers = { ...req.tiles, kind: req.kind };
  const effHeights = computeEffectiveHeights(req.radius, layers);
  const tint = computeTileTintBuffers(req.radius, layers);
  const water = computeHexWaterField(req.radius, look, layers);
  const heightAt = makeHeightSampler(req.radius, () => effHeights);

  const chunks: Record<string, PrecomputedChunkEntry> = {};
  const buffers = new Set<ArrayBuffer>();
  pushTransfer(buffers, effHeights);
  pushTransfer(buffers, tint.tintData);
  pushTransfer(buffers, tint.terraformData);
  pushTransfer(buffers, tint.hexGridData);
  pushTransfer(buffers, tint.hexGrid);
  if (water) {
    pushTransfer(buffers, water.codes);
    pushTransfer(buffers, water.field.bed);
    pushTransfer(buffers, water.field.dist);
    pushTransfer(buffers, water.field.mask);
    pushTransfer(buffers, water.shoreFieldHalf);
  }

  for (const def of chunkLayout(req.radius)) {
    const key = `${def.cq},${def.cr}`;
    const b = buildChunk(req.radius, def.tiles, layers, undefined, effHeights);
    const props = scatterChunkProps(req.radius, def.tiles, layers, heightAt);
    chunks[key] = { buffers: b, props };
    pushTransfer(buffers, b.position);
    pushTransfer(buffers, b.normal);
    pushTransfer(buffers, b.aAO);
    pushTransfer(buffers, b.aRock);
    pushTransfer(buffers, b.aHexShore);
    pushTransfer(buffers, b.index);
    pushTransfer(buffers, b.rockIndex);
    pushTransfer(buffers, b.vertexTile);
  }

  return {
    data: {
      radius: req.radius,
      kind: req.kind,
      effHeights,
      tint,
      water,
      chunks,
    },
    transfer: [...buffers],
  };
}

/** Clones `HexTileLayers` into standalone typed arrays safe to transfer to a background Web Worker. */
export function cloneTilesForWorker(tiles: {
  terrain: ArrayLike<number>;
  height: ArrayLike<number>;
  prep?: ArrayLike<number>;
  deposit?: ArrayLike<number>;
  depositTier?: ArrayLike<number>;
  richness?: ArrayLike<number>;
  owner?: ArrayLike<number>;
}): { cloned: HexTileTransferArrays; transfer: Transferable[] } {
  const terrain = Uint8Array.from(tiles.terrain);
  const height = Float32Array.from(tiles.height);
  const prep = tiles.prep ? Uint8Array.from(tiles.prep) : undefined;
  const deposit = tiles.deposit ? Uint8Array.from(tiles.deposit) : undefined;
  const depositTier = tiles.depositTier ? Uint8Array.from(tiles.depositTier) : undefined;
  const richness = tiles.richness ? Float32Array.from(tiles.richness) : undefined;
  const owner = tiles.owner ? Int16Array.from(tiles.owner) : undefined;

  const buffers = new Set<ArrayBuffer>();
  pushTransfer(buffers, terrain);
  pushTransfer(buffers, height);
  pushTransfer(buffers, prep);
  pushTransfer(buffers, deposit);
  pushTransfer(buffers, depositTier);
  pushTransfer(buffers, richness);
  pushTransfer(buffers, owner);

  return {
    cloned: {
      terrain,
      height,
      ...(prep ? { prep } : {}),
      ...(deposit ? { deposit } : {}),
      ...(depositTier ? { depositTier } : {}),
      ...(richness ? { richness } : {}),
      ...(owner ? { owner } : {}),
    },
    transfer: [...buffers],
  };
}

export function handleTerrainPrepRequest(req: TerrainPrepRequest): {
  response: TerrainPrepResponse;
  transfer: Transferable[];
} {
  try {
    if (req.type === 'surface') {
      const { grid, transfer } = computeSurfacePrep(req);
      return { response: { id: req.id, type: 'surface', grid }, transfer };
    }
    const { data, transfer } = computeHexTerrainPrep(req);
    return { response: { id: req.id, type: 'hexTerrain', data }, transfer };
  } catch (err) {
    return {
      response: { id: req.id, type: 'error', message: err instanceof Error ? err.message : String(err) },
      transfer: [],
    };
  }
}
