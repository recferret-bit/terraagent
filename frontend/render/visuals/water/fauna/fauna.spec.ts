import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { bakeShoreField, createShoreField, sampleField, type ShoreField } from '../shoreField';
import { resetWaterParams, setWaterFx, setWaterParams } from '../waterConfig';
import { resetWindParams, setWindParams } from '../../../core/windConfig';
import { swellTroughDepth, WAVE_VERT_PEAK } from '../waveModel';
import { createFaunaSink, targetFaunaSink } from './faunaSink';
import { buildJellyGeometry, JELLY_TRIANGLES } from './jellyGeometry';
import { JELLY_CAP, JELLY_TENTACLE_LEN, createJellyBuffers, jellyPathPoint, layoutJellies, visibleJellyCount } from './jellyPlacement';
import { buildFishGeometry, FISH_TRIANGLES } from './fishGeometry';
import {
  BED_CLEARANCE, FAUNA_CAP, FAUNA_SINK_MAX, SHORE_CLEARANCE, SPECIES_SOLITARY, createFaunaBuffers, fishPathPoint, layoutFauna,
  targetFishCount, visibleFishCount,
} from './faunaPlacement';
import { createWaterFauna } from './WaterFauna';
import { setViewFocusEnabled, updateViewFocus } from '../../../core/viewFocus';

/** Round lake (radius 22 m) with a deep core (radius 12 m) and a small dry island at (6, 0). */
const lakeCode = (x: number, z: number) => {
  const d = Math.hypot(x, z);
  if (Math.hypot(x - 6, z) < 2.5) return 0;
  return d < 12 ? 2 : d < 22 ? 1 : 0;
};
/** Two round lakes (radius 22 m, deep core 12 m) 140 m apart, at x = -70 and x = +70. */
const twoLakesCode = (x: number, z: number) => lakeCode(x < 0 ? x + 70 : x - 70, z);
const bake = (code: (x: number, z: number) => number, span = 64, res = 256): ShoreField => bakeShoreField(code, createShoreField(span, res));

describe('fish geometry', () => {
  it('is a 42-triangle fish with outward body normals and a tail-weight attribute', () => {
    const g = buildFishGeometry();
    expect(g.index!.count / 3).toBe(FISH_TRIANGLES);
    const pos = g.getAttribute('position'), nor = g.getAttribute('normal'), body = g.getAttribute('aBody');
    let outward = 0, bodyVerts = 0;
    for (let k = 0; k < pos.count; k++) {
      expect(body.getX(k)).toBeGreaterThanOrEqual(0);
      expect(body.getX(k)).toBeLessThanOrEqual(1);
      if (body.getZ(k) > 0) continue; // fins
      bodyVerts++;
      if (pos.getX(k) * nor.getX(k) + pos.getY(k) * nor.getY(k) >= -1e-6) outward++;
    }
    expect(outward).toBe(bodyVerts);
    g.computeBoundingBox();
    expect(g.boundingBox!.max.z).toBeCloseTo(0.5, 5);
    expect(g.boundingBox!.min.z).toBeCloseTo(-0.5, 5);
    g.dispose();
  });
});

