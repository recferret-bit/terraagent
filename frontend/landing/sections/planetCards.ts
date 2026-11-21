// Renders the game's real PlanetGlobe (same shaders as the orbit menu) into each planet card.
// Delegates to the shared `@terra/render/planets/PlanetThumbnails` single-WebGL-context compositor.
import { mountPlanetThumbnails, type PlanetThumbnailsHandle } from '@terra/render/planets/PlanetThumbnails';

export function initPlanetCards(): PlanetThumbnailsHandle | null {
  const canvases = [...document.querySelectorAll<HTMLCanvasElement>('canvas[data-planet]')];
  if (!canvases.length) return null;
  for (const cv of canvases) {
    if (cv.parentElement) cv.parentElement.dataset.stageState = 'loading';
  }
  const handle = mountPlanetThumbnails(canvases, { size: 280, spinMultiplier: 6 });
  if (!handle) {
    for (const cv of canvases) {
      const parent = cv.parentElement;
      if (parent) {
        parent.classList.add('is-fallback');
        parent.dataset.stageState = 'fallback';
      }
    }
  }
  return handle;
}
