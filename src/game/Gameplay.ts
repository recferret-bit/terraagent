import * as THREE from 'three';
import { ArchetypeCatalog, createArchetypeMesh, tickArchetypeMesh } from '../kitbash';
import type { PlanetSurface } from '../planets/surface/types';
import type { PlanetSpec } from '../planets/PlanetSpec';
import { RTSCamera } from './RTSCamera';
import { GameHud } from '../ui/hud';

/** Seeded PRNG (mulberry32) so the starter colony layout is deterministic per seed. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

interface Agent {
  obj: THREE.Object3D; speed: number; goal: THREE.Vector3 | null; wander?: { c: THREE.Vector3; r: number; wait: number }; yawVel: number;
}

const findId = (cat: 'building' | 'robot', re: RegExp, fallbackIdx = 0): string | null => {
  const l = ArchetypeCatalog.list(cat);
  return (l.find((e) => re.test(e.id)) ?? l[fallbackIdx])?.id ?? null;
};

/** Gameplay state: hero + starter colony + RTS camera + click-to-move. */
export class Gameplay {
  readonly cam: RTSCamera;
  private hero: Agent;
  private agents: Agent[] = [];
  private owned: THREE.Mesh[] = [];
  private marker: THREE.Mesh;
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
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
    this.hero = { obj: hero, speed: 7, goal: null, yawVel: 0 };
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

  /** Ray → terrain height field: march then bisect. */
  groundPick(cx: number, cy: number): THREE.Vector3 | null {
    const r = this.dom.getBoundingClientRect();
    this.ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    const o = this.ray.ray.origin, d = this.ray.ray.direction;
    const h = (t: number) => { const x = o.x + d.x * t, z = o.z + d.z * t; return o.y + d.y * t - this.surface.heightAt(x, z); };
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
    p.y = this.surface.heightAt(p.x, p.z);
    return p;
  }

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

  private dry(x: number, z: number, margin = 1.5) {
    const s = this.surface;
    return !s.isLiquid(x, z) && !s.isLiquid(x + margin, z) && !s.isLiquid(x - margin, z) && !s.isLiquid(x, z + margin) && !s.isLiquid(x, z - margin);
  }

  private place(id: string, x: number, z: number, yaw: number) {
    const m = createArchetypeMesh(id, this.spec.biomeKey);
    m.position.set(x, this.surface.heightAt(x, z), z); m.rotation.y = yaw;
    this.scene.add(m); this.owned.push(m);
    return m;
  }

  private buildColony() {
    const rnd = rng(this.spec.seed ^ 0x9e3779b9);
    const L = this.surface.landingSite;
    const hubId = findId('building', /command|hub|core|hq/i), solarId = findId('building', /solar|panel/i, 1);
    const minerId = findId('robot', /miner/i, 0), builderId = findId('robot', /builder/i, 1);
    // find a dry spot on a ring around the landing site
    const spot = (r: number, a0: number) => {
      for (let i = 0; i < 24; i++) {
        const a = a0 + i * 0.5, rr = r + (i % 4) * 0.8;
        const x = L.x + Math.cos(a) * rr, z = L.z + Math.sin(a) * rr;
        if (this.dry(x, z, 2)) return new THREE.Vector3(x, 0, z);
      }
      return new THREE.Vector3(L.x + r, 0, L.z);
    };
    const center = new THREE.Vector3();
    if (hubId) { const p = spot(9, rnd() * 6.28); center.copy(p); this.place(hubId, p.x, p.z, rnd() * 6.28); }
    else center.copy(L);
    if (solarId) for (let i = 0; i < 2; i++) { const p = spot(6.5, Math.atan2(center.z - L.z, center.x - L.x) + (i ? 1 : -1) * 1.1); this.place(solarId, p.x + 0, p.z, rnd() * 6.28); }
    const bots: Array<string | null> = [minerId, builderId];
    bots.forEach((id, i) => {
      if (!id) return;
      const p = spot(5, rnd() * 6.28 + i);
      const m = this.place(id, p.x, p.z, rnd() * 6.28);
      this.agents.push({ obj: m, speed: 2.6 + rnd(), goal: null, yawVel: 0, wander: { c: center.clone(), r: 8 + i * 2, wait: rnd() * 2 } });
    });
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
      this.steer(this.hero, dt);
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
        this.steer(a, dt);
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
    tickArchetypeMesh(this.hero.obj, this.time);
    for (const m of this.owned) tickArchetypeMesh(m, this.time);
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