describe('fauna placement', () => {
  const field = bake(lakeCode);

  it('is deterministic for a field + seed and differs by seed', () => {
    const a = createFaunaBuffers(), b = createFaunaBuffers(), c = createFaunaBuffers();
    const la = layoutFauna(field, 2202, a), lb = layoutFauna(field, 2202, b);
    layoutFauna(field, 99, c);
    expect(la.placed).toBeGreaterThan(0);
    expect(lb).toEqual(la);
    expect(Array.from(b.swim)).toEqual(Array.from(a.swim));
    expect(Array.from(c.swim)).not.toEqual(Array.from(a.swim));
  });

  it('every fish stays clear of the shore and the bed along its whole loop', () => {
    const buf = createFaunaBuffers();
    const lay = layoutFauna(field, 2202, buf);
    let solitary = 0;
    for (let i = 0; i < lay.placed; i++) {
      const length = buf.fish[i * 4 + 2]!;
      if (buf.fish[i * 4 + 3] === SPECIES_SOLITARY) solitary++;
      for (let t = 0; t < 240; t += 0.37) {
        const [x, y, z] = fishPathPoint(buf, i, t, FAUNA_SINK_MAX); // deepest wave sink: still above the bed
        expect(sampleField(field, field.mask, x, z)).toBe(1);
        // body half-length on either side of the centre point, within the clearance budget
        expect(sampleField(field, field.dist, x, z)).toBeGreaterThanOrEqual(SHORE_CLEARANCE + length * 0.5 - field.texel);
        const bed = sampleField(field, field.bed, x, z);
        expect(y - length * 0.15 - bed).toBeGreaterThanOrEqual(BED_CLEARANCE - 0.02);
        expect(fishPathPoint(buf, i, t)[1]).toBeLessThan(-0.1);
      }
    }
    expect(solitary).toBeGreaterThan(0);
  });

  it('count scales with density, rounds to whole groups and respects the cap', () => {
    const lay = layoutFauna(field, 2202, createFaunaBuffers());
    expect(lay.placed).toBeLessThanOrEqual(FAUNA_CAP);
    const n0 = visibleFishCount(lay, 0), n1 = visibleFishCount(lay, 1), n2 = visibleFishCount(lay, 2);
    expect(n0).toBe(0);
    expect(n1).toBeGreaterThan(0);
    expect(n2).toBeGreaterThan(n1);
    expect(n2).toBeLessThanOrEqual(lay.placed);
    expect(lay.groupEnds).toContain(n1);
    expect(Math.abs(n1 - targetFishCount(lay.waterArea, 1))).toBeLessThanOrEqual(9);
    const huge = bake(() => 2, 400, 256);
    const big = layoutFauna(huge, 1, createFaunaBuffers());
    expect(big.placed).toBeLessThanOrEqual(FAUNA_CAP);
    expect(big.placed).toBeGreaterThan(FAUNA_CAP * 0.8);
    expect(visibleFishCount(big, 2)).toBeLessThanOrEqual(FAUNA_CAP);
  });

  it('no water (or only a narrow channel) -> no fish', () => {
    expect(layoutFauna(bake(() => 0), 1, createFaunaBuffers()).placed).toBe(0);
    expect(layoutFauna(bake((x) => (Math.abs(x) < 1.5 ? 1 : 0)), 1, createFaunaBuffers()).placed).toBe(0);
  });
});

describe('fauna depth follows the waves', () => {
  afterEach(() => { resetWaterParams(); resetWindParams(); });

  it('the swell trough grows with wind and wave height and stays under the soft clamp', () => {
    expect(swellTroughDepth(0, 1, 1)).toBeGreaterThan(0); // calm water keeps a residual swell
    expect(swellTroughDepth(1, 1, 1)).toBeGreaterThan(swellTroughDepth(0, 1, 1));
    expect(swellTroughDepth(1, 2, 1)).toBeGreaterThan(swellTroughDepth(1, 1, 1));
    expect(swellTroughDepth(0.5, 1, 0.5)).toBeLessThan(swellTroughDepth(0.5, 1, 1)); // short waves leave the mesh
    expect(swellTroughDepth(3, 2, 2)).toBeLessThanOrEqual(WAVE_VERT_PEAK);
  });

  it('the sink target follows the WATER wave height and the WIND strength, capped at FAUNA_SINK_MAX', () => {
    setWaterParams({ waveHeight: 0 });
    expect(targetFaunaSink()).toBe(0);
    setWaterParams({ waveHeight: 1 });
    const mid = targetFaunaSink();
    setWaterParams({ waveHeight: 2 });
    expect(targetFaunaSink()).toBeGreaterThan(mid);
    setWindParams({ strength: 2, gust: 1 });
    expect(targetFaunaSink()).toBeLessThanOrEqual(FAUNA_SINK_MAX);
  });

  it('eases toward the target instead of snapping', () => {
    setWaterParams({ waveHeight: 0 });
    const s = createFaunaSink();
    s.step(0);
    setWaterParams({ waveHeight: 2 });
    s.step(50);
    expect(s.uniform.value).toBeGreaterThan(0);
    expect(s.uniform.value).toBeLessThan(targetFaunaSink() * 0.2);
    for (let t = 100; t < 10000; t += 50) s.step(t);
    expect(s.uniform.value).toBeCloseTo(targetFaunaSink(), 3);
  });
});

