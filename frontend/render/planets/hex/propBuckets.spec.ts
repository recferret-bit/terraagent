import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { hexIndex } from '@terra/sim/grid/hex';
import { setViewFocusEnabled, updateViewFocus } from '../../core/viewFocus';
import { createHexTerrain, HEX_PREP, HEX_TERRAIN, specForPlanetType, type HexTerrain } from './index';
import { PROP_KINDS, type PropKind } from './chunkPropScatter';
import { bucketMeta, PROP_BOUNDS_PAD, PROP_CELL_M, propCellSize, tilePropCellKey } from './propBuckets';

const RADIUS = 40;

/** Forest everywhere with a rock band and a few deposits, so every kind spans several cells. */
function forestPlanet(): HexTerrain {
  const hx = hexIndex(RADIUS);
  const terrain = new Uint8Array(hx.count).fill(HEX_TERRAIN.forest);
  const deposit = new Uint8Array(hx.count);
  for (let i = 0; i < hx.count; i++) {
    if (hx.r[i] === 3) terrain[i] = HEX_TERRAIN.rock;
    if (hx.q[i] === -7 && i % 3 === 0) deposit[i] = 1;
  }
  const tiles = { terrain, prep: new Uint8Array(hx.count).fill(HEX_PREP.wild), height: new Float32Array(hx.count), deposit };
  const t = createHexTerrain({ radius: RADIUS, tiles, look: specForPlanetType('temperate') });
  t.group.updateMatrixWorld(true);
  return t;
}

const all = (t: HexTerrain) => PROP_KINDS.flatMap((k) => t.props.meshes[k]);

afterEach(() => {
  setViewFocusEnabled(true);
});

describe('hex prop buckets', () => {
  it('puts every instance in the bucket of its tile cell, one mesh per (cell, kind)', () => {
    const t = forestPlanet();
    const counts = t.props.counts();
    for (const kind of PROP_KINDS) {
      const meshes = t.props.meshes[kind];
      const cells = new Set<string>();
      let n = 0;
      for (const m of meshes) {
        const meta = bucketMeta(m);
        expect(meta.propKind).toBe(kind);
        expect(cells.has(meta.propCell)).toBe(false);
        cells.add(meta.propCell);
        expect(m.count).toBe(meta.placed.length);
        for (const inst of meta.placed) {
          expect(inst.kind).toBe(kind);
          expect(tilePropCellKey(kind, inst.tileQ, inst.tileR)).toBe(meta.propCell);
        }
        n += m.count;
      }
      expect(n).toBe(counts[kind]);
    }
    expect(t.props.meshes.pine.length).toBeGreaterThan(4); // the planet spans several 32 m cells
    expect(propCellSize('pine')).toBe(PROP_CELL_M);
    t.dispose();
  });

  it('bucket bounds contain every instance plus the wind margin', () => {
    const t = forestPlanet();
    const mat = new THREE.Matrix4(), box = new THREE.Box3(), sph = new THREE.Sphere();
    for (const m of all(t)) {
      const geo = m.geometry;
      if (!geo.boundingBox) geo.computeBoundingBox();
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      const sphere = m.boundingSphere!, bb = m.boundingBox!;
      for (let i = 0; i < m.count; i++) {
        m.getMatrixAt(i, mat);
        // the instance's box / sphere grown by the wind margin stays inside the bucket's
        box.copy(geo.boundingBox!).applyMatrix4(mat).expandByScalar(PROP_BOUNDS_PAD - 1e-4);
        expect(bb.containsBox(box)).toBe(true);
        sph.copy(geo.boundingSphere!).applyMatrix4(mat);
        expect(sph.center.distanceTo(sphere.center) + sph.radius + PROP_BOUNDS_PAD).toBeLessThanOrEqual(sphere.radius + 1e-3);
        // the instance matrix sits on its placed prop (pick mapping: instance id -> placed[id])
        const inst = bucketMeta(m).placed[i]!;
        expect(mat.elements[12]).toBeCloseTo(inst.x, 5);
        expect(mat.elements[14]).toBeCloseTo(inst.z, 5);
      }
    }
    t.dispose();
  });

  it('instancesForTile matches the instances in the tile bucket, and a ray picks the tile', () => {
    const t = forestPlanet();
    const hx = hexIndex(RADIUS);
    const tile = hx.indexOf(20, -9);
    const insts = t.props.instancesForTile(tile);
    expect(insts.length).toBeGreaterThan(0);
    const cell = tilePropCellKey('pine', 20, -9);
    const mesh = t.props.meshes.pine.find((m) => bucketMeta(m).propCell === cell)!;
    for (const inst of insts) expect(bucketMeta(mesh).placed).toContain(inst);
    const tree = insts[0]!;
    const target = new THREE.Vector3(tree.x, tree.y + 0.6, tree.z);
    const ray = new THREE.Raycaster(target.clone().add(new THREE.Vector3(0, 30, 0)), new THREE.Vector3(0, -1, 0));
    expect(t.props.pickProp(ray)).toMatchObject({ q: 20, r: -9 });
    t.dispose();
  });

});

describe('hex prop bucket updates and culling', () => {
  it('a delta rebuilds only the bucket of the touched tile; a no-op delta rebuilds nothing', () => {
    const t = forestPlanet();
    const hx = hexIndex(RADIUS);
    const before = new Map<PropKind, THREE.InstancedMesh[]>(PROP_KINDS.map((k) => [k, [...t.props.meshes[k]]]));
    t.updateTiles([hx.indexOf(0, 0)]); // nothing changed in the layers
    for (const k of PROP_KINDS) t.props.meshes[k].forEach((m, i) => expect(m).toBe(before.get(k)![i]));

    const idx = hx.indexOf(22, -28); // mid-cell (x 16, z -48.5): the height easing it causes stays in that cell
    t.setTileState(22, -28, HEX_TERRAIN.flat);
    expect(t.props.instancesForTile(idx)).toHaveLength(0);
    const touched = tilePropCellKey('pine', 22, -28);
    const oldPine = before.get('pine')!;
    expect(t.props.meshes.pine).toHaveLength(oldPine.length);
    t.props.meshes.pine.forEach((m, i) => {
      if (bucketMeta(m).propCell === touched) expect(m).not.toBe(oldPine[i]);
      else expect(m).toBe(oldPine[i]);
    });
    for (const k of PROP_KINDS.filter((k) => k !== 'pine')) t.props.meshes[k].forEach((m, i) => expect(m).toBe(before.get(k)![i]));
    t.dispose();
  });

  it('three frustum-culls far buckets, and cullToFocus hides buckets outside the view focus', () => {
    const t = forestPlanet();
    const cam = new THREE.PerspectiveCamera(30, 16 / 9, 0.5, 400);
    cam.position.set(-50, 25, -20);
    cam.lookAt(-60, 0, -30);
    cam.updateMatrixWorld();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const pine = t.props.meshes.pine;
    const inView = pine.filter((m) => frustum.intersectsObject(m)).length;
    expect(inView).toBeGreaterThan(0);
    expect(inView).toBeLessThan(pine.length);

    updateViewFocus(cam);
    t.props.cullToFocus();
    const shown = pine.filter((m) => m.visible);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(pine.length);
    // every bucket the camera sees stays shown
    for (const m of pine) if (frustum.intersectsObject(m) && m.boundingSphere!.center.distanceTo(cam.position) < 120) expect(m.visible).toBe(true);

    setViewFocusEnabled(false);
    updateViewFocus(cam);
    t.props.cullToFocus();
    expect(pine.every((m) => m.visible)).toBe(true);
    t.dispose();
  });
});
