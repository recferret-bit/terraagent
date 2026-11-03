import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { hexIndex } from '@terra/sim/grid/hex';
import { getViewFocus, setViewFocusEnabled, updateViewFocus } from '../../core/viewFocus';
import { createHexTerrain, HEX_PREP, HEX_TERRAIN, specForPlanetType, type HexTerrain } from './index';
import { bucketMeta } from './propBuckets';
import {
  bucketDrawCounts,
  PROP_SHADOW_REACH_MAX,
  placedIndex,
  resetPropShadowLights,
  setPropInstanceCulling,
} from './propFocusCompaction';

const RADIUS = 40;

function forestPlanet(): HexTerrain {
  const hx = hexIndex(RADIUS);
  const tiles = {
    terrain: new Uint8Array(hx.count).fill(HEX_TERRAIN.forest),
    prep: new Uint8Array(hx.count).fill(HEX_PREP.wild),
    height: new Float32Array(hx.count),
    deposit: new Uint8Array(hx.count),
  };
  const t = createHexTerrain({ radius: RADIUS, tiles, look: specForPlanetType('temperate') });
  t.group.updateMatrixWorld(true);
  return t;
}

/** A close RTS-like view (focus radius ~20 m) somewhere inside the forest. */
function closeCamera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(28, 16 / 9, 0.5, 400);
  cam.position.set(-30, 14, -10);
  cam.lookAt(-40, 0, -20);
  cam.updateMatrixWorld();
  return cam;
}

/** A sun shadow camera looking along `dir` (what `onBeforeShadow` receives during a shadow-map pass). */
function shadowCamera(dir: THREE.Vector3): THREE.OrthographicCamera {
  const c = new THREE.OrthographicCamera(-50, 50, 50, -50, 1, 300);
  c.position.copy(dir).multiplyScalar(-100);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld();
  return c;
}

const visibleBuckets = (t: HexTerrain) => t.props.meshes.pine.filter((m) => m.visible);
const instXZ = (m: THREE.InstancedMesh, slot: number) => {
  const p = bucketMeta(m).placed[placedIndex(m, slot)]!;
  return [p.x, p.z] as const;
};

/** Low sun: off-focus trees whose shadow reaches the focus are drawn in the shadow passes only, the rest nowhere. */
function checkShadowCasters(): void {
  const t = forestPlanet();
  updateViewFocus(closeCamera());
  t.props.cullToFocus();
  const dir = new THREE.Vector3(-0.7, -0.35, 0.6).normalize(); // low sun: long shadows
  const sc = shadowCamera(dir);
  const r = null as never; // the hooks do not use the renderer
  for (const m of visibleBuckets(t)) m.onBeforeShadow(r, null as never, sc, sc, m.geometry, m.material as THREE.Material, null as never);
  // instance heights (build order), read while every instance sits in its own slot
  setPropInstanceCulling(false);
  t.props.cullToFocus();
  const heights = new Map<THREE.InstancedMesh, number[]>();
  const M = new THREE.Matrix4(), col = new THREE.Vector3();
  for (const m of visibleBuckets(t)) {
    m.geometry.computeBoundingBox();
    const h = m.geometry.boundingBox!.max.y - m.geometry.boundingBox!.min.y;
    heights.set(m, Array.from({ length: m.count }, (_, i) => { m.getMatrixAt(i, M); return h * col.setFromMatrixColumn(M, 1).length(); }));
  }
  setPropInstanceCulling(true);
  t.props.cullToFocus(); // a new light direction re-classifies
  const f = getViewFocus();
  const hl = Math.hypot(dir.x, dir.z);
  let shadowOnly = 0;
  for (const m of visibleBuckets(t)) {
    const c = bucketDrawCounts(m);
    shadowOnly += c.shadow - c.main;
    m.onBeforeShadow(r, null as never, sc, sc, m.geometry, m.material as THREE.Material, null as never);
    expect(m.count).toBe(c.shadow);
    m.onAfterShadow(r, null as never, sc, sc, m.geometry, m.material as THREE.Material, null as never);
    expect(m.count).toBe(c.main);
    for (let s = c.shadow; s < c.total; s++) {
      // a culled tree's shadow (trunk base to the tip of its crown's shadow) never touches the focus
      const [x, z] = instXZ(m, s);
      const len = Math.min(PROP_SHADOW_REACH_MAX, (heights.get(m)![placedIndex(m, s)]! * hl) / -dir.y);
      for (let k = 0; k <= 1; k += 0.1) {
        const sx = x + (dir.x / hl) * len * k, sz = z + (dir.z / hl) * len * k;
        expect(Math.hypot(sx - f.x, sz - f.z)).toBeGreaterThan(f.radius);
      }
    }
  }
  expect(shadowOnly).toBeGreaterThan(0);
  t.dispose();
}