describe('jellyfish', () => {
  const field = bake(lakeCode);

  it('geometry: a lathed bell plus tentacle ribbons', () => {
    const g = buildJellyGeometry();
    expect(g.index!.count / 3).toBe(JELLY_TRIANGLES);
    expect(g.getAttribute('aJel').count).toBe(g.getAttribute('position').count);
    g.computeBoundingBox();
    expect(g.boundingBox!.min.y).toBeCloseTo(-JELLY_TENTACLE_LEN + 0.01, 2);
    g.dispose();
  });

  it('drift only in deep water, clear of the shore and (at the deepest sink) of the bed', () => {
    const buf = createJellyBuffers();
    const n = layoutJellies(field, 2202, buf);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(JELLY_CAP);
    for (let i = 0; i < n; i++) {
      const scale = buf.jelly[i * 4 + 2]!;
      for (let t = 0; t < 240; t += 0.53) {
        const [x, y, z] = jellyPathPoint(buf, i, t, FAUNA_SINK_MAX);
        expect(sampleField(field, field.mask, x, z)).toBe(1);
        expect(sampleField(field, field.dist, x, z)).toBeGreaterThanOrEqual(SHORE_CLEARANCE - field.texel);
        const tip = y - (JELLY_TENTACLE_LEN + 0.05) * scale;
        expect(tip - sampleField(field, field.bed, x, z)).toBeGreaterThanOrEqual(BED_CLEARANCE - 0.02);
        expect(jellyPathPoint(buf, i, t)[1]).toBeLessThan(-0.2);
      }
    }
    expect(layoutJellies(bake((x, z) => (Math.hypot(x, z) < 20 ? 1 : 0)), 1, createJellyBuffers())).toBe(0); // shallow only
    expect(visibleJellyCount(n, 0)).toBe(0);
    expect(visibleJellyCount(n, 2)).toBe(n);
  });
});

describe('WaterFauna', () => {
  afterEach(() => { resetWaterParams(); setWaterFx(true); });

  it('capped InstancedMeshes per cell, no shadows; F8 density / WATER tab only change count', () => {
    const fauna = createWaterFauna({ time: { value: 0 }, deepColor: { value: new THREE.Color(0x10344a) }, seed: 7 });
    expect(fauna.fish).toHaveLength(0);
    expect(fauna.count).toBe(0);
    fauna.rebuild(bake(lakeCode));
    expect(fauna.fish.length).toBeGreaterThan(0);
    expect(fauna.group.children).toEqual([...fauna.fish, ...fauna.jellies]);
    for (const m of [...fauna.fish, ...fauna.jellies]) {
      expect(m).toBeInstanceOf(THREE.InstancedMesh);
      expect(m.castShadow).toBe(false);
      expect(m.receiveShadow).toBe(false);
      expect(m.frustumCulled).toBe(true); // bounds come from the placement (`faunaBounds.ts`)
    }
    expect(fauna.jellyCount).toBeGreaterThan(0);
    const geo = fauna.fish[0]!.geometry;
    const swim = geo.getAttribute('aSwim');
    const n1 = fauna.count;
    expect(n1).toBeGreaterThan(0);
    expect(fauna.fish.some((m) => m.visible)).toBe(true);
    setWaterParams({ faunaDensity: 2 });
    expect(fauna.count).toBeGreaterThan(n1);
    setWaterParams({ faunaDensity: 0 });
    expect(fauna.count).toBe(0);
    expect(fauna.fish.every((m) => !m.visible)).toBe(true);
    setWaterParams({ faunaDensity: 1 });
    setWaterFx(false);
    expect(fauna.count).toBe(0);
    expect(fauna.jellyCount).toBe(0);
    setWaterFx(true);
    expect(fauna.count).toBe(n1);
    expect(fauna.fish[0]!.geometry.getAttribute('aSwim')).toBe(swim); // no realloc
    fauna.rebuild(bake(() => 0));
    expect(fauna.count).toBe(0);
    expect(fauna.fish).toHaveLength(0);
    fauna.dispose();
  });

});

