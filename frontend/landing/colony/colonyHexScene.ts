import * as THREE from 'three';
import { isInPodBlastCircle } from '@terra/sim';
import { hexDistance, hexIndex } from '@terra/sim/grid/hex';
import {
  buildingCableAnchor,
  pylonCableAnchor,
  PYLON_CONDUCTORS,
  type CableAnchor,
  type CablePowerState,
  type CableSpan,
} from '@terra/render/lighting/gridCables';
import {
  HEX_DEPOSIT,
  HEX_PREP,
  HEX_TERRAIN,
  tileHash01,
  tileXZ,
  type HexTerrain,
  type HexTiles,
} from '@terra/render/planets/hex';

export const COLONY_HEX_RADIUS = 20;

/**
 * Building centers & footprints on the hex grid, spaced with wide gaps between every building
 * and a clear dry gap from the shoreline (`q + r >= 7`):
 * - HQ (`building.commandHub`, 3x3): center `(0, 0)` -> `q in [-1..1], r in [-1..1]`
 * - Pylon (`building.pylon`, 1x1): `(0, -3)` -> 2-hex gap north-west of HQ
 * - Solar Panel (`building.solar`, 2x2): `(-4, -1)` -> `q in [-4..-3], r in [-1..0]` (2-hex gap left of HQ)
 * - Metal Extractor (`building.mine`, 2x2): `(5, -2)` -> `q in [5..6], r in [-2..-1]` (4-hex wide gap to the right of HQ)
 */
const BUILDING_CENTERS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0, -3],
  [-4, -1],
  [-3, 0],
  [5, -2],
  [6, -1],
];

/** True when `(q, r)` lies inside the pod-arrival blast circle or within the clear base compound around buildings. */
function isInBaseClearZone(q: number, r: number, d: number): boolean {
  if (isInPodBlastCircle(0, 0, q, r)) return true;
  if (d <= 6) return true;
  for (const [bq, br] of BUILDING_CENTERS) {
    if (hexDistance(bq, br, q, r) <= 2) return true;
  }
  return false;
}

function isPreparedColonyPad(q: number, r: number, d: number): boolean {
  if (isInPodBlastCircle(0, 0, q, r) || d <= 4) return true;
  for (const [bq, br] of BUILDING_CENTERS) {
    if (hexDistance(bq, br, q, r) <= 1) return true;
  }
  return false;
}

function isOuterForestTile(q: number, r: number): boolean {
  const key = `${q},${r}`;
  const scenicOuterTrees = new Set([
    '-4,5', '-3,5', '-2,5', '-5,4', '-6,3', '-6,2',
    '-5,-1', '-6,-1', '-5,-2', '-4,-3', '-3,-4', '-2,-5', '0,-6', '2,-6', '4,-6', '6,-5',
  ]);
  if (scenicOuterTrees.has(key)) return true;
  return tileHash01(q, r, 7) < 0.65;
}

/**
 * Deterministic `HexTiles` for an `oceanForest` (Thalassa Verde) shoreline colony:
 * - Clear pod-arrival radius (`isInPodBlastCircle` + `d <= 5` around base) completely free of trees and obstacles
 * - Shallow & deep ocean water tiles set back at `q + r >= 5` so there is a wide dry gap between buildings and water
 * - Outer forest tree ring (`d >= 6`) framing the base clearing
 * - Metal deposit tiles at `(3, -3)..(4, -3)` (under the extractor) and `(5, -3)` (active mining vein)
 */
export function buildColonyHexTiles(radius = COLONY_HEX_RADIUS): HexTiles {
  const hx = hexIndex(radius);
  const terrain = new Uint8Array(hx.count).fill(HEX_TERRAIN.flat);
  const prep = new Uint8Array(hx.count).fill(HEX_PREP.wild);
  const height = new Float32Array(hx.count);
  const deposit = new Uint8Array(hx.count);
  const richness = new Uint16Array(hx.count);
  const owner = new Int8Array(hx.count).fill(-1);

  for (let i = 0; i < hx.count; i++) {
    const q = hx.q[i]!;
    const r = hx.r[i]!;
    const d = hexDistance(0, 0, q, r);
    const shoreDepth = q + r - 7;

    if (shoreDepth >= 0) {
      const isShallow = shoreDepth <= 1 || (shoreDepth === 2 && tileHash01(q, r, 3) < 0.45);
      terrain[i] = isShallow ? HEX_TERRAIN.shallow : HEX_TERRAIN.deep;
      height[i] = isShallow ? -0.35 : -0.85;
      continue;
    }

    if (d <= 7) owner[i] = 0;

    if ((q === 5 && r === -2) || (q === 6 && r === -2)) {
      terrain[i] = HEX_TERRAIN.flat;
      prep[i] = HEX_PREP.prepared;
      height[i] = 0.16;
      deposit[i] = HEX_DEPOSIT.metals;
      richness[i] = 10000;
      continue;
    }

    if (q === 7 && r === -2) {
      terrain[i] = HEX_TERRAIN.flat;
      prep[i] = HEX_PREP.wild;
      height[i] = 0.18;
      deposit[i] = HEX_DEPOSIT.metals;
      richness[i] = 10000;
      continue;
    }

    // Guaranteed stationary harvester work targets (1 rock, 2 trees; none on metals).
    if (q === 3 && r === -5) {
      terrain[i] = HEX_TERRAIN.rock;
      prep[i] = HEX_PREP.wild;
      height[i] = 0.36;
      continue;
    }
    if ((q === -3 && r === 5) || (q === -6 && r === 2)) {
      terrain[i] = HEX_TERRAIN.forest;
      prep[i] = HEX_PREP.wild;
      height[i] = 0.28;
      continue;
    }

    if (isInBaseClearZone(q, r, d)) {
      terrain[i] = HEX_TERRAIN.flat;
      prep[i] = isPreparedColonyPad(q, r, d) ? HEX_PREP.prepared : HEX_PREP.wild;
      height[i] = 0.16;
      continue;
    }

    if (isOuterForestTile(q, r)) {
      terrain[i] = HEX_TERRAIN.forest;
      prep[i] = HEX_PREP.wild;
      height[i] = 0.22 + tileHash01(q, r, 13) * 0.24;
    } else if (d >= 7 && tileHash01(q, r, 19) > 0.8) {
      terrain[i] = HEX_TERRAIN.rock;
      prep[i] = HEX_PREP.wild;
      height[i] = 0.34 + tileHash01(q, r, 23) * 0.3;
    } else {
      terrain[i] = HEX_TERRAIN.flat;
      prep[i] = HEX_PREP.wild;
      height[i] = 0.18 + tileHash01(q, r, 29) * 0.1;
    }
  }

  return { terrain, prep, height, deposit, richness, owner };
}

