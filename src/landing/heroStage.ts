// Landing hero: the game's own orbit-menu stage (globe shaders, sun + flare, nebula/stars/parallax, asteroids, moons,
// artificial satellites, carrier), via the same ColonyViewport (28° FOV, ACES, bloom). The world morphs every 10 s.
import { createColonyViewport } from '../core/createColonyViewport';
import { PLANET_KINDS, PLANET_SPECS, type PlanetKind } from '../planets/PlanetSpec';
import { createOrbitalStage } from '../orbit/OrbitalStage';
import '../kitbash';

// One world's cycle (seconds), c = 0 when its terraform starts:
//   0 → 8 terraform (4 steps) · 8 → 10 admire it · 10 → 11.5 collapse (terraform plays in reverse, so no city, border or
//   pillar is left hanging around) · 11.5 → 14.9 morph to the next barren world · 14.9 → 16.4 calm gap, then it repeats.
const TERRA_S = 8, HOLD_S = 2, GAP_S = 1.5;
const MORPH_FADE_S = 3.4; // slow, staggered crossfade (the game menu uses 1.2 s)
const T_COLLAPSE = TERRA_S + HOLD_S, T_MORPH = T_COLLAPSE + GAP_S, CYCLE_S = T_MORPH + MORPH_FADE_S + GAP_S;
const smooth01 = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const SPIN = 0.09;        // rad/s: the globe visibly turns (the menu's idle drift is 0.025)
const host = document.getElementById('hero-stage');
const nameEl = document.getElementById('hero-world');
const countEl = document.getElementById('hero-morph');

if (host) {
  try {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const vp = createColonyViewport(host);
    const startKind = (PLANET_KINDS.includes(new URLSearchParams(location.search).get('world') as PlanetKind)
      ? new URLSearchParams(location.search).get('world') : 'dune') as PlanetKind;
    let idx = PLANET_KINDS.indexOf(startKind);
    const stage = createOrbitalStage(vp, PLANET_SPECS[PLANET_KINDS[idx]]);
    vp.setView(stage.scene, stage.camera);
    host.classList.add('is-live');
    (window as any).__hero = { stage, vp, specs: PLANET_SPECS }; // QA handle

    const label = () => {
      const s = PLANET_SPECS[PLANET_KINDS[idx]];
      if (nameEl) nameEl.textContent = `${s.name.toUpperCase()} · ${s.traits[0].toUpperCase()}`;
    };
    label();

    // each world: barren at t=0, four 2-second terraform steps, fully done at 8 s, then 2 s to admire it before the morph
    const STEPS = 4;
    stage.setSpinRate(SPIN);
    stage.setTerraform(0);
    let stageNo = 0;
    let visible = true, last = performance.now(), time = 0, c = 0, morphed = false;
    new IntersectionObserver((es) => { visible = es[0].isIntersecting; last = performance.now(); }).observe(host);
    new ResizeObserver(() => vp.resize()).observe(host);

    const step = (dt: number) => {
      time += dt;
      if (!reduced) {
        c += dt;
        if (c >= CYCLE_S) { c -= CYCLE_S; morphed = false; }
        let tStage = 0, smooth = false;
        if (c < TERRA_S) tStage = (c / TERRA_S) * STEPS;
        else if (c < T_COLLAPSE) tStage = STEPS;
        else if (c < T_MORPH) { tStage = STEPS * (1 - smooth01((c - T_COLLAPSE) / GAP_S)); smooth = true; }
        else if (!morphed) {
          morphed = true;
          stage.setTerraform(0);                    // the outgoing world is fully collapsed (barren) before it starts to fade
          idx = (idx + 1) % PLANET_KINDS.length;
          stage.setPlanet(PLANET_SPECS[PLANET_KINDS[idx]], { duration: MORPH_FADE_S, continuousSpin: true });
          label();
        }
        stage.setTerraform(tStage, smooth);
        stageNo = Math.min(STEPS, Math.floor(tStage) + (tStage > 0 && tStage < STEPS ? 1 : 0));
        if (countEl) countEl.textContent = `WORLD ${idx + 1} / ${PLANET_KINDS.length} · TERRAFORM ${stageNo} / ${STEPS} · ` + (c < T_MORPH ? `MORPH IN ${Math.ceil(T_MORPH - c)} S` : 'MORPHING');
      }
      stage.update(dt, time);
      vp.render();
    };

    if (reduced) {
      stage.setTerraform(2.45); // reduced motion: one still frame, caught mid-step so the front is visible
      for (let i = 0; i < 4; i++) step(0.016); // settle layout, then a single still frame
      if (countEl) countEl.textContent = `WORLD ${idx + 1} / ${PLANET_KINDS.length}`;
      addEventListener('resize', () => step(0));
    } else {
      const loop = () => {
        requestAnimationFrame(loop);
        const now = performance.now(); // one clock for start, IntersectionObserver resets and every frame
        const dt = Math.min(Math.max((now - last) / 1000, 0), 0.05); last = now;
        if (visible) step(dt);
      };
      requestAnimationFrame(loop);
    }
  } catch (e) {
    console.warn('hero stage: WebGL unavailable', e);
    host.classList.add('is-fallback');
  }
}
