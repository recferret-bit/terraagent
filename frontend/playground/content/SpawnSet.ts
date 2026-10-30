import * as THREE from 'three';
import { ArchetypeCatalog, createArchetypeMesh, tickArchetypeMesh, type ArchetypeCategory, type ArchetypeMesh } from '@shared/engine/kitbash';

export interface Spawn { id: string; mesh: ArchetypeMesh; box: THREE.Box3; }
const footprint = (b: THREE.Box3) => Math.max(b.max.x - b.min.x, b.max.z - b.min.z, 1);

/** The archetype meshes currently on the pedestal (one, or a whole category row), their layout and selection ring. */
export class SpawnSet {
  readonly content = new THREE.Group();
  readonly ring: THREE.Mesh;
  spawns: Spawn[] = [];

  constructor() {
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.97, 1.0, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff6a13, transparent: true, opacity: 0.9, depthWrite: false }));
    this.ring.position.y = 0.006;
  }

  dispose() {
    for (const s of this.spawns) { this.content.remove(s.mesh); s.mesh.geometry.dispose(); (s.mesh.material as THREE.Material).dispose(); }
    this.spawns = [];
  }

  /** Spawn `ids` side by side, centred on the origin. */
  rebuild(ids: string[], biomeKey: string, wire: boolean) {
    this.dispose();
    const widths: number[] = [];
    for (const id of ids) {
      let mesh: ArchetypeMesh;
      try { mesh = createArchetypeMesh(id, biomeKey); } catch (e) { console.error('archetype build failed', id, e); continue; }
      mesh.geometry.computeBoundingBox();
      const box = mesh.geometry.boundingBox!.clone();
      widths.push(footprint(box));
      this.spawns.push({ id, mesh, box });
      this.content.add(mesh);
    }
    const gap = 0.9;
    let x = -(widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, widths.length - 1)) / 2;
    this.spawns.forEach((s, i) => { s.mesh.position.set(x + widths[i] / 2, 0, 0); x += widths[i] + gap; });
    this.applyWire(wire);
    this.content.rotation.y = 0;
  }

  idsFor(row: ArchetypeCategory | null, id: string): string[] {
    return row ? ArchetypeCatalog.list(row).map((e) => e.id) : id ? [id] : [];
  }

  applyWire(wire: boolean) { for (const s of this.spawns) (s.mesh.material as THREE.MeshStandardMaterial).wireframe = wire; }

  find(id: string) { return this.spawns.find((s) => s.id === id); }

  updateRing(id: string, row: ArchetypeCategory | null) {
    const s = this.find(id);
    this.ring.visible = !!s && row !== null;
    if (!s) return;
    this.ring.scale.setScalar(footprint(s.box) * 0.62);
    this.ring.position.set(s.mesh.position.x, 0.006, s.mesh.position.z);
  }

  minX() { return this.spawns.length ? Math.min(...this.spawns.map((s) => s.mesh.position.x + s.box.min.x)) : 0; }

  bounds(id: string, row: ArchetypeCategory | null) {
    const box = new THREE.Box3();
    if (!this.spawns.length) box.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 1.5, 1));
    for (const s of row ? this.spawns : this.spawns.filter((s) => s.id === id)) box.union(s.box.clone().translate(s.mesh.position));
    return box;
  }

  tick(time: number, dt: number, turntable: boolean, row: boolean) {
    if (turntable) this.content.rotation.y = row ? 0 : this.content.rotation.y + dt * 0.5; // rotate object(s), grid stays calibrated; rows stay readable
    for (const s of this.spawns) tickArchetypeMesh(s.mesh, time);
  }
}
