import type * as THREE from 'three';
import type { ClientView } from '../../store/replica/viewCodec';

/** What 3D renderers (the Hub ghost) get from the online session: the scene and a tile-to-world mapping (terrain height included). */
export interface Scene3dService {
  scene: THREE.Scene;
  /** Axial float tile coords to world metres, y = terrain height there. */
  tileToWorld(x: number, y: number): { x: number; y: number; z: number };
  /** Live interpolated entity centre, projected onto terrain for ground indicators. */
  renderedEntityGroundPosition?(entityId: number): { x: number; y: number; z: number } | null;
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

export { lerpAngle, type Pose } from '@terra/render/motion/pose';
