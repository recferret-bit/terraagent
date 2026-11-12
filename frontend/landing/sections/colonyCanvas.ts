// Section 02 — Autonomous Colony in Motion: exact in-game hex gameplay rendering on the forest/ocean planet
// (Thalassa Verde) near the water with trees, HQ (Command Hub), Solar Array, Pylon, Metal Extractor, and 2 bots.
import { ColonyStage3D } from '../colony/ColonyStage3D';

export function initColonyCanvas(): void {
  const stageEl = document.getElementById('colony-stage');
  if (!stageEl) return;

  try {
    const stage = new ColonyStage3D(stageEl);
    (window as unknown as { __colony?: ColonyStage3D }).__colony = stage;
    stage.start();
  } catch (e) {
    console.warn('colony 3D stage unavailable', e);
  }
}
