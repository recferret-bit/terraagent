import type * as THREE from 'three';

/** One depth layer of the parallax stack: adds its objects to the shared group and owns their lifetime. */
export interface ParallaxPart {
  update?(dt: number, time: number): void;
  dispose(): void;
}

export interface ParallaxCtx {
  group: THREE.Group;
  rnd: () => number;
  camDist: number;
  halfTan: number;
  sunDir: THREE.Vector3;
  /** World-space slab size perpendicular to the view, `depthBehind` metres behind the focus plane. */
  slab(depthBehind: number): { w: number; h: number };
}
