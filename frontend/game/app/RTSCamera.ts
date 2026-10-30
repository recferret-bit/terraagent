import * as THREE from 'three';
import type { PlanetSurface } from '@terra/render/planets/surface/types';

/** Diorama RTS camera: FOV stays 28°, fixed ~42° elevation, yaw in 90° steps, clamped zoom. */
export class RTSCamera {
  readonly target = new THREE.Vector3();
  private goal = new THREE.Vector3();
  private yaw: number; private yawGoal: number;
  private dist: number; private distGoal: number;
  private elev = THREE.MathUtils.degToRad(42);
  private keys = new Set<string>();
  private mouse = { x: -1, y: -1, inside: false, drag: false, lx: 0, ly: 0 };
  followTarget: THREE.Object3D | null = null;
  minDist = 20; maxDist = 95; halfSize = 60; enabled = true;
  private cleanups: Array<() => void> = [];

  constructor(private camera: THREE.PerspectiveCamera, private dom: HTMLElement, private surface: PlanetSurface, pos: THREE.Vector3, target: THREE.Vector3) {
    this.target.copy(target); this.goal.copy(target);
    const off = pos.clone().sub(target);
    this.dist = this.distGoal = THREE.MathUtils.clamp(off.length(), this.minDist, this.maxDist);
    this.yaw = this.yawGoal = Math.atan2(off.x, off.z);
    this.halfSize = surface.halfSize;
    this.apply();
    const on = <K extends keyof WindowEventMap>(t: Window | HTMLElement, ev: string, fn: (e: any) => void, opts?: any) => { t.addEventListener(ev, fn, opts); this.cleanups.push(() => t.removeEventListener(ev, fn, opts)); };
    on(window, 'keydown', (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const k = e.key.toLowerCase(); this.keys.add(k);
      if (!this.enabled) return;
      if (k === 'q') this.yawGoal += Math.PI / 2;
      if (k === 'e') this.yawGoal -= Math.PI / 2;
      if (k === 'home' && this.followTarget) { this.goal.copy(this.followTarget.position); }
    });
    on(window, 'keyup', (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase()));
    on(window, 'blur', () => this.keys.clear());
    on(dom, 'wheel', (e: WheelEvent) => { e.preventDefault(); this.distGoal = THREE.MathUtils.clamp(this.distGoal * Math.exp(e.deltaY * 0.0012), this.minDist, this.maxDist); }, { passive: false });
    on(dom, 'pointerdown', (e: PointerEvent) => { if (e.button === 1) { e.preventDefault(); this.mouse.drag = true; this.mouse.lx = e.clientX; this.mouse.ly = e.clientY; } });
    on(window, 'pointerup', (e: PointerEvent) => { if (e.button === 1) this.mouse.drag = false; });
    on(window, 'pointermove', (e: PointerEvent) => {
      this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.inside = true;
      if (this.mouse.drag && this.enabled) {
        const k = this.dist * 0.0021;
        this.pan(-(e.clientX - this.mouse.lx) * k, -(e.clientY - this.mouse.ly) * k * 1.3);
        this.mouse.lx = e.clientX; this.mouse.ly = e.clientY;
      }
    });
    on(document.documentElement, 'mouseleave', () => (this.mouse.inside = false));
  }

  /** dx = screen-right metres, dz = screen-down (toward camera) metres, in yaw-relative ground axes. */
  private pan(dx: number, dz: number) {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    this.goal.x += dx * c + dz * s;
    this.goal.z += -dx * s + dz * c;
  }

  update(dt: number) {
    if (this.enabled) {
      const sp = this.dist * 0.9 * dt * (this.keys.has('shift') ? 2 : 1);
      let mx = 0, mz = 0;
      if (this.keys.has('w') || this.keys.has('arrowup')) mz -= 1;
      if (this.keys.has('s') || this.keys.has('arrowdown')) mz += 1;
      if (this.keys.has('a') || this.keys.has('arrowleft')) mx -= 1;
      if (this.keys.has('d') || this.keys.has('arrowright')) mx += 1;
      const m = this.mouse, W = window.innerWidth, H = window.innerHeight, edge = 8;
      if (m.inside && !m.drag && m.x >= 0) {
        if (m.x < edge) mx -= 1; else if (m.x > W - edge) mx += 1;
        if (m.y < edge) mz -= 1; else if (m.y > H - edge) mz += 1;
      }
      if (mx || mz) this.pan(mx * sp, mz * sp);
      if (this.followTarget && !mx && !mz && !m.drag && this.keys.has('f')) this.goal.copy(this.followTarget.position);
    }
    const lim = this.halfSize - 2;
    this.goal.x = THREE.MathUtils.clamp(this.goal.x, -lim, lim);
    this.goal.z = THREE.MathUtils.clamp(this.goal.z, -lim, lim);
    this.goal.y = this.surface.heightAt(this.goal.x, this.goal.z);
    const k = 1 - Math.exp(-dt * 9);
    this.target.lerp(this.goal, k);
    this.yaw += (this.yawGoal - this.yaw) * (1 - Math.exp(-dt * 8));
    this.dist += (this.distGoal - this.dist) * (1 - Math.exp(-dt * 8));
    this.apply();
  }

  focus(p: THREE.Vector3) { this.goal.copy(p); }
  private apply() {
    const h = Math.sin(this.elev) * this.dist, r = Math.cos(this.elev) * this.dist;
    this.camera.position.set(this.target.x + Math.sin(this.yaw) * r, this.target.y + h, this.target.z + Math.cos(this.yaw) * r);
    this.camera.lookAt(this.target);
    if (this.camera.fov !== 28) { this.camera.fov = 28; this.camera.updateProjectionMatrix(); }
  }
  dispose() { this.cleanups.forEach((f) => f()); this.cleanups = []; }
}
