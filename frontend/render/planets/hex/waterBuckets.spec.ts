import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { hexIndex } from '@terra/sim/grid/hex';
import { setViewFocusEnabled, updateViewFocus } from '../../core/viewFocus';
import { WAVE_VERT_PEAK } from '../../visuals/water/waveModel';
import { HEX_TERRAIN, specForPlanetType } from './index';
import { createHexWater, type HexWater } from './hexWater';
import { tileAt, tileXZ } from './hexMath';
import { WATER_CELL_M, WATER_SHORE_PIN_Y } from './waterBuckets';

const RADIUS = 40;
const hx = hexIndex(RADIUS);

/** Water everywhere except a dry band (r = 0) and a dry island, so the water spans many cells and has shores. */
function oceanTiles() {
  const terrain = new Uint8Array(hx.count).fill(HEX_TERRAIN.deep);
  for (let i = 0; i < hx.count; i++) {
    const q = hx.q[i]!, r = hx.r[i]!;
    if (r === 0 || Math.hypot(q - 10, r - 10) < 4) terrain[i] = HEX_TERRAIN.flat;
    else if (Math.abs(r) < 3) terrain[i] = HEX_TERRAIN.shallow;
  }
  return { terrain, height: new Float32Array(hx.count) };
}

function makeWater(): { water: HexWater; tiles: ReturnType<typeof oceanTiles> } {
  const tiles = oceanTiles();
  const water = createHexWater(RADIUS, specForPlanetType('ocean'), tiles);
  water.group.updateMatrixWorld(true);
  return { water, tiles };
}

const isW = (t: ArrayLike<number>, i: number) => t[i] === HEX_TERRAIN.shallow || t[i] === HEX_TERRAIN.deep;

/** Reference: every lattice triangle touching a water tile, as a sorted tile-index triple. */
function referenceTriangles(t: ArrayLike<number>): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < hx.count; i++) {
    const q = hx.q[i]!, r = hx.r[i]!;
    for (const [b, c] of [[hx.indexOf(q + 1, r), hx.indexOf(q, r + 1)], [hx.indexOf(q, r - 1), hx.indexOf(q - 1, r)]] as const) {
      if (b >= 0 && c >= 0 && (isW(t, i) || isW(t, b) || isW(t, c))) out.add([i, b, c].sort((x, y) => x - y).join(','));
    }
  }
  return out;
}

/** The buckets' triangles as sorted tile-index triples (a duplicate fails the partition check). */
function bucketTriangles(water: HexWater): string[] {
  const out: string[] = [];
  for (const m of water.buckets) {
    const pos = m.geometry.getAttribute('position'), idx = m.geometry.index!;
    for (let k = 0; k < idx.count; k += 3) {
      const tri = [0, 1, 2].map((o) => tileAt(RADIUS, pos.getX(idx.getX(k + o)), pos.getZ(idx.getX(k + o)))!.i);
      out.push(tri.sort((x, y) => x - y).join(','));
    }
  }
  return out;
}

afterEach(() => setViewFocusEnabled(true));

