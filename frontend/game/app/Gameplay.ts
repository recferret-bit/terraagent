import * as THREE from 'three';
import { createArchetypeMesh, tickArchetypeMesh } from '@terra/render/kitbash';
import type { PlanetSurface } from '@terra/render/planets/surface/types';
import type { PlanetSpec } from '@terra/render/planets/PlanetSpec';
import { RTSCamera } from './RTSCamera';
import { GameHud } from '../ui/hud';
import { groundPick } from './groundPick';
import { isDry, layoutColony } from './colonyLayout';

interface Agent {
  obj: THREE.Object3D; speed: number; goal: THREE.Vector3 | null; wander?: { c: THREE.Vector3; r: number; wait: number }; yawVel: number; walk: number;
}

/** Gameplay state: hero + starter colony + RTS camera + click-to-move. */
export class Gameplay {
  readonly cam: RTSCamera;
  private hero: Agent;
  private agents: Agent[] = [];
  private owned: THREE.Mesh[] = [];
  private marker: THREE.Mesh;
  private cleanups: Array<() => void> = [];
  private time = 0;
  private res = { energy: 120, metal: 60, water: 40, bio: 10 };
  private resT = 0;
  private downAt = { x: 0, y: 0, t: 0 };
  paused = false;

  constructor(
    private scene: THREE.Scene, private camera: THREE.PerspectiveCamera, private dom: HTMLElement, private surface: PlanetSurface,
    private spec: PlanetSpec, hero: THREE.Object3D, private hud: GameHud, camPose: { position: THREE.Vector3; target: THREE.Vector3 },
  ) {
    hero.position.y = surface.heightAt(hero.position.x, hero.position.z);
    this.hero = { obj: hero, speed: 7, goal: null, yawVel: 0, walk: 0 };
    this.cam = new RTSCamera(camera, dom, surface, camPose.position, camPose.target);
    this.cam.followTarget = hero;

    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.75, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.9, depthWrite: false, fog: false }));
    this.marker.visible = false; scene.add(this.marker);
    this.buildColony();

    const down = (e: PointerEvent) => { this.downAt = { x: e.clientX, y: e.clientY, t: performance.now() }; };
    const up = (e: PointerEvent) => {
      if (e.button !== 0 || this.paused) return;
      if (Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 5) return;
      const p = this.groundPick(e.clientX, e.clientY);
      if (p) this.moveHeroTo(p);
    };
    dom.addEventListener('pointerdown', down); dom.addEventListener('pointerup', up);
    this.cleanups.push(() => { dom.removeEventListener('pointerdown', down); dom.removeEventListener('pointerup', up); });
  }

  groundPick(cx: number, cy: number) { return groundPick(this.dom, this.camera, this.surface, cx, cy); }

  private moveHeroTo(p: THREE.Vector3) {
    const lim = this.surface.halfSize - 1.5;
    if (Math.abs(p.x) > lim || Math.abs(p.z) > lim || this.surface.isLiquid(p.x, p.z)) {
      this.flashMarker(p, 0xff4d6d);
      return;
    }
    this.hero.goal = p.clone();
    this.flashMarker(p, 0x00f0ff);
  }
  private flashMarker(p: THREE.Vector3, color: number) {
    (this.marker.material as THREE.MeshBasicMaterial).color.set(color);
    this.marker.position.set(p.x, p.y + 0.08, p.z); this.marker.visible = true; this.marker.scale.setScalar(1);
    this.markerT = 0;
  }
  private markerT = 99;

  private dry(x: number, z: number, margin = 1.5) { return isDry(this.surface, x, z, margin); }

  private place(id: string, x: number, z: number, yaw: number) {
    const m = createArchetypeMesh(id, this.spec.biomeKey);
    m.position.set(x, this.surface.heightAt(x, z), z); m.rotation.y = yaw;
    this.scene.add(m); this.owned.push(m);
    return m;
  }

  private buildColony() {
    for (const p of layoutColony(this.surface, this.spec)) {
      const m = this.place(p.id, p.x, p.z, p.yaw);
      if (p.wander) this.agents.push({ obj: m, speed: p.wander.speed, goal: null, yawVel: 0, walk: 0, wander: { c: p.wander.c, r: p.wander.r, wait: p.wander.wait } });
    }
    this.res.energy = 120;
  }

  private steer(a: Agent, dt: number) {
    const o = a.obj;
    if (!a.goal) return false;
    const dx = a.goal.x - o.position.x, dz = a.goal.z - o.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.15) { a.goal = null; return false; }
    const want = Math.atan2(dx, dz); // model forward = +Z
    let diff = ((want - o.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const turn = 1 - Math.exp(-dt * 8);
    o.rotation.y += diff * turn;
    const align = Math.max(0, Math.cos(diff));
    const step = Math.min(dist, a.speed * dt * (0.25 + 0.75 * align));
    let nx = o.position.x + (dx / dist) * step, nz = o.position.z + (dz / dist) * step;
    // never enter liquid / leave patch: try slide on each axis, else stop
    const ok = (x: number, z: number) => !this.surface.isLiquid(x, z) && Math.abs(x) < this.surface.halfSize - 1 && Math.abs(z) < this.surface.halfSize - 1;
    if (!ok(nx, nz)) {
      if (ok(nx, o.position.z)) nz = o.position.z; else if (ok(o.position.x, nz)) nx = o.position.x; else { a.goal = null; return false; }
    }
    o.position.x = nx; o.position.z = nz;
    const ty = this.surface.heightAt(nx, nz);
    o.position.y += (ty - o.position.y) * (1 - Math.exp(-dt * 14));
    return true;
  }

  update(dt: number) {
    this.time += dt;
    if (!this.paused) {
      const heroMoving = this.steer(this.hero, dt);
      this.hero.walk += ((heroMoving ? 1 : 0) - this.hero.walk) * Math.min(1, dt * 10);
      for (const a of this.agents) {
        if (!a.goal && a.wander) {
          a.wander.wait -= dt;
          if (a.wander.wait <= 0) {
            for (let i = 0; i < 8; i++) {
              const ang = Math.random() * 6.28, rr = Math.sqrt(Math.random()) * a.wander.r;
              const x = a.wander.c.x + Math.cos(ang) * rr, z = a.wander.c.z + Math.sin(ang) * rr;
              if (this.dry(x, z, 1)) { a.goal = new THREE.Vector3(x, 0, z); break; }
            }
            a.wander.wait = 1 + Math.random() * 3;
          }
        }
        const moving = this.steer(a, dt);
        a.walk += ((moving ? 1 : 0) - a.walk) * Math.min(1, dt * 10);
      }
      this.resT += dt;
      if (this.resT > 1) { this.resT = 0; this.res.energy += 3; this.res.metal += 1; this.res.water += 0.5; this.res.bio += 0.2; this.hud.setResources(this.res); }
    }
    // hero idle bob handled by GPU anim; marker pulse
    if (this.marker.visible) {
      this.markerT += dt;
      this.marker.scale.setScalar(1 + 0.25 * Math.sin(this.markerT * 8));
      if (!this.hero.goal && this.markerT > 0.6) this.marker.visible = false;
    }
    this.cam.update(dt);
    tickArchetypeMesh(this.hero.obj, this.time, this.hero.walk);
    for (const m of this.owned) tickArchetypeMesh(m, this.time);
    for (const a of this.agents) tickArchetypeMesh(a.obj, this.time, a.walk);
  }

  get heroPos() { return this.hero.obj.position; }

  dispose() {
    this.cleanups.forEach((f) => f());
    this.cam.dispose();
    for (const m of this.owned) { this.scene.remove(m); m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    this.owned = [];
    this.scene.remove(this.marker); this.marker.geometry.dispose(); (this.marker.material as THREE.Material).dispose();
    this.scene.remove(this.hero.obj);
    this.hero.obj.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry?.dispose(); (m.material as THREE.Material)?.dispose?.(); } });
  }
}
