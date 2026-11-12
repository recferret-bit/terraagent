// Section 02 — Autonomous Colony in Motion: real in-game Three.js 3D rendering on the forest planet (Thalassa Verde)
// near the water with trees, HQ (Command Hub), Solar Array, Pylon, Metal Extractor, and 2 working bots.
import { ColonyStage3D } from '../colony/ColonyStage3D';

export function initColonyCanvas(): void {
  const stageEl = document.getElementById('colony-stage');
  if (!stageEl) return;

  const hud = {
    tick: document.querySelector<HTMLElement>('[data-hud="tick"]'),
    power: document.querySelector<HTMLElement>('[data-hud="power"]'),
    metal: document.querySelector<HTMLElement>('[data-hud="metal"]'),
    crystal: document.querySelector<HTMLElement>('[data-hud="crystal"]'),
    speed: document.querySelector<HTMLElement>('[data-hud="speed"]'),
  };

  try {
    const stage = new ColonyStage3D(stageEl);
    (window as unknown as { __colony?: ColonyStage3D }).__colony = stage;

    stageEl.addEventListener('pointermove', (e) => {
      const r = stageEl.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
      const ny = ((e.clientY - r.top) / r.height) * 2 - 1;
      stage.setPointerAim(nx, ny);
    });
    stageEl.addEventListener('pointerleave', () => {
      stage.setPointerAim(0, 0);
    });
    stageEl.addEventListener('click', () => {
      const next = stage.cycleSpeed();
      if (hud.speed) hud.speed.textContent = `${next}×`;
    });

    let lastTickShown = -1;
    stage.start((s) => {
      const t = s.tickCount;
      if (t === lastTickShown) return;
      lastTickShown = t;
      if (hud.tick) hud.tick.textContent = String(t).padStart(5, '0');
      if (hud.power) hud.power.textContent = `+${18 + (Math.floor(t / 15) % 4)} MW`;
      if (hud.metal) hud.metal.textContent = `${412 + Math.floor(t / 8)} t`;
      if (hud.crystal) hud.crystal.textContent = `${128 + Math.floor(t / 22)} t`;
    });
  } catch (e) {
    console.warn('colony 3D stage unavailable', e);
  }
}