describe('hex water buckets', () => {
  it('partition every water triangle exactly once, one mesh per cell, all sharing one material', () => {
    const { water, tiles } = makeWater();
    const ref = referenceTriangles(tiles.terrain);
    const got = bucketTriangles(water);
    expect(new Set(got).size).toBe(got.length);
    expect(new Set(got)).toEqual(ref);
    expect(water.waterTriangleCount).toBe(ref.size);
    expect(water.buckets.length).toBeGreaterThan(8);
    for (const m of water.buckets) {
      expect(m.material).toBe(water.material);
      expect(m.receiveShadow).toBe(true);
      expect(m.renderOrder).toBe(1);
      const cells = new Set<string>();
      // every triangle's owner tile (its first index in build order) lies in the bucket's cell
      const pos = m.geometry.getAttribute('position');
      for (let v = 0; v < pos.count; v++) cells.add(`${Math.floor(pos.getX(v) / WATER_CELL_M)},${Math.floor(pos.getZ(v) / WATER_CELL_M)}`);
      expect(cells.has(m.userData.waterCell)).toBe(true);
    }
    expect(water.waterTileCount).toBe(Array.from(tiles.terrain, (_, i) => isW(tiles.terrain, i)).filter(Boolean).length);
    water.dispose();
  });

  it('bucket bounds contain every vertex plus the vertex swell (±WAVE_VERT_PEAK) and the shore pin', () => {
    const { water } = makeWater();
    let pinned = 0;
    for (const m of water.buckets) {
      const box = m.geometry.boundingBox!, s = m.geometry.boundingSphere!;
      expect(box.min.y).toBeLessThanOrEqual(-WAVE_VERT_PEAK);
      expect(box.max.y).toBeGreaterThanOrEqual(WAVE_VERT_PEAK);
      const pos = m.geometry.getAttribute('position'), p = new THREE.Vector3();
      for (let v = 0; v < pos.count; v++) {
        p.fromBufferAttribute(pos, v);
        const pin = p.y === Math.fround(WATER_SHORE_PIN_Y);
        if (pin) pinned++;
        else expect(p.y).toBe(0);
        // the shader masks the swell off pinned shore vertices; water vertices move by up to ±WAVE_VERT_PEAK
        for (const dy of pin ? [0] : [-WAVE_VERT_PEAK, 0, WAVE_VERT_PEAK]) {
          const q = p.clone().setY(p.y + dy);
          expect(box.containsPoint(q)).toBe(true);
          expect(s.distanceToPoint(q)).toBeLessThan(1e-4);
        }
      }
    }
    expect(pinned).toBeGreaterThan(0);
    water.dispose();
  });

  it('three frustum-culls far buckets, and cullToFocus hides buckets outside the view focus', () => {
    const { water } = makeWater();
    const cam = new THREE.PerspectiveCamera(30, 16 / 9, 0.5, 400);
    cam.position.set(-50, 25, -20);
    cam.lookAt(-60, 0, -30);
    cam.updateMatrixWorld();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const inView = water.buckets.filter((m) => frustum.intersectsObject(m));
    expect(inView.length).toBeGreaterThan(0);
    expect(inView.length).toBeLessThan(water.buckets.length);

    updateViewFocus(cam);
    water.cullToFocus();
    const shown = water.buckets.filter((m) => m.visible);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(water.buckets.length);
    for (const m of water.buckets) if (frustum.intersectsObject(m) && m.geometry.boundingSphere!.center.distanceTo(cam.position) < 120) expect(m.visible).toBe(true);

    setViewFocusEnabled(false);
    updateViewFocus(cam);
    water.cullToFocus();
    expect(water.buckets.every((m) => m.visible)).toBe(true);
    water.dispose();
  });

  it('a water-tile change rebuilds only the buckets around it; a dry-only change rebuilds nothing', () => {
    const { water, tiles } = makeWater();
    const before = new Map(water.buckets.map((m) => [m.userData.waterCell as string, m.geometry]));
    const i = hx.indexOf(-12, 9);
    const [x, z] = tileXZ(-12, 9);
    tiles.terrain[i] = HEX_TERRAIN.flat;
    water.update(tiles, [i]);
    const touched = water.buckets.filter((m) => m.geometry !== before.get(m.userData.waterCell));
    expect(touched.length).toBeGreaterThanOrEqual(1);
    expect(touched.length).toBeLessThanOrEqual(4); // its own cell and at most the neighbouring ones
    for (const m of touched) expect(m.geometry.boundingSphere!.center.distanceTo(new THREE.Vector3(x, 0, z))).toBeLessThan(WATER_CELL_M * 1.5);
    expect(new Set(bucketTriangles(water))).toEqual(referenceTriangles(tiles.terrain));

    const after = water.buckets.map((m) => m.geometry);
    const dry = hx.indexOf(0, 0);
    tiles.terrain[dry] = HEX_TERRAIN.forest; // dry stays dry
    water.update(tiles, [dry]);
    expect(water.buckets.map((m) => m.geometry)).toEqual(after);
    water.buckets.forEach((m, k) => expect(m.geometry).toBe(after[k]));
    water.dispose();
  });
});
