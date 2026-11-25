import type { PlanetKind } from '../../PlanetSpec';
import { HEX_PROP_EDGE_MARGIN_M } from '../hexMath';

export type GroundFloraKind =
  | 'grassTuft'
  | 'wildflower'
  | 'bush'
  | 'saguaro'
  | 'barrelCactus'
  | 'reeds'
  | 'duneTree';

export type TerrainPropKind = 'pine' | 'duneTree' | 'boulder' | 'spire' | 'metals' | 'minerals' | 'oil';
export type GroundObjectKind = GroundFloraKind | TerrainPropKind;

export const GROUND_FLORA_KINDS: readonly GroundFloraKind[] = [
  'grassTuft',
  'wildflower',
  'bush',
  'saguaro',
  'barrelCactus',
  'reeds',
  'duneTree',
] as const;

/**
 * Semantic terrain substrate categories shared across `HexTerrain` and continuous `PlanetSurface`.
 * Ground objects declare which substrates they can physically/ecologically inhabit, ensuring
 * coastal beach sand near water hexagons stays clean of bushes, wildflowers, grass tufts, reeds, and rocks.
 */
export type TerrainSubstrate =
  | 'submerged'
  | 'craterHole'
  | 'engineeredPad'
  | 'depositPad'
  | 'livingTurf'
  | 'coastalSand'
  | 'coastalForest'
  | 'littoralWetland'
  | 'meadowTurf'
  | 'forestFloor'
  | 'uplandSlope'
  | 'rockOutcrop'
  | 'duneMesaCap'
  | 'aridDune'
  | 'desertWadi';

export type GroundObjectCategory = 'tree' | 'shrub' | 'herb' | 'succulent' | 'wetland' | 'rock' | 'deposit';

export interface FloraFootprint {
  readonly radius: number;
  /** Maximum world-space radial extent of rendered foliage/body vertices under max instance scale + tilt. */
  readonly substrateRadius?: number;
  readonly sameKindDist: number;
  readonly rimMargin: number;
}

export interface GroundObjectSpec {
  readonly id: GroundObjectKind;
  readonly category: GroundObjectCategory;
  readonly biomes: readonly PlanetKind[];
  readonly allowedSubstrates: readonly TerrainSubstrate[];
  readonly footprintSubstrates?: readonly TerrainSubstrate[];
  readonly maxSlope: number;
  readonly minMoisture?: number;
  readonly maxMoisture?: number;
  readonly footprint: FloraFootprint;
}

const DUNE_TREE_RIM_MARGIN_M = Math.max(HEX_PROP_EDGE_MARGIN_M, 1.48);

/**
 * Computes the world-space outer canopy/blade extent of a ground flora instance at scale roll `s` (`0..1`),
 * accounting for geometry outer vertex radius, `FLORA_OPTS.sx` interpolation, and tilt overhang.
 */
export function renderedFloraOuterRadius(kind: GroundFloraKind, s: number): number {
  const u = Math.min(1, Math.max(0, s));
  switch (kind) {
    case 'grassTuft': return Math.max(0.26, 0.394 * (0.55 + 0.40 * u) + 0.065);
    case 'wildflower': return Math.max(0.28, 0.340 * (0.65 + 0.40 * u) + 0.055);
    case 'bush': return Math.max(0.48, 0.556 * (0.58 + 0.44 * u) + 0.055);
    case 'reeds': return Math.max(0.34, 0.210 * (0.68 + 0.40 * u) + 0.06);
    case 'saguaro': return Math.max(0.52, 0.514 * (0.55 + 0.37 * u) + 0.04);
    case 'barrelCactus': return Math.max(0.46, 0.493 * (0.62 + 0.46 * u) + 0.04);
    case 'duneTree': return 0.56;
  }
}

