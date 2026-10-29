import * as THREE from 'three';
import type { PlanetSpec } from '../PlanetSpec';

/** Walkable diorama patch for one planet. Owned by the "surface" workstream; consumed by playground, descent, game. */
export interface PlanetSurface {
  readonly spec: PlanetSpec;
  /** Everything (terrain, water, rocks, trees, props). Add to a scene; y=0 is the nominal build plane. */
  readonly group: THREE.Group;
  /** Half-extent of the square playable patch in metres (terrain extends a bit beyond, fading to fog). */
  readonly halfSize: number;
  /** Terrain height (m) at world x,z (water surfaces NOT included). */
  heightAt(x: number, z: number): number;
  /** True if x,z is water (not buildable). */
  isLiquid(x: number, z: number): boolean;
  /** Flat, dry spawn area near origin (hero lands here). Always within ~12 m of (0,0). */
  readonly landingSite: THREE.Vector3;
  /** Per-frame animation (water waves, foliage sway, dust). dt seconds, time seconds. */
  update(dt: number, time: number): void;
  dispose(): void;
}

export type CreatePlanetSurface = (spec: PlanetSpec, opts?: { halfSize?: number; quality?: 'low' | 'high' }) => PlanetSurface;
