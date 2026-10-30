import * as THREE from 'three';
import { ArchetypeCatalog } from '@terra/render/kitbash';
import type { PlanetSurface } from '@terra/render/planets/surface/types';
import type { PlanetSpec } from '@terra/render/planets/PlanetSpec';

/** Seeded PRNG (mulberry32) so the starter colony layout is deterministic per seed. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const findId = (cat: 'building' | 'robot', re: RegExp, fallbackIdx = 0): string | null => {
  const l = ArchetypeCatalog.list(cat);
  return (l.find((e) => re.test(e.id)) ?? l[fallbackIdx])?.id ?? null;
};

/** True when (x,z) and its four neighbours at `margin` are all dry land. */
export function isDry(s: PlanetSurface, x: number, z: number, margin = 1.5) {
  return !s.isLiquid(x, z) && !s.isLiquid(x + margin, z) && !s.isLiquid(x - margin, z) && !s.isLiquid(x, z + margin) && !s.isLiquid(x, z - margin);
}

export interface Placement { id: string; x: number; z: number; yaw: number; wander?: { c: THREE.Vector3; r: number; wait: number; speed: number } }

/** Starter colony: hub + two solar panels + miner and builder robots that wander around the hub. */
export function layoutColony(surface: PlanetSurface, spec: PlanetSpec): Placement[] {
  const rnd = rng(spec.seed ^ 0x9e3779b9);
  const L = surface.landingSite;
  const out: Placement[] = [];
  const hubId = findId('building', /command|hub|core|hq/i), solarId = findId('building', /solar|panel/i, 1);
  const minerId = findId('robot', /miner/i, 0), builderId = findId('robot', /builder/i, 1);
  // find a dry spot on a ring around the landing site
  const spot = (r: number, a0: number) => {
    for (let i = 0; i < 24; i++) {
      const a = a0 + i * 0.5, rr = r + (i % 4) * 0.8;
      const x = L.x + Math.cos(a) * rr, z = L.z + Math.sin(a) * rr;
      if (isDry(surface, x, z, 2)) return new THREE.Vector3(x, 0, z);
    }
    return new THREE.Vector3(L.x + r, 0, L.z);
  };
  const center = new THREE.Vector3();
  if (hubId) { const p = spot(9, rnd() * 6.28); center.copy(p); out.push({ id: hubId, x: p.x, z: p.z, yaw: rnd() * 6.28 }); }
  else center.copy(L);
  if (solarId) for (let i = 0; i < 2; i++) { const p = spot(6.5, Math.atan2(center.z - L.z, center.x - L.x) + (i ? 1 : -1) * 1.1); out.push({ id: solarId, x: p.x, z: p.z, yaw: rnd() * 6.28 }); }
  [minerId, builderId].forEach((id, i) => {
    if (!id) return;
    const p = spot(5, rnd() * 6.28 + i);
    const yaw = rnd() * 6.28;
    out.push({ id, x: p.x, z: p.z, yaw, wander: { speed: 2.6 + rnd(), c: center.clone(), r: 8 + i * 2, wait: rnd() * 2 } });
  });
  return out;
}
