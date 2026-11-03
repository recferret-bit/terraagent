import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { hexIndex } from '@terra/sim/grid/hex';
import { planetExtent, tileAt } from '../../planets/hex/hexMath';
import { hexWaterCodeAt } from '../../planets/hex/hexWater';
import {
  BED_DEEP, BED_DRY, BED_EDGE, BED_SHALLOW, SHORE_DIST_MAX, bakeShoreField, createShoreField, createShoreFieldTexture,
  sampleField, squaredEdt, texelCentre, writeShoreFieldTexture,
} from './shoreField';

describe('squaredEdt', () => {
  it('matches brute force on a random mask', () => {
    const res = 24;
    const seeds: number[] = [];
    let s = 7;
    for (let k = 0; k < res * res; k++) { s = (s * 1103515245 + 12345) >>> 0; if (s % 17 === 0) seeds.push(k); }
    const d2 = new Float32Array(res * res).fill(1e20);
    for (const k of seeds) d2[k] = 0;
    squaredEdt(d2, res);
    for (let k = 0; k < res * res; k++) {
      const x = k % res, y = Math.floor(k / res);
      let best = Infinity;
      for (const t of seeds) best = Math.min(best, (t % res - x) ** 2 + (Math.floor(t / res) - y) ** 2);
      expect(d2[k]).toBe(best);
    }
  });
});

describe('bakeShoreField', () => {
  // A 40 m wide lake strip |x| < 20 (shallow), deep core |x| < 8, inside a 64 m span.
  const span = 64, res = 128;
  const strip = (x: number) => (Math.abs(x) < 8 ? 2 : Math.abs(x) < 20 ? 1 : 0);
  const f = bakeShoreField((x) => strip(x), createShoreField(span, res));
  const at = (arr: ArrayLike<number>, x: number) => sampleField(f, arr, x, 0);

  it('writes mask, 0 m at the shore, exact distance inland (clamped)', () => {
    expect(at(f.mask, 25)).toBe(0);
    expect(at(f.mask, 19.9)).toBe(1);
    expect(at(f.dist, 25)).toBe(0);
    expect(at(f.dist, 19.9)).toBeLessThan(f.texel);
    for (const x of [18, 15, 12, 9]) expect(Math.abs(at(f.dist, x) - (20 - x))).toBeLessThan(f.texel);
    expect(at(f.dist, 0)).toBe(SHORE_DIST_MAX);
  });

  it('distance grows monotonically inland along a row', () => {
    const j = res / 2;
    let prev = -1;
    for (let i = res - 1; i >= 0; i--) { // walk from the x = +20 shore to the centre
      const x = texelCentre(i, res, span);
      if (x >= 20) continue;
      if (x < 0) break;
      const d = f.dist[j * res + i]!;
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
  });

  it('bed slopes to the edge, keeps deep / shallow targets, dry is BED_DRY', () => {
    expect(at(f.bed, 25)).toBeCloseTo(BED_DRY, 5);
    expect(at(f.bed, 19.9)).toBeGreaterThan(BED_EDGE - 0.05);
    expect(at(f.bed, 14)).toBeCloseTo(BED_SHALLOW, 2);
    expect(at(f.bed, 0)).toBeCloseTo(BED_DEEP, 2);
    // Softened deep / shallow step: monotone, no jump bigger than the blur allows.
    let prev = at(f.bed, 19.9);
    for (let x = 19.5; x >= 0; x -= f.texel) {
      const b = at(f.bed, x);
      expect(b).toBeLessThanOrEqual(prev + 1e-6);
      expect(prev - b).toBeLessThan(0.25);
      prev = b;
    }
  });

  it('no water -> empty mask, dry bed; all water -> clamped distance', () => {
    const dry = bakeShoreField(() => 0, createShoreField(span, 16));
    expect(dry.waterTexels).toBe(0);
    expect(Math.max(...dry.mask)).toBe(0);
    expect(dry.bed.every((b) => Math.abs(b - BED_DRY) < 1e-6)).toBe(true);
    const wet = bakeShoreField(() => 2, createShoreField(span, 16));
    expect(wet.waterTexels).toBe(256);
    expect(wet.dist.every((d) => d === SHORE_DIST_MAX)).toBe(true);
  });

  it('packs an RGBA HalfFloat texture', () => {
    const tex = createShoreFieldTexture(res);
    writeShoreFieldTexture(tex, f);
    expect(tex.format).toBe(THREE.RGBAFormat);
    expect(tex.type).toBe(THREE.HalfFloatType);
    expect(tex.generateMipmaps).toBe(false);
    const data = tex.image.data as Uint16Array;
    const k = (res / 2) * res + res / 2;
    expect(THREE.DataUtils.fromHalfFloat(data[k * 4]!)).toBeCloseTo(f.bed[k]!, 2);
    expect(THREE.DataUtils.fromHalfFloat(data[k * 4 + 1]!)).toBeCloseTo(SHORE_DIST_MAX, 2);
    expect(THREE.DataUtils.fromHalfFloat(data[k * 4 + 2]!)).toBe(1);
    tex.dispose();
  });

  it('bakes a radius-56 hex planet at 512² quickly', () => {
    const radius = 56;
    const span = Math.max(16, planetExtent(radius).x * 2.2);
    const count = hexIndex(radius).count;
    const codes = new Uint8Array(count);
    for (let i = 0; i < count; i++) codes[i] = i % 7 === 0 ? 2 : i % 3 === 0 ? 1 : 0;
    const codeAt = hexWaterCodeAt(radius, codes);
    for (let n = 0; n < 2000; n++) { // the fast lookup agrees with tileAt
      const x = Math.sin(n * 12.9898) * span * 0.5, z = Math.cos(n * 78.233) * span * 0.5;
      const hit = tileAt(radius, x, z);
      expect(codeAt(x, z)).toBe(hit ? codes[hit.i] : 0);
    }
    const field = createShoreField(span);
    const tex = createShoreFieldTexture();
    bakeShoreField(codeAt, field); // warm-up (JIT)
    const t0 = performance.now();
    bakeShoreField(codeAt, field);
    writeShoreFieldTexture(tex, field);
    const ms = performance.now() - t0;
    console.info(`[shoreField] radius 56, 512², span ${span.toFixed(1)} m: ${ms.toFixed(1)} ms`);
    expect(field.waterTexels).toBeGreaterThan(0);
    expect(ms).toBeLessThan(150); // loose CI bound; target < 30 ms on a dev machine
    tex.dispose();
  });
});
