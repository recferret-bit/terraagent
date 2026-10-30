import * as THREE from 'three';
import type { CreatePlanetSurface, PlanetSurface } from './types';
import { SurfaceContext } from './SurfaceContext';
import { BIOME_BUILDERS } from './biomes';

export { applyPlanetLook } from '../applyPlanetLook';
export type { PlanetSurface, CreatePlanetSurface } from './types';

/** Brightness/hue jitter relative to the geometry's baked vertex colours. */
const jitter = (amt: number, hueShift = 0) => (r: number, c: THREE.Color) => {
  const k = 1 + (r - 0.5) * 2 * amt;
  c.setRGB(k * (1 + (r - 0.5) * hueShift), k, k * (1 - (r - 0.5) * hueShift));
};

export const createPlanetSurface: CreatePlanetSurface = (spec, opts) => {
  const ctx = new SurfaceContext(spec, opts);
  BIOME_BUILDERS[spec.kind](ctx);

  const { group, heightAt, uniformSets, disposables, timeU } = ctx;
  const landingSite = new THREE.Vector3(0, heightAt(0, 0), 0);
  let disposed = false;
  const surface: PlanetSurface = {
    spec, group, halfSize: ctx.half, landingSite,
    heightAt, isLiquid: ctx.isLiquid,
    update(_dt, time) {
      timeU.value = time;
      for (const u of uniformSets) if (u.uTime) u.uTime.value = time;
    },
    dispose() {
      if (disposed) return; disposed = true;
      group.removeFromParent();
      for (const d of disposables) d.dispose();
    },
  };
  return surface;
};
