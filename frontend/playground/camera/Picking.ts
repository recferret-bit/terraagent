import * as THREE from 'three';
import type { Spawn } from '../content/SpawnSet';

export interface PickHandlers {
  spawns(): Spawn[]; isRow(): boolean; selectedId(): string;
  select(id: string): void; focus(target: THREE.Vector3, radius: number): void; ground(): THREE.Object3D;
}

/** Click selects a row member; double-click refocuses on a model or the pedestal. */
export function bindPicking(dom: HTMLElement, camera: THREE.Camera, on: PickHandlers) {
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const pick = (ev: MouseEvent): Spawn | null => {
    const r = dom.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const spawns = on.spawns();
    const hits = ray.intersectObjects(spawns.map((s) => s.mesh), false);
    return hits.length ? spawns.find((s) => s.mesh === hits[0].object) ?? null : null;
  };
  let downPos = { x: 0, y: 0 };
  dom.addEventListener('pointerdown', (e) => { downPos = { x: e.clientX, y: e.clientY }; });
  dom.addEventListener('pointerup', (e) => {
    if (e.button !== 0 || Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 4) return;
    if (!on.isRow()) return;
    const s = pick(e); if (s && s.id !== on.selectedId()) on.select(s.id);
  });
  dom.addEventListener('dblclick', (e) => {
    const s = pick(e);
    if (s) {
      const bb = s.box.clone().translate(s.mesh.position);
      on.focus(bb.getCenter(new THREE.Vector3()), Math.max(bb.getSize(new THREE.Vector3()).length() / 2, 0.9));
      if (s.id !== on.selectedId()) on.select(s.id);
    } else {
      const p = ray.intersectObject(on.ground(), false)[0]?.point;
      if (p) on.focus(p, 3);
    }
  });
}
