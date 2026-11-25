import * as THREE from 'three';

export const RING_SEGMENTS = 128;
export const RING_HEIGHT_MIN = -24;
export const RING_HEIGHT_SPAN = 64;
export const RING_SLOPE_MIN = -4;
export const RING_SLOPE_SPAN = 8;

export type RingHeightSampler = (worldX: number, worldZ: number) => number;

/** Encodes a bounded scalar into an unsigned 16-bit big-endian byte pair `[hi, lo]`. */
export function encodeU16Pair(value: number, min: number, span: number): [number, number] {
  const safeVal = Number.isFinite(value) ? value : min;
  const t = Math.max(0, Math.min(1, (safeVal - min) / span));
  const q = Math.round(t * 65535);
  return [(q >>> 8) & 255, q & 255];
}

/** Decodes a big-endian byte pair `[hi, lo]` back into a scalar in `[min, min + span]`. */
export function decodeU16Pair(hi: number, lo: number, min: number, span: number): number {
  const q = (hi * 256 + lo) / 65535;
  return min + q * span;
}

/** Computes world-metre half-width for a ring band, matching the vertex shader formula. */
export function computeRingHalfWidthM(radiusMeters: number, kindCode: number): number {
  const isView = kindCode > 1.5 && kindCode < 2.5 ? 1 : 0;
  const baseHalfW = 0.22 + (0.17 - 0.22) * isView;
  return Math.max(0.04, Math.min(0.24, Math.min(baseHalfW, Math.max(0.05, radiusMeters) * 0.08)));
}

/** Allocates a per-instance perimeter height & radial-slope lookup texture (`RING_SEGMENTS x maxInstances`). */
export function createRingHeightTexture(maxInstances: number): {
  texture: THREE.DataTexture;
  data: Uint8Array;
  width: number;
  height: number;
} {
  const width = RING_SEGMENTS;
  const height = Math.max(1, maxInstances);
  const data = new Uint8Array(width * height * 4);
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.flipY = false;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return { texture, data, width, height };
}

/** Packs one ring's perimeter surface heights (RG) and radial slope deltas (BA) into `data` at `rowIdx`. */
export function writeRingHeightRow(
  data: Uint8Array,
  rowIdx: number,
  worldX: number,
  worldZ: number,
  radiusMeters: number,
  fallbackWorldY: number,
  halfWidthM: number,
  heightSampler: RingHeightSampler | null | undefined,
  yOffset: number,
): void {
  const rowOffset = rowIdx * RING_SEGMENTS * 4;
  if (!heightSampler) {
    const [hHi, hLo] = encodeU16Pair(fallbackWorldY, RING_HEIGHT_MIN, RING_HEIGHT_SPAN);
    const [sHi, sLo] = encodeU16Pair(0, RING_SLOPE_MIN, RING_SLOPE_SPAN);
    for (let k = 0; k < RING_SEGMENTS; k++) {
      const p = rowOffset + k * 4;
      data[p] = hHi;
      data[p + 1] = hLo;
      data[p + 2] = sHi;
      data[p + 3] = sLo;
    }
    return;
  }

  const innerR = Math.max(0.02, radiusMeters - halfWidthM);
  const outerR = radiusMeters + halfWidthM;
  for (let k = 0; k < RING_SEGMENTS; k++) {
    const theta = (k / RING_SEGMENTS) * Math.PI * 2;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const hCenter = heightSampler(worldX + cos * radiusMeters, worldZ + sin * radiusMeters) + yOffset;
    const hOuter = heightSampler(worldX + cos * outerR, worldZ + sin * outerR) + yOffset;
    const hInner = heightSampler(worldX + cos * innerR, worldZ + sin * innerR) + yOffset;
    const [hHi, hLo] = encodeU16Pair(hCenter, RING_HEIGHT_MIN, RING_HEIGHT_SPAN);
    const [sHi, sLo] = encodeU16Pair(hOuter - hInner, RING_SLOPE_MIN, RING_SLOPE_SPAN);
    const p = rowOffset + k * 4;
    data[p] = hHi;
    data[p + 1] = hLo;
    data[p + 2] = sHi;
    data[p + 3] = sLo;
  }
}

/** Builds a smooth closed ribbon annulus on XZ with `aRingVertex = [segmentIdx, edgeSign, angleNorm]`. */
export function buildUnitRingRibbonGeometry(segments: number = RING_SEGMENTS): THREE.BufferGeometry {
  const vertCount = (segments + 1) * 2;
  const positions = new Float32Array(vertCount * 3);
  const ringVerts = new Float32Array(vertCount * 3);
  const indices = new Uint16Array(segments * 6);

  for (let i = 0; i <= segments; i++) {
    const angleNorm = i / segments;
    const theta = angleNorm * Math.PI * 2;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const segTex = i % segments;

    const vIn = i * 2;
    positions[vIn * 3] = cos * 0.97;
    positions[vIn * 3 + 1] = 0;
    positions[vIn * 3 + 2] = sin * 0.97;
    ringVerts[vIn * 3] = segTex;
    ringVerts[vIn * 3 + 1] = -1;
    ringVerts[vIn * 3 + 2] = angleNorm;

    const vOut = vIn + 1;
    positions[vOut * 3] = cos;
    positions[vOut * 3 + 1] = 0;
    positions[vOut * 3 + 2] = sin;
    ringVerts[vOut * 3] = segTex;
    ringVerts[vOut * 3 + 1] = 1;
    ringVerts[vOut * 3 + 2] = angleNorm;
  }

  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    const t = i * 6;
    indices[t] = a;
    indices[t + 1] = b;
    indices[t + 2] = d;
    indices[t + 3] = a;
    indices[t + 4] = d;
    indices[t + 5] = c;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aRingVertex', new THREE.BufferAttribute(ringVerts, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}