afterEach(() => {
  setViewFocusEnabled(true);
  setPropInstanceCulling(true);
  resetPropShadowLights();
});

describe('per-instance view-focus culling of prop buckets', () => {
  it('draws only the instances near the focus, keeps the bucket bounds, and keeps every on-focus tree', () => {
    const t = forestPlanet();
    const before = new Map(t.props.meshes.pine.map((m) => [m, m.boundingSphere!.clone()]));
    updateViewFocus(closeCamera());
    t.props.cullToFocus();
    const f = getViewFocus();
    let drawn = 0, total = 0;
    for (const m of t.props.meshes.pine) {
      expect(m.boundingSphere!.equals(before.get(m)!)).toBe(true);
      const c = bucketDrawCounts(m);
      if (!m.visible) continue;
      drawn += c.main; total += c.total;
      expect(m.count).toBe(c.main);
      // `order` is a permutation of the build order
      expect(new Set(Array.from({ length: c.total }, (_, s) => placedIndex(m, s))).size).toBe(c.total);
      for (let s = 0; s < c.total; s++) {
        const [x, z] = instXZ(m, s);
        const d = Math.hypot(x - f.x, z - f.z);
        if (d < f.radius) expect(s).toBeLessThan(c.main); // a tree inside the focus is always drawn
        if (s < c.main) expect(d).toBeLessThan(f.radius + 6); // and nothing far outside it
      }
    }
    expect(drawn).toBeGreaterThan(0);
    expect(drawn).toBeLessThan(total * 0.8); // straddling buckets really shrink
    t.dispose();
  });

  it('maps a picked instance back to its placed tree through the compaction order', () => {
    const t = forestPlanet();
    updateViewFocus(closeCamera());
    t.props.cullToFocus();
    const f = getViewFocus();
    const m = visibleBuckets(t).find((b) => bucketDrawCounts(b).main > 0 && bucketDrawCounts(b).main < bucketDrawCounts(b).total)!;
    expect(m).toBeDefined();
    const slot = bucketDrawCounts(m).main - 1;
    const tree = bucketMeta(m).placed[placedIndex(m, slot)]!;
    expect(Math.hypot(tree.x - f.x, tree.z - f.z)).toBeLessThan(f.radius + 6);
    const ray = new THREE.Raycaster(new THREE.Vector3(tree.x, tree.y + 30, tree.z), new THREE.Vector3(0, -1, 0));
    expect(t.props.pickProp(ray)).toMatchObject({ q: tree.tileQ, r: tree.tileR });
    t.dispose();
  });

  it('adds off-focus casters whose shadow reaches the focus to the shadow passes only', checkShadowCasters);

  it('draws every instance again with the focus off or the culling switched off', () => {
    const t = forestPlanet();
    const cam = closeCamera();
    updateViewFocus(cam);
    t.props.cullToFocus();
    expect(visibleBuckets(t).some((m) => m.count < bucketDrawCounts(m).total)).toBe(true);
    setPropInstanceCulling(false);
    t.props.cullToFocus();
    for (const m of visibleBuckets(t)) expect(m.count).toBe(bucketDrawCounts(m).total);
    setPropInstanceCulling(true);
    setViewFocusEnabled(false);
    updateViewFocus(cam);
    t.props.cullToFocus();
    for (const m of t.props.meshes.pine) {
      expect(m.visible).toBe(true);
      expect(m.count).toBe(bucketDrawCounts(m).total);
      for (let s = 0; s < m.count; s++) expect(placedIndex(m, s)).toBe(s);
    }
    t.dispose();
  });
  it('re-measures the instances when the terrain group moves (space view offset → colony)', () => {
    const t = forestPlanet();
    t.group.position.set(300, 0, -200); // the space view offsets the colony terrain
    t.group.updateMatrixWorld(true);
    const there = closeCamera();
    there.position.add(new THREE.Vector3(300, 0, -200));
    there.updateMatrixWorld();
    updateViewFocus(there);
    t.props.cullToFocus(); // states measured (and compacted) at the offset
    expect(visibleBuckets(t).some((m) => bucketDrawCounts(m).main < bucketDrawCounts(m).total)).toBe(true);
    t.group.position.set(0, 0, 0);
    t.group.updateMatrixWorld(true);
    updateViewFocus(closeCamera());
    t.props.cullToFocus();
    const f = getViewFocus();
    let inFocus = 0;
    for (const m of visibleBuckets(t)) {
      const c = bucketDrawCounts(m);
      for (let s = 0; s < c.total; s++) {
        const [x, z] = instXZ(m, s);
        if (Math.hypot(x - f.x, z - f.z) < f.radius) { inFocus++; expect(s).toBeLessThan(c.main); }
      }
    }
    expect(inFocus).toBeGreaterThan(0);
    t.dispose();
  });
});
