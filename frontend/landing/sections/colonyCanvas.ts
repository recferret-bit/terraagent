// Section 02: the Canvas2D hex colony, gated to the viewport; reduced motion renders one still frame (t = 9 s).
import { StageHost } from '@shared/engine/core/StageHost';
import { ColonyScene } from '../colony/ColonyScene';

export function initColonyCanvas() {
  const cv = document.getElementById('colony-canvas') as HTMLCanvasElement | null;
  if (!cv) return;
  const scene = new ColonyScene(cv);
  const host = new StageHost({ elements: [cv], onFrame: (_dt, t) => scene.draw(t), maxDt: Infinity });
  if (host.reduced) { host.renderOnce(0, 9); addEventListener('resize', () => host.renderOnce(0, 9)); }
  else host.start();
}