/** Authoritative catalog describing every ground object and the terrain substrates it fits onto. */
export const GROUND_OBJECT_SPECS: Readonly<Record<GroundObjectKind, GroundObjectSpec>> = {
  pine: {
    id: 'pine',
    category: 'tree',
    biomes: ['forestRock', 'oceanForest'],
    allowedSubstrates: ['forestFloor', 'coastalForest'],
    footprintSubstrates: ['forestFloor', 'coastalForest', 'meadowTurf', 'uplandSlope'],
    maxSlope: 0.58,
    footprint: { radius: 0.58, sameKindDist: 0.72, rimMargin: DUNE_TREE_RIM_MARGIN_M },
  },
  duneTree: {
    id: 'duneTree',
    category: 'tree',
    biomes: ['dune'],
    allowedSubstrates: ['desertWadi'],
    footprintSubstrates: ['desertWadi', 'aridDune'],
    maxSlope: 0.52,
    footprint: { radius: 0.56, sameKindDist: 1.55, rimMargin: DUNE_TREE_RIM_MARGIN_M },
  },
  saguaro: {
    id: 'saguaro',
    category: 'succulent',
    biomes: ['dune'],
    allowedSubstrates: ['aridDune', 'desertWadi'],
    maxSlope: 0.48,
    maxMoisture: 0.82,
    footprint: { radius: 0.52, sameKindDist: 1.75, rimMargin: HEX_PROP_EDGE_MARGIN_M },
  },
  barrelCactus: {
    id: 'barrelCactus',
    category: 'succulent',
    biomes: ['dune'],
    allowedSubstrates: ['aridDune', 'desertWadi'],
    footprintSubstrates: ['aridDune', 'desertWadi'],
    maxSlope: 0.48,
    footprint: { radius: 0.46, sameKindDist: 1.15, rimMargin: HEX_PROP_EDGE_MARGIN_M },
  },
  bush: {
    id: 'bush',
    category: 'shrub',
    biomes: ['forestRock', 'oceanForest', 'dune'],
    allowedSubstrates: ['meadowTurf', 'forestFloor', 'uplandSlope', 'aridDune', 'desertWadi'],
    footprintSubstrates: ['meadowTurf', 'forestFloor', 'uplandSlope', 'aridDune', 'desertWadi', 'livingTurf'],
    maxSlope: 0.46,
    footprint: { radius: 0.48, sameKindDist: 1.05, rimMargin: HEX_PROP_EDGE_MARGIN_M },
  },
  wildflower: {
    id: 'wildflower',
    category: 'herb',
    biomes: ['forestRock', 'oceanForest'],
    allowedSubstrates: ['meadowTurf', 'forestFloor', 'livingTurf'],
    footprintSubstrates: ['meadowTurf', 'forestFloor', 'uplandSlope', 'livingTurf'],
    maxSlope: 0.46,
    footprint: { radius: 0.28, sameKindDist: 0.50, rimMargin: HEX_PROP_EDGE_MARGIN_M },
  },
  grassTuft: {
    id: 'grassTuft',
    category: 'herb',
    biomes: ['forestRock', 'oceanForest', 'dune'],
    allowedSubstrates: ['meadowTurf', 'forestFloor', 'uplandSlope', 'aridDune', 'desertWadi', 'livingTurf'],
    footprintSubstrates: ['meadowTurf', 'forestFloor', 'uplandSlope', 'aridDune', 'desertWadi', 'livingTurf'],
    maxSlope: 0.48,
    footprint: { radius: 0.26, sameKindDist: 0.46, rimMargin: HEX_PROP_EDGE_MARGIN_M },
  },
  reeds: {
    id: 'reeds',
    category: 'wetland',
    biomes: ['forestRock', 'oceanForest'],
    allowedSubstrates: ['littoralWetland'],
    footprintSubstrates: ['littoralWetland', 'submerged'],
    maxSlope: 0.42,
    minMoisture: 0.56,
    footprint: { radius: 0.34, sameKindDist: 0.72, rimMargin: HEX_PROP_EDGE_MARGIN_M },
  },
  boulder: {
    id: 'boulder',
    category: 'rock',
    biomes: ['forestRock', 'oceanForest', 'dune'],
    allowedSubstrates: ['rockOutcrop', 'uplandSlope', 'forestFloor', 'meadowTurf', 'desertWadi', 'aridDune'],
    maxSlope: 1.15,
    footprint: { radius: 0.52, sameKindDist: 0.85, rimMargin: HEX_PROP_EDGE_MARGIN_M },
  },
  spire: {
    id: 'spire',
    category: 'rock',
    biomes: ['forestRock', 'oceanForest', 'dune'],
    allowedSubstrates: ['rockOutcrop'],
    footprintSubstrates: ['rockOutcrop', 'uplandSlope', 'aridDune'],
    maxSlope: 1.60,
    footprint: { radius: 0.52, sameKindDist: 1.10, rimMargin: HEX_PROP_EDGE_MARGIN_M },
  },
  metals: {
    id: 'metals',
    category: 'deposit',
    biomes: ['forestRock', 'oceanForest', 'dune'],
    allowedSubstrates: ['depositPad'],
    maxSlope: 1.6,
    footprint: { radius: 0.55, sameKindDist: 0.68, rimMargin: HEX_PROP_EDGE_MARGIN_M },
  },
  minerals: {
    id: 'minerals',
    category: 'deposit',
    biomes: ['forestRock', 'oceanForest', 'dune'],
    allowedSubstrates: ['depositPad'],
    maxSlope: 1.6,
    footprint: { radius: 0.55, sameKindDist: 0.68, rimMargin: HEX_PROP_EDGE_MARGIN_M },
  },
  oil: {
    id: 'oil',
    category: 'deposit',
    biomes: ['forestRock', 'oceanForest', 'dune'],
    allowedSubstrates: ['depositPad'],
    maxSlope: 1.6,
    footprint: { radius: 0.55, sameKindDist: 0.68, rimMargin: HEX_PROP_EDGE_MARGIN_M },
  },
};
