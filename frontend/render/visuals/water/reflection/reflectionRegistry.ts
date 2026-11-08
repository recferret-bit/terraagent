import type * as THREE from 'three';

/**
 * Which objects the water reflection pass (`WaterReflectionPass.ts`) mirrors about, and which it leaves out of the
 * mirror image. Water creators register on create and call the returned function on dispose; the pass reads the sets
 * every frame and only considers entries that are in the scene being rendered.
 */
export interface ReflectiveWater {
  /** Root of the water (surface + fauna): hidden during the mirror render; skipped while it or an ancestor is hidden. */
  readonly object: THREE.Object3D;
  /**
   * Height of the mirror plane (the undisplaced water surface) in `object`'s local space, default 0. The pass reads
   * the world level through `object`'s world matrix, so a moved parent (the space view offsets the terrain) is fine;
   * `object` must not be rotated off the horizontal.
   */
  readonly planeY?: number;
  /**
   * The surface meshes that may be on screen (descendants of `object`, or `object` itself); the pass keeps those
   * shown and inside the camera frustum and bounds the mirror render to their screen rect. Default: `[object]` when it
   * is a Mesh.
   */
  readonly parts?: () => Iterable<THREE.Mesh>;
}

const waters = new Set<ReflectiveWater>();
const excluded = new Set<THREE.Object3D>();

/** Registers a water surface for planar reflections; returns the unregister function (call it on dispose). */
export function registerReflectiveWater(water: ReflectiveWater): () => void {
  waters.add(water);
  return () => { waters.delete(water); };
}

/** Keeps `obj` (e.g. a debug overlay) out of the mirror image; returns the function that lets it back in. */
export function excludeFromReflection(obj: THREE.Object3D): () => void {
  excluded.add(obj);
  return () => { excluded.delete(obj); };
}

export const reflectiveWaters = (): ReadonlySet<ReflectiveWater> => waters;
export const reflectionExclusions = (): ReadonlySet<THREE.Object3D> => excluded;