describe('WaterFauna cells', () => {
  afterEach(() => { resetWaterParams(); setWaterFx(true); setViewFocusEnabled(true); });

  it('each cell mesh holds its fish / jellies (a prefix of the placement order) and their whole paths', () => {
    const fauna = createWaterFauna({ time: { value: 0 }, deepColor: { value: new THREE.Color(0x10344a) }, seed: 7 });
    const field = bake(twoLakesCode, 256, 512);
    fauna.rebuild(field);
    const fishBuf = createFaunaBuffers(), jellyBuf = createJellyBuffers();
    const lay = layoutFauna(field, 7, fishBuf), jellies = layoutJellies(field, 7, jellyBuf);
    expect(lay.placed).toBe(fauna.placed);
    expect(fauna.fish.length).toBeGreaterThan(1); // the two lakes lie in different cells
    const p = new THREE.Vector3();
    /** Every placed instance i must be in exactly one mesh whose box holds its path; returns the per-mesh ids. */
    const owners = (meshes: readonly THREE.InstancedMesh[], n: number, attr: string, buf: Float32Array, path: (i: number, t: number, s: number) => [number, number, number]) => {
      let seen = 0;
      for (let i = 0; i < n; i++) {
        const own = meshes.filter((m) => {
          const a = m.geometry.getAttribute(attr) as THREE.InstancedBufferAttribute;
          for (let k = 0; k < a.count; k++) if (a.getX(k) === buf[i * 4] && a.getY(k) === buf[i * 4 + 1] && a.getZ(k) === buf[i * 4 + 2]) return true;
          return false;
        });
        expect(own).toHaveLength(1);
        seen++;
        for (let t = 0; t < 120; t += 1.7) for (const sink of [0, FAUNA_SINK_MAX]) expect(own[0]!.boundingBox!.containsPoint(p.fromArray(path(i, t, sink)))).toBe(true);
      }
      expect(seen).toBe(n);
    };
    owners(fauna.fish, lay.placed, 'aSwim', fishBuf.swim, (i, t, s) => fishPathPoint(fishBuf, i, t, s));
    owners(fauna.jellies, jellies, 'aDrift', jellyBuf.drift, (i, t, s) => jellyPathPoint(jellyBuf, i, t, s));
    for (const m of fauna.fish) expect(m.boundingSphere!.distanceToPoint(m.boundingBox!.max)).toBeLessThan(1e-4);
    // a lower density draws a placement-order prefix: the per-cell counts sum to the global visible count
    setWaterParams({ faunaDensity: 0.5 });
    expect(fauna.fish.reduce((a, m) => a + m.count, 0)).toBe(fauna.count);
    expect(fauna.count).toBe(visibleFishCount(lay, 0.5));
    fauna.dispose();
  });

  it('cullToFocus hides the fauna of a lake off the view focus and keeps the one in view', () => {
    const fauna = createWaterFauna({ time: { value: 0 }, deepColor: { value: new THREE.Color(0x10344a) }, seed: 7 });
    fauna.rebuild(bake(twoLakesCode, 256, 512));
    fauna.group.updateMatrixWorld(true);
    const west = (m: THREE.InstancedMesh) => m.boundingSphere!.center.x < 0;
    expect(fauna.fish.some(west)).toBe(true);
    expect(fauna.fish.some((m) => !west(m))).toBe(true);
    // a close camera over the west lake: the east lake's fish are hidden, the west lake's drawn
    const cam = new THREE.PerspectiveCamera(30, 16 / 9, 0.5, 400);
    cam.position.set(-70, 30, 25);
    cam.lookAt(-70, 0, 0);
    updateViewFocus(cam);
    fauna.cullToFocus();
    for (const m of fauna.fish) expect(m.visible).toBe(west(m));
    // far away from both: nothing drawn
    cam.position.set(400, 40, 400);
    cam.lookAt(400, 0, 380);
    updateViewFocus(cam);
    fauna.cullToFocus();
    expect([...fauna.fish, ...fauna.jellies].every((m) => !m.visible)).toBe(true);
    setViewFocusEnabled(false);
    updateViewFocus(cam);
    fauna.cullToFocus();
    expect(fauna.fish.every((m) => m.visible)).toBe(true);
    setViewFocusEnabled(true);
    fauna.dispose();
  });
});
