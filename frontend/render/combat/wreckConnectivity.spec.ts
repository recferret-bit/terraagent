import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import '../kitbash/index';
import { ArchetypeCatalog, stripBuildingPlinth } from '../kitbash/catalog';
import { bakeWreckGeometry } from './wreckGeometry';

function maxFloatingIslandMinY(geo: THREE.BufferGeometry): number {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const triCount = Math.floor(pos.count / 3);
  const vertMap = new Map<string, number>();
  const parent = new Int32Array(triCount);
  for (let i = 0; i < triCount; i++) parent[i] = i;
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)));
  const unite = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const i = t * 3 + k;
      const key = `${Math.round(pos.getX(i) * 500)}_${Math.round(pos.getY(i) * 500)}_${Math.round(pos.getZ(i) * 500)}`;
      const prev = vertMap.get(key);
      if (prev !== undefined) unite(t, prev);
      else vertMap.set(key, t);
    }
  }
  const boxes = new Map<number, { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }>();
  for (let t = 0; t < triCount; t++) {
    const r = find(t);
    let b = boxes.get(r);
    if (!b) {
      b = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
      boxes.set(r, b);
    }
    for (let k = 0; k < 3; k++) {
      const i = t * 3 + k;
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (x < b.minX) b.minX = x; if (x > b.maxX) b.maxX = x;
      if (y < b.minY) b.minY = y; if (y > b.maxY) b.maxY = y;
      if (z < b.minZ) b.minZ = z; if (z > b.maxZ) b.maxZ = z;
    }
  }
  const list = [...boxes.values()];
  const p2 = list.map((_, i) => i);
  const find2 = (x: number): number => (p2[x] === x ? x : (p2[x] = find2(p2[x]!)));
  const eps = 0.09;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]!, b = list[j]!;
      if (a.minX - eps <= b.maxX && b.minX - eps <= a.maxX && a.minY - eps <= b.maxY && b.minY - eps <= a.maxY && a.minZ - eps <= b.maxZ && b.minZ - eps <= a.maxZ) {
        const ra = find2(i), rb = find2(j);
        if (ra !== rb) p2[ra] = rb;
      }
    }
  }
  const compMinY = new Map<number, number>();
  for (let i = 0; i < list.length; i++) {
    const r = find2(i);
    compMinY.set(r, Math.min(compMinY.get(r) ?? Infinity, list[i]!.minY));
  }
  let worst = 0;
  for (const my of compMinY.values()) if (my > worst) worst = my;
  return worst;
}

describe('wreck connectivity & scaffold tier parity', () => {
  it('leaves zero floating parts across all robot and plinth-stripped building wrecks', () => {
    const ids = [...ArchetypeCatalog.list('robot').map((e) => e.id), ...ArchetypeCatalog.list('building').map((e) => e.id)];
    const seeds = [1.1, 3.7, 7.25, 11.4];
    for (const id of ids) {
      const isB = id.startsWith('building.');
      const mesh = new THREE.Mesh(ArchetypeCatalog.getGeometry(id));
      mesh.userData = { archetypeId: id };
      if (isB) stripBuildingPlinth(mesh);
      for (const seed of seeds) {
        const geo = bakeWreckGeometry(mesh.geometry, { kind: isB ? 'building' : 'bot', seed, buildStage: 1 });
        expect(maxFloatingIslandMinY(geo), `${id} seed=${seed}`).toBeLessThanOrEqual(0.18);
        geo.dispose();
      }
      mesh.geometry.dispose();
    }
  });

  it('matches buildScaffold cut tiers across 0.10, 0.33, and 0.66 partial construction wrecks', () => {
    const mesh = new THREE.Mesh(ArchetypeCatalog.getGeometry('building.roboticsFactory'));
    mesh.userData = { archetypeId: 'building.roboticsFactory' };
    stripBuildingPlinth(mesh);
    const s0 = bakeWreckGeometry(mesh.geometry, { kind: 'building', seed: 3.7, buildStage: 0.1 });
    const s1 = bakeWreckGeometry(mesh.geometry, { kind: 'building', seed: 3.7, buildStage: 0.33 });
    const s2 = bakeWreckGeometry(mesh.geometry, { kind: 'building', seed: 3.7, buildStage: 0.66 });
    expect(s1.getAttribute('position').count).toBeGreaterThan(s0.getAttribute('position').count);
    expect(s2.getAttribute('position').count).toBeGreaterThanOrEqual(s1.getAttribute('position').count);
    expect(maxFloatingIslandMinY(s1)).toBeLessThanOrEqual(0.18);
    expect(maxFloatingIslandMinY(s2)).toBeLessThanOrEqual(0.18);
    s0.dispose(); s1.dispose(); s2.dispose();
    mesh.geometry.dispose();
  });
});
