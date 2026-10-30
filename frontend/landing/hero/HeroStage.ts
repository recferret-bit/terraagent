// Landing hero: the game's own orbit-menu stage (globe shaders, sun + flare, nebula/stars/parallax, asteroids, moons,
// artificial satellites, carrier), via the same ColonyViewport (28° FOV, ACES, bloom). The world morphs every 10 s.
import { createColonyViewport, type ColonyViewport } from '@shared/engine/core/createColonyViewport';
import { StageHost, prefersReducedMotion } from '@shared/engine/core/StageHost';
import { PLANET_KINDS, PLANET_SPECS, type PlanetKind } from '@shared/engine/planets/PlanetSpec';
import { createOrbitalStage } from '@shared/engine/orbit/OrbitalStage';
import '@shared/engine/kitbash';

// One world's cycle (seconds), c = 0 when its terraform starts:
//   0 → 8 terraform (4 steps) · 8 → 10 admire it · 10 → 11.5 collapse (terraform plays in reverse, so no city, border or
//   pillar is left hanging around) · 11.5 → 14.9 morph to the next barren world · 14.9 → 16.4 calm gap, then it repeats.
const TERRA_S = 8, HOLD_S = 2, GAP_S = 1.5, STEPS = 4;
const MORPH_FADE_S = 3.4; // slow, staggered crossfade (the game menu uses 1.2 s)
const T_COLLAPSE = TERRA_S + HOLD_S, T_MORPH = T_COLLAPSE + GAP_S, CYCLE_S = T_MORPH + MORPH_FADE_S + GAP_S;
const SPIN = 0.09; // rad/s: the globe visibly turns (the menu's idle drift is 0.025)
const smooth01 = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

export class HeroStage {
  private readonly vp: ColonyViewport;
  private readonly stage: ReturnType<typeof createOrbitalStage>;
  private readonly nameEl = document.getElementById('hero-world');
  private readonly countEl = document.getElementById('hero-morph');
  private idx: number;
  private readonly reduced = prefersReducedMotion();
  private time = 0; private c = 0; private morphed = false;

  constructor(private readonly host: HTMLElement) {
    this.vp = createColonyViewport(host);
    const asked = new URLSearchParams(location.search).get('world') as PlanetKind;
    this.idx = PLANET_KINDS.indexOf(PLANET_KINDS.includes(asked) ? asked : 'dune');
    this.stage = createOrbitalStage(this.vp, PLANET_SPECS[PLANET_KINDS[this.idx]]);
    this.vp.setView(this.stage.scene, this.stage.camera);
    host.classList.add('is-live');
    (window as any).__hero = { stage: this.stage, vp: this.vp, specs: PLANET_SPECS }; // QA handle
    this.label();
    this.stage.setSpinRate(SPIN);
    this.stage.setTerraform(0);
  }

  start() {
    const loop = new StageHost({ elements: [this.host], onFrame: (dt) => this.step(dt), onResize: () => this.vp.resize() });
    loop.start();
    if (!loop.reduced) return;
    this.stage.setTerraform(2.45); // reduced motion: one still frame, caught mid-step so the front is visible
    for (let i = 0; i < 4; i++) this.step(0.016); // settle layout, then a single still frame
    if (this.countEl) this.countEl.textContent = `WORLD ${this.idx + 1} / ${PLANET_KINDS.length}`;
    addEventListener('resize', () => this.step(0));
  }

  private label() {
    const s = PLANET_SPECS[PLANET_KINDS[this.idx]];
    if (this.nameEl) this.nameEl.textContent = `${s.name.toUpperCase()} · ${s.traits[0].toUpperCase()}`;
  }

  private morphToNext() {
    this.morphed = true;
    this.stage.setTerraform(0); // the outgoing world is fully collapsed (barren) before it starts to fade
    this.idx = (this.idx + 1) % PLANET_KINDS.length;
    this.stage.setPlanet(PLANET_SPECS[PLANET_KINDS[this.idx]], { duration: MORPH_FADE_S, continuousSpin: true });
    this.label();
  }

  /** Advance the terraform / collapse / morph timeline. */
  private advanceCycle(dt: number) {
    const c = (this.c += dt);
    if (c >= CYCLE_S) { this.c -= CYCLE_S; this.morphed = false; }
    const cc = this.c;
    let tStage = 0, smooth = false;
    if (cc < TERRA_S) tStage = (cc / TERRA_S) * STEPS;
    else if (cc < T_COLLAPSE) tStage = STEPS;
    else if (cc < T_MORPH) { tStage = STEPS * (1 - smooth01((cc - T_COLLAPSE) / GAP_S)); smooth = true; }
    else if (!this.morphed) this.morphToNext();
    this.stage.setTerraform(tStage, smooth);
    const stageNo = Math.min(STEPS, Math.floor(tStage) + (tStage > 0 && tStage < STEPS ? 1 : 0));
    if (this.countEl) this.countEl.textContent = `WORLD ${this.idx + 1} / ${PLANET_KINDS.length} · TERRAFORM ${stageNo} / ${STEPS} · ` + (cc < T_MORPH ? `MORPH IN ${Math.ceil(T_MORPH - cc)} S` : 'MORPHING');
  }

  private step(dt: number) {
    this.time += dt;
    if (!this.reduced) this.advanceCycle(dt);
    this.stage.update(dt, this.time);
    this.vp.render();
  }
}

export function initHeroStage() {
  const host = document.getElementById('hero-stage');
  if (!host) return;
  try { new HeroStage(host).start(); }
  catch (e) { console.warn('hero stage: WebGL unavailable', e); host.classList.add('is-fallback'); }
}
