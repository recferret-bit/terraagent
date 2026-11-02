import type * as THREE from 'three';
import type { ClientView } from '../../store/replica/viewCodec';

/** What 3D renderers (the Hub ghost) get from the online session: the scene and a tile-to-world mapping (terrain height included). */
export interface Scene3dService {
  scene: THREE.Scene;
  /** Axial float tile coords to world metres, y = terrain height there. */
  tileToWorld(x: number, y: number): { x: number; y: number; z: number };
  /** Biome key of the current planet look (`PlanetSpec.biomeKey`). */
  biomeKey(): string;
}

/** The newest sim view with what a renderer needs each frame. */
export interface SimFrame {
  view: ClientView;
  /** Estimated current server tick, fractional. */
  serverTick: number;
  /** true: draw the predicted view with correction blending; false: interpolate 400 ms behind (`?predict=0` / auto-off). */
  predicting: boolean;
}

declare module '../../core/registry/types' {
  interface FeatureServices { scene3d?: Scene3dService }
  interface GameView { sim?: SimFrame }
}

/** A rendered pose in axial tile coordinates (`rot` in radians). */
export interface Pose { x: number; y: number; rot: number }

/** Shortest-arc interpolation of an angle in radians. */
export const lerpAngle = (a: number, b: number, k: number): number => {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * k;
};
