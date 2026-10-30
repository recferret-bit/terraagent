import * as THREE from 'three';
import type { PlanetSurface } from '@terra/render/planets/surface/types';

const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();

/** Screen point → terrain height field: march along the ray, then bisect. */
export function groundPick(dom: HTMLElement, camera: THREE.Camera, surface: PlanetSurface, cx: number, cy: number): THREE.Vector3 | null {
  const r = dom.getBoundingClientRect();
  ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const o = ray.ray.origin, d = ray.ray.direction;
  const h = (t: number) => o.y + d.y * t - surface.heightAt(o.x + d.x * t, o.z + d.z * t);
  let t0 = 0, t1 = -1;
  const step = 1.0, max = 400;
  let prev = h(0);
  for (let t = step; t < max; t += step) {
    const v = h(t);
    if (prev > 0 && v <= 0) { t0 = t - step; t1 = t; break; }
    prev = v;
  }
  if (t1 < 0) return null;
  for (let i = 0; i < 18; i++) { const m = (t0 + t1) / 2; if (h(m) > 0) t0 = m; else t1 = m; }
  const t = (t0 + t1) / 2;
  const p = new THREE.Vector3(o.x + d.x * t, 0, o.z + d.z * t);
  p.y = surface.heightAt(p.x, p.z);
  return p;
}
