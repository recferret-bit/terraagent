import * as THREE from 'three';
import type { PlanetKind } from '../PlanetSpec';
import { createWater } from '../../visuals/terrain/Liquids';
import { GROUND_VARIANT_COUNT } from '../../visuals/terrain/groundFloraGeos';
import { buildInstanced, createFoliageMaterial, scatterGrid, type InstOpts, type Place } from '../../visuals/terrain/Scatter';
import { createWaterFauna } from '../../visuals/water/fauna/WaterFauna';
import { bakeShoreField, createShoreField, texelCentre } from '../../visuals/water/shoreField';
import { filterSurfacePlacesWithExclusion, SpatialExclusionGrid } from '../hex/flora/floraPlacementPipeline';
import {
  canFitObjectFootprint,
  classifySurfaceSite,
  type GroundFloraKind,
  type GroundObjectKind,
} from '../hex/flora/terrainCompatibility';
import type { SurfaceContext } from './SurfaceContext';

/** Shared footprint-aware surface compatibility gate for boulders, spires, trees, and flora on `PlanetSurface` biomes. */
export function canFitSurfaceObjectAt(
  c: SurfaceContext,
  biome: PlanetKind,
  waterLevel: number | null,
  kind: GroundObjectKind,
  x: number,
  z: number,
  forestDensity = 0,
  minFootprintRadius = 0,
): boolean {
  return canFitObjectFootprint(
    kind,
    x,
    z,
    (px, pz) =>
      classifySurfaceSite({
        biome,
        x: px,
        z: pz,
        y: c.heightAt(px, pz),
        waterLevel,
        slope: c.slopeAt(px, pz),
        planetSeed: c.spec.seed,
        forestDensity,
        rockMask: c.field.rock ? c.field.rock(px, pz) : 0,
        isWetlandCandidate: kind === 'reeds',
      }),
    minFootprintRadius,
  );
}

/** Shared water plane + baked `ShoreField` + `WaterFauna` builder for hydro-bearing `PlanetSurface` biomes. */
export function mountSurfaceHydroLayer(
  c: SurfaceContext,
  shallowHex: number,
  deepHex: number,
  biomeKind: 'oceanForest' | 'forestRock',
  seedSalt: number,
): void {
  const { level, heightAt, terrain } = c;
  const water = createWater(
    { level, heightTex: terrain.heightTex, span: terrain.span, coverage: terrain.span },
    shallowHex,
    deepHex,
    c.spec.sky.skyColor,
  );
  c.addLayer(water.mesh, water.uniforms, water);

  const shore = bakeShoreField((x, z) => {
    const depth = level - heightAt(x, z);
    return depth <= 0.08 ? 0 : depth > 0.95 ? 2 : 1;
  }, createShoreField(terrain.span, 384));
  for (let j = 0; j < shore.res; j++) {
    const tz = texelCentre(j, shore.res, shore.span);
    for (let i = 0; i < shore.res; i++) {
      const k = j * shore.res + i;
      if (shore.mask[k]) shore.bed[k] = Math.max(shore.bed[k]!, heightAt(texelCentre(i, shore.res, shore.span), tz) - level);
    }
  }

  const waterFauna = createWaterFauna({
    time: water.uniforms.uTime!,
    deepColor: water.uniforms.uDeep ?? { value: new THREE.Color(deepHex) },
    seed: c.spec.seed ^ seedSalt,
    planetSpan: terrain.span,
    biomeKind,
  });
  waterFauna.rebuild(shore);
  waterFauna.group.position.y = level;
  c.waterFauna = waterFauna;
  c.addLayer(waterFauna.group, {}, waterFauna);
}

export interface SurfaceFloraLayerSpec {
  readonly kind: GroundFloraKind;
  readonly cell: number;
  readonly prob: number;
  readonly radius: number;
  readonly sameKindDist: number;
  readonly geo: THREE.BufferGeometry;
  readonly sway: number;
  readonly doubleSided?: boolean;
  readonly instOpts: InstOpts;
  readonly extraProb?: (x: number, z: number) => number;
}

/**
 * Scatters a ground flora layer across a continuous `PlanetSurface`, consulting `classifySurfaceSite` +
 * `canFitObjectOnTerrain` so coastal sand bands and incompatible substrates stay clear.
 */
export function addCompatibleSurfaceFlora(
  c: SurfaceContext,
  grid: SpatialExclusionGrid,
  biome: PlanetKind,
  waterLevel: number | null,
  spec: SurfaceFloraLayerSpec,
  forestDensityAt?: (x: number, z: number) => number,
): Place[] {
  const raw = scatterGrid(c.rng, c.ext, spec.cell * c.cellMul, (x, z) => {
    const lf = c.landingFree(x, z);
    if (lf <= 0.01) return 0;
    const fd = forestDensityAt ? forestDensityAt(x, z) : 0;
    if (!canFitSurfaceObjectAt(c, biome, waterLevel, spec.kind, x, z, fd, spec.radius)) return 0;
    const mod = spec.extraProb ? spec.extraProb(x, z) : 1;
    return spec.prob * mod * lf;
  });
  c.lift(raw);
  const placed = filterSurfacePlacesWithExclusion(grid, raw, spec.radius, spec.sameKindDist, spec.kind);
  placed.forEach((p, idx) => {
    p.breedIndex = idx % GROUND_VARIANT_COUNT;
  });
  c.addMesh(
    buildInstanced(
      spec.geo,
      createFoliageMaterial(c.timeU, spec.sway, Boolean(spec.doubleSided), true),
      placed,
      { ...spec.instOpts, encodeBreedInColor: true },
    ),
  );
  return placed;
}
