import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { View } from '../state';

export const DIRS: Record<View, THREE.Vector3> = {
  iso: new THREE.Vector3(0.75, 0.78, 0.75).normalize(),
  front: new THREE.Vector3(0, 0.22, 1).normalize(),
  side: new THREE.Vector3(1, 0.22, 0).normalize(),
  top: new THREE.Vector3(0.0008, 1, 0.0008).normalize(),
};
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

interface Tween { t: number; dur: number; fromPos: THREE.Vector3; toPos: THREE.Vector3; fromTgt: THREE.Vector3; toTgt: THREE.Vector3 }
export interface ViewOpts { instant?: boolean; target?: THREE.Vector3; radius?: number }

/** Orbit controls + animated framing of the spawned content from the four standard views. */
export class CameraRig {
  readonly controls: OrbitControls;
  private tween: Tween | null = null;

  constructor(private camera: THREE.PerspectiveCamera, dom: HTMLElement, private getBounds: () => THREE.Box3, private isRow: () => boolean) {
    camera.far = 600;
    const c = this.controls = new OrbitControls(camera, dom);
    c.enableDamping = true;
    c.dampingFactor = 0.09;
    c.screenSpacePanning = false;
    c.maxPolarAngle = Math.PI / 2 - 0.015;
    c.minDistance = 1.2;
    c.maxDistance = 140;
    c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    c.addEventListener('start', () => { this.tween = null; });
  }

  setView(view: View, opts: ViewOpts = {}) {
    const box = this.getBounds();
    const size = box.getSize(new THREE.Vector3());
    const c = opts.target ?? box.getCenter(new THREE.Vector3());
    let r = opts.radius ?? Math.max(size.length() / 2, 0.9);
    if (this.isRow() && !opts.radius) r = Math.max(size.x / 2 / Math.max(this.camera.aspect * 0.8, 0.8), size.y, 1.5);
    const dist = Math.min(this.controls.maxDistance, r / Math.sin(THREE.MathUtils.degToRad(14)) * 1.15);
    const toPos = c.clone().addScaledVector(DIRS[view], dist);
    if (opts.instant) {
      this.camera.position.copy(toPos); this.controls.target.copy(c); this.controls.update(); this.tween = null;
    } else {
      this.tween = { t: 0, dur: 0.65, fromPos: this.camera.position.clone(), toPos, fromTgt: this.controls.target.clone(), toTgt: c.clone() };
    }
  }

  step(dt: number) {
    const tw = this.tween;
    if (!tw) return;
    tw.t += dt / tw.dur;
    const k = ease(Math.min(1, tw.t));
    this.controls.target.lerpVectors(tw.fromTgt, tw.toTgt, k);
    // interpolate offset direction + length (arc-like) rather than straight line
    const a = tw.fromPos.clone().sub(tw.fromTgt), b = tw.toPos.clone().sub(tw.toTgt);
    const la = a.length(), lb = b.length();
    const dir = a.normalize().lerp(b.normalize(), k).normalize();
    this.camera.position.copy(this.controls.target).addScaledVector(dir, THREE.MathUtils.lerp(la, lb, k));
    if (tw.t >= 1) this.tween = null;
  }
}
