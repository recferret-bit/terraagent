import * as THREE from 'three';
import { createArchetypeMesh, tickArchetypeMesh, type ArchetypeMesh } from '@terra/render/kitbash';
import { ENTITY_STRIDE } from '../../store/replica/viewCodec';
import { PoseBlender, type Pose } from './blend';
import { INTERP_DELAY_TICKS, SampleBuffer } from './interp';
import type { Scene3dService, SimFrame } from './services';

/** Sim entity kind to kitbash archetype. Kind 1 is the W00 test entity. */
export const KIND_ARCHETYPE: Readonly<Record<number, string>> = { 1: 'robot.builder' };

interface Ent {
  kind: number;
  mesh: ArchetypeMesh;
  blend: PoseBlender;
  buffer: SampleBuffer;
  hp: number; state: number; owner: number;
}

/**
 * Draws the view's entities as archetype meshes on the terrain. Predicted view: position blends to each new target
 * (150 ms ease-out for corrections); interpolation view: 400 ms behind the server clock. hp / state / owner snap.
 */
export class EntityLayer {
  readonly group = new THREE.Group();
  private readonly ents = new Map<number, Ent>();
  private seen: unknown = null;

  constructor(private readonly s3: Scene3dService, private readonly onCorrection: (tiles: number) => void = () => {}) {
    this.group.name = 'entities';
    s3.scene.add(this.group);
  }

  update(frame: SimFrame, nowMs: number): void {
    if (frame.view !== this.seen) { this.seen = frame.view; this.ingest(frame, nowMs); }
    for (const e of this.ents.values()) {
      const pose = frame.predicting ? e.blend.at(nowMs) : e.buffer.sampleAt(frame.serverTick - INTERP_DELAY_TICKS) ?? e.blend.at(nowMs);
      this.place(e.mesh, pose);
      tickArchetypeMesh(e.mesh, nowMs / 1000);
    }
  }

  private ingest({ view }: SimFrame, nowMs: number): void {
    const live = new Set<number>();
    const f = view.entities;
    for (let i = 0; i < view.count; i++) {
      const o = i * ENTITY_STRIDE;
      const id = f[o], kind = f[o + 1];
      if (!KIND_ARCHETYPE[kind]) continue;
      live.add(id);
      const pose: Pose = { x: f[o + 5], y: f[o + 6], rot: f[o + 7] };
      let e = this.ents.get(id);
      if (e && e.kind !== kind) { this.remove(id); e = undefined; }
      if (!e) e = this.add(id, kind, pose, nowMs);
      e.owner = f[o + 2]; e.hp = f[o + 8]; e.state = f[o + 10];
      Object.assign(e.mesh.userData, { hp: e.hp, state: e.state, owner: e.owner });
      const jump = e.blend.setTarget(pose, nowMs);
      if (jump > 0) this.onCorrection(jump);
      e.buffer.push({ tick: view.tick, ...pose });
    }
    for (const id of [...this.ents.keys()]) if (!live.has(id)) this.remove(id);
  }

  private add(id: number, kind: number, pose: Pose, nowMs: number): Ent {
    const mesh = createArchetypeMesh(KIND_ARCHETYPE[kind], this.s3.biomeKey());
    Object.assign(mesh.userData, { entityId: id });
    this.group.add(mesh);
    const e: Ent = { kind, mesh, blend: new PoseBlender(pose, nowMs), buffer: new SampleBuffer(), hp: 0, state: 0, owner: 0 };
    this.ents.set(id, e);
    return e;
  }

  private remove(id: number): void {
    const e = this.ents.get(id);
    if (!e) return;
    this.group.remove(e.mesh);
    e.mesh.geometry.dispose();
    (e.mesh.material as THREE.Material).dispose();
    this.ents.delete(id);
  }

  private place(mesh: THREE.Object3D, p: Pose): void {
    const w = this.s3.tileToWorld(p.x, p.y);
    mesh.position.set(w.x, w.y, w.z);
    mesh.rotation.y = -p.rot;
  }

  dispose(): void {
    for (const id of [...this.ents.keys()]) this.remove(id);
    this.s3.scene.remove(this.group);
  }
}
