import * as THREE from 'three';
import { mulberry32 } from '../terrain/noise';
import { createStarLayers, createMotes } from './parallax/stars';
import { createNebulae } from './parallax/nebulae';
import { createDistantPlanets } from './parallax/planets';
import { createAsteroids } from './parallax/asteroids';
import type { ParallaxCtx, ParallaxPart } from './parallax/types';

/**
 * World-space depth layers for the orbital menu so camera/mouse motion produces real 3D parallax:
 *   far stars (z≈-620) → mid stars (-320) → near stars (-150) → nebula planes (-650/-430/-270) →
 *   distant gas giant + ice dwarf (-230/-340) → asteroid drift (z -40..30) → foreground dust motes (z +28..48).
 * The stage's camera sits at z≈CAM and looks down -Z, so every layer is a slab perpendicular to the view.
 */
export interface ParallaxLayers {
  readonly group: THREE.Group;
  setNebulaTint(a: THREE.Color): void;
  update(dt: number, time: number): void;
  dispose(): void;
}

export function createParallaxLayers(opts: { seed: number; camDist: number; sunDir: THREE.Vector3; aspect: () => number }): ParallaxLayers {
  const group = new THREE.Group(); group.name = 'ParallaxLayers';
  const halfTan = Math.tan(THREE.MathUtils.degToRad(14));
  const ctx: ParallaxCtx = {
    group, rnd: mulberry32(opts.seed), camDist: opts.camDist, halfTan, sunDir: opts.sunDir,
    slab: (depthBehind) => { const dist = opts.camDist + depthBehind; return { w: halfTan * dist * 2.9, h: halfTan * dist * 1.25 }; },
  };
  // Build order = group child order (and consumes the shared RNG in the same sequence).
  const stars = createStarLayers(ctx);
  const nebulae = createNebulae(ctx);
  const planets = createDistantPlanets(ctx);
  const asteroids = createAsteroids(ctx);
  const motes = createMotes(ctx);
  const parts: ParallaxPart[] = [...stars, nebulae, planets, asteroids, motes];

  return {
    group,
    setNebulaTint: (a) => nebulae.setTint(a),
    update(dt, time) { for (const p of parts) p.update?.(dt, time); },
    dispose() { parts.forEach((p) => p.dispose()); group.removeFromParent(); },
  };
}
