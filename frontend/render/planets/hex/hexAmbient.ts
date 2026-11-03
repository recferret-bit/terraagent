import * as THREE from 'three';
import type { PlanetKind, PlanetSpec } from '../PlanetSpec';
import { createParticles, type ParticleOpts } from '../../visuals/terrain/Particles';
import { getViewFocus, isViewFocusEnabled } from '../../core/viewFocus';

/** Per-kind look of the hex planet's ambient air layer; density is per 100 m x 100 m, capped by `MAX_POINTS`. */
type AmbientLook = Omit<ParticleOpts, 'count' | 'box' | 'seed'> & { per100m: number };

const AMBIENT_BY_KIND: Record<PlanetKind, AmbientLook> = {
  // Sand dust: many faint, large, normal-blended grains hugging the dunes, riding the wind hard.
  dune: {
    per100m: 220, height: 14, size: 1.5, color: new THREE.Color(0xf0cf9a), drift: new THREE.Vector3(0, 0.05, 0),
    windDrift: 0.65, wobble: 1.5, additive: false, alpha: 0.16,
  },
  // Pollen and sea spray: sparse, small, glowing, slow.
  oceanForest: {
    per100m: 70, height: 12, size: 0.7, color: new THREE.Color(0xfff3c0), drift: new THREE.Vector3(0, 0.15, 0),
    windDrift: 0.17, wobble: 2.0, additive: true, alpha: 0.45,
  },
  // Highland motes: fewest, smallest, lazy.
  forestRock: {
    per100m: 55, height: 16, size: 0.55, color: new THREE.Color(0xe8f2c0), drift: new THREE.Vector3(0, 0.1, 0),
    windDrift: 0.1, wobble: 2.5, additive: true, alpha: 0.38,
  },
};

const MAX_POINTS = 700;
/**
 * Side (m) of the wrap box while the view focus is on: the box follows the focus centre, so it only needs to cover the
 * focus disc (radius ~85 m at the default colony zoom) instead of the whole planet; points fade over its outer 20 %.
 */
export const AMBIENT_FOLLOW_BOX = 180;
const EDGE_FADE = 0.2;

export interface HexAmbient {
  readonly points: THREE.Points;
  /** Sets the layer's own clock (s); the wind part runs on the shared wind clock. */
  setTime(t: number): void;
  dispose(): void;
}

/**
 * One wind-driven ambient particle layer over the hex planet (one draw call): dust on dunes, pollen / spray on ocean
 * worlds, motes in the highlands. `halfSize` is the half-extent of the square inside the planet. With the view focus
 * on (`core/viewFocus.ts`), the wrap box is at most `AMBIENT_FOLLOW_BOX` wide and centred on the focus every frame
 * (points keep their world spot and wrap at the faded edge, so panning never pops one); the point count is sized for
 * that box, so a big planet keeps its on-screen density without drawing points nobody sees.
 */
export function createHexAmbient(look: PlanetSpec, halfSize: number): HexAmbient {
  const { per100m, ...rest } = AMBIENT_BY_KIND[look.kind];
  const planetBox = Math.max(20, halfSize * 2);
  const follow = isViewFocusEnabled() && planetBox > AMBIENT_FOLLOW_BOX;
  const box = follow ? AMBIENT_FOLLOW_BOX : planetBox;
  const count = Math.min(MAX_POINTS, Math.max(40, Math.round(per100m * (box / 100) ** 2)));
  const layer = createParticles({ ...rest, count, box, seed: look.seed, edgeFade: follow ? EDGE_FADE : 0 });
  layer.points.name = 'hexAmbient';
  if (follow) {
    const p = new THREE.Vector3();
    layer.points.onBeforeRender = () => {
      const f = getViewFocus();
      p.set(f.x, 0, f.z);
      layer.points.worldToLocal(p); // the terrain group may be offset (space view)
      layer.uniforms.uCenter.value.set(p.x, p.z);
    };
  }
  return {
    points: layer.points,
    setTime(t) { layer.uniforms.uTime.value = t; },
    dispose() { layer.points.removeFromParent(); layer.dispose(); },
  };
}