export function footprintGroundY(
  terrain: HexTerrain,
  q: number,
  r: number,
  footprint: '1x1' | '2x2' | '3x3',
): number {
  const [wx, wz] = footprint === '2x2' ? tileXZ(q + 0.5, r + 0.5) : tileXZ(q, r);
  let maxY = terrain.heightAt(wx, wz);
  if (footprint === '3x3') {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dq = -1; dq <= 1; dq++) {
        const [tx, tz] = tileXZ(q + dq, r + dr);
        maxY = Math.max(maxY, terrain.heightAt(tx, tz));
      }
    }
  } else if (footprint === '2x2') {
    for (let dr = 0; dr < 2; dr++) {
      for (let dq = 0; dq < 2; dq++) {
        const [tx, tz] = tileXZ(q + dq, r + dr);
        maxY = Math.max(maxY, terrain.heightAt(tx, tz));
      }
    }
  }
  return maxY;
}

export interface ColonyGridNode {
  id: number;
  archetypeId: string;
  isPylon: boolean;
  mesh: THREE.Object3D;
}

function worldCableAnchor(node: ColonyGridNode, tx: number, tz: number, conductor: number): CableAnchor {
  const { position: p, rotation, scale } = node.mesh;
  const yaw = rotation.y;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const wx = tx - p.x;
  const wz = tz - p.z;
  const lx = wx * cos - wz * sin;
  const lz = wx * sin + wz * cos;
  const geo = (node.mesh as THREE.Mesh).isMesh ? (node.mesh as THREE.Mesh).geometry ?? null : null;
  const strip = Number((geo?.userData as { stripOffsetY?: number } | undefined)?.stripOffsetY ?? 0);

  let local: CableAnchor;
  if (node.isPylon) {
    local = pylonCableAnchor(conductor, lx, strip);
  } else {
    if (geo && !geo.boundingBox) geo.computeBoundingBox();
    local = buildingCableAnchor(node.archetypeId, geo?.boundingBox ?? null, lx, lz, strip);
  }
  const s = scale.x || 1;
  const [x, y, z] = local;
  return [p.x + (x * cos + z * sin) * s, p.y + y * s, p.z + (-x * sin + z * cos) * s];
}

function makeSpan(
  up: ColonyGridNode,
  down: ColonyGridNode,
  conductor: number,
  state: CablePowerState,
  drop: boolean,
  seed: number,
): CableSpan {
  const a = worldCableAnchor(up, down.mesh.position.x, down.mesh.position.z, conductor);
  const b = worldCableAnchor(down, up.mesh.position.x, up.mesh.position.z, conductor);
  const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
  const sag = drop ? 0.1 + 0.05 * len : 0.15 + 0.06 * len;
  return {
    a,
    b,
    sag: -Math.min(1.2, sag),
    radius: drop ? 0.024 : 0.03,
    state,
    seed,
  };
}

/** Builds the exact in-game `CableSpan[]` wiring Command Hub <-> Pylon, Solar -> Pylon, and Pylon -> Metal Extractor. */
export function buildColonyPowerSpans(nodes: {
  hq: ColonyGridNode;
  pylon: ColonyGridNode;
  solar: ColonyGridNode;
  mine: ColonyGridNode;
}): CableSpan[] {
  const spans: CableSpan[] = [];
  for (let k = 0; k < PYLON_CONDUCTORS; k++) {
    const reverse = k % 2 === 1;
    spans.push(
      makeSpan(
        reverse ? nodes.pylon : nodes.hq,
        reverse ? nodes.hq : nodes.pylon,
        k,
        reverse ? 'demand' : 'online',
        false,
        0.17 + k * 0.31,
      ),
    );
  }
  spans.push(makeSpan(nodes.solar, nodes.pylon, 0, 'online', true, 0.42));
  spans.push(makeSpan(nodes.pylon, nodes.mine, 0, 'demand', true, 0.73));
  return spans;
}
