import * as THREE from 'three';
import type { PlanetKind, PlanetSpec } from '../../planets/PlanetSpec';
import { createPlanetGlobe, type PlanetGlobe } from '../../planets/PlanetGlobe';
import { smoother, win } from './math';

export const R = 9.5;            // globe radius (world units)
export const CAM_DIST = 62;
export const FADE = 1.2;         // crossfade seconds

/** The planet on show: per-kind globe cache (shared shader program → swapping never recompiles), crossfade morph, layout. */
export class StageGlobes {
  current: PlanetGlobe;
  outgoing: PlanetGlobe | null = null;
  morphRate = 1;                 // 1 = the menu's default speed; slower morphs scale nebula/moon easing down by this
  readonly planetPos = new THREE.Vector3();
  private readonly cache = new Map<PlanetKind, PlanetGlobe>();
  private spinRate = 0.025;      // rad/s, see setSpinRate
  private fade = 1;
  private fadeDur = FADE;        // seconds for the current morph (setPlanet opts.duration)
  private continuousSpin = false; // true: no counter-rotation during a morph, both globes just keep turning forward
  private layoutX = 0;
  private lx = NaN;

  constructor(private readonly scene: THREE.Scene, private readonly sunDir: THREE.Vector3, spec: PlanetSpec, private readonly aspect: () => number) {
    this.current = this.globeFor(spec);
    this.current.group.visible = true; this.current.setOpacity(1);
  }

  private globeFor(s: PlanetSpec) {
    let g = this.cache.get(s.kind);
    if (!g) { g = createPlanetGlobe(s, { radius: R, segments: 128 }); g.setSunDirection(this.sunDir); g.setSpinRate(this.spinRate); g.group.visible = false; this.scene.add(g.group); this.cache.set(s.kind, g); }
    return g;
  }

  setSpinRate(r: number) { this.spinRate = r; for (const g of this.cache.values()) g.setSpinRate(r); }

  /** Planet right of centre, leaving the left for UI. */
  place(dt: number) {
    const a = this.aspect();
    const halfW = Math.tan(THREE.MathUtils.degToRad(14)) * CAM_DIST * a;
    const target = a > 1.15 ? Math.min(halfW * 0.38, halfW - R - 1.5) : 0;
    this.layoutX = Number.isNaN(this.lx) ? target : this.layoutX + (target - this.layoutX) * Math.min(1, dt * 4);
    this.lx = this.layoutX;
    this.planetPos.set(this.layoutX, 0, 0);
  }

  setPlanet(next: PlanetSpec, opts: { duration?: number; continuousSpin?: boolean }) {
    if (next.kind === this.current.spec.kind) return false;
    this.fadeDur = opts.duration ?? FADE; this.morphRate = FADE / this.fadeDur; this.continuousSpin = !!opts.continuousSpin;
    if (this.outgoing) this.outgoing.group.visible = false;
    this.outgoing = this.current;
    this.current = this.globeFor(next);
    this.current.group.visible = true;
    this.current.spin.rotation.y = this.outgoing.spin.rotation.y + (this.continuousSpin ? 0 : 0.9); // arrives mid-rotation → reads as a smooth turn
    this.current.setOpacity(0); this.current.setCloudPresence(0); this.current.setTerraform(0);
    this.fade = 0;
    return true;
  }

  /** Deploy takes over the current globe: no morph in flight, full scale / opacity / clouds. */
  settleForDeploy() {
    const g = this.current;
    g.group.scale.setScalar(1); g.setOpacity(1); g.setCloudPresence(1);
    if (this.outgoing) { this.outgoing.group.visible = false; this.outgoing = null; } this.fade = 1;
  }

  updateFade(dt: number) {
    if (this.fade >= 1) return;
    const { current, outgoing } = this;
    this.fade = Math.min(1, this.fade + dt / this.fadeDur);
    const fade = this.fade;
    // Staggered quintic windows: the new globe dissolves in over the old one (5 → 70 %); the old one, kept slightly
    // smaller so it sits behind, only fades its shells out afterwards (40 → 100 %). No ghosting, no popping.
    const inE = win(0.05, 0.7, fade), outE = win(0.4, 1, fade), e = smoother(fade);
    current.setOpacity(inE);
    current.setCloudPresence(win(0.4, 1, fade));   // new clouds condense out only once the surface is solid
    current.group.scale.setScalar(1.003 - 0.003 * e);
    if (outgoing) {
      outgoing.setOpacity(1 - outE);
      outgoing.setCloudPresence(1 - win(0, 0.5, fade)); // old clouds dissipate first, while the old surface is still solid
      outgoing.group.scale.setScalar(1 - 0.015 * outE);
      if (!this.continuousSpin) outgoing.spin.rotation.y -= dt * 0.35 * this.morphRate * (1 - outE);
      if (fade >= 1) { outgoing.group.visible = false; outgoing.group.scale.setScalar(1); this.outgoing = null; current.group.scale.setScalar(1); }
    }
    if (!this.continuousSpin) current.spin.rotation.y -= dt * 0.35 * this.morphRate * (1 - e) * 0.9;
  }

  updateGlobes(dt: number, time: number) {
    for (const g of [this.current, this.outgoing]) if (g) { g.group.position.copy(this.planetPos); g.update(dt, time); }
  }

  dispose() { this.cache.forEach((g) => g.dispose()); this.cache.clear(); }
}
