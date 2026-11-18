// Renders the game's real PlanetGlobe (same shaders as the orbit menu) into each planet card.
// Delegates to the shared `@terra/render/planets/PlanetThumbnails` single-WebGL-context compositor.
import { mountPlanetThumbnails, type PlanetThumbnailsHandle } from '@terra/render/planets/PlanetThumbnails';

export function initPlanetCards(): PlanetThumbnailsHandle | null {
  const canvases = [...document.querySelectorAll<HTMLCanvasElement>('canvas[data-planet]')];
  if (!canvases.length) return null;
  return mountPlanetThumbnails(canvases, { size: 280, spinMultiplier: 6 });
}
