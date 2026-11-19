import * as THREE from 'three';
import { buildContinuousHabitatIndex, createPlanetBiosphere } from '../../biosphere';
import type { CreatePlanetSurface, PlanetSurface } from './types';
import { SurfaceContext } from './SurfaceContext';
import { BIOME_BUILDERS } from './biomes';

export { applyPlanetLook } from '../applyPlanetLook';
export type { PlanetSurface, CreatePlanetSurface } from './types';

export const createPlanetSurface: CreatePlanetSurface = (spec, opts) => {
  const ctx = new SurfaceContext(spec, opts);
  BIOME_BUILDERS[spec.kind](ctx);

  const { group, heightAt, uniformSets, disposables, timeU } = ctx;
  const waterLvl = ctx.field.liquid ? ctx.level : null;
  const biosphere = createPlanetBiosphere({
    look: spec,
    habitat: buildContinuousHabitatIndex(ctx.half, spec, heightAt, waterLvl),
    waterFauna: ctx.waterFauna,
  });
  group.add(biosphere.group);
  disposables.push(biosphere);

  const landingSite = new THREE.Vector3(0, heightAt(0, 0), 0);
  let disposed = false;
  const surface: PlanetSurface = {
    spec, group, biosphere, halfSize: ctx.half, landingSite,
    heightAt, isLiquid: ctx.isLiquid,
    update(dt, time) {
      timeU.value = time;
      for (const u of uniformSets) if (u.uTime) u.uTime.value = time;
      ctx.waterFauna?.cullToFocus();
      biosphere.tick(dt);
    },
    dispose() {
      if (disposed) return; disposed = true;
      group.removeFromParent();
      for (const d of disposables) d.dispose();
    },
  };
  return surface;
};
