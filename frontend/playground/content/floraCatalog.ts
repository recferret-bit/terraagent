import * as THREE from 'three';
import { PLANET_SPECS, type PlanetKind } from '@terra/render/planets/PlanetSpec';
import {
  createFoliageMaterial,
  createRockMaterial,
  makeBoulderGeo,
  makeSpireGeo,
} from '@terra/render/visuals/terrain/Scatter';
import {
  makeBarrelCactusGeo,
  makeBushGeo,
  makeGrassTuftGeo,
  makeSaguaroCactusGeo,
  makeShoreReedsGeo,
  makeWildflowerGeo,
} from '@terra/render/visuals/terrain/groundFloraGeos';
import { TREE_BREEDS, buildTreeBreedGeo, type TreeBreedId } from '@terra/render/visuals/terrain/treeBreeds';

export type FloraGroup = 'tree' | 'ground';

export interface FloraEntry {
  id: string;
  label: string;
  group: FloraGroup;
  biomeHint: PlanetKind | 'all';
  subtitle: string;
  description: string;
  sway: number;
  doubleSided?: boolean;
  isRock?: boolean;
  embeddedSkirt?: boolean;
  breedId?: TreeBreedId;
}

export interface FloraMeshBuild {
  mesh: THREE.Mesh;
  timeU: { value: number };
  dispose: () => void;
}

export interface FloraStats {
  tris: number;
  verts: number;
  size: THREE.Vector3;
  minY: number;
  attrs: string[];
  groundedOk: boolean;
  plantedSkirt: boolean;
}

const GROUND_ENTRIES: readonly FloraEntry[] = [
  {
    id: 'flora.ground.grassTuft',
    label: 'Grass Tuft',
    group: 'ground',
    biomeHint: 'all',
    subtitle: 'Biome-adaptive 7-blade 3D cluster',
    description: 'Seven curved 3D triangular-prism grass blades tinted to the active biome palette with wind sway.',
    sway: 0.85,
    doubleSided: true,
    embeddedSkirt: true,
  },
  {
    id: 'flora.ground.wildflower',
    label: 'Wildflower & Fern Clump',
    group: 'ground',
    biomeHint: 'all',
    subtitle: 'Biome-adaptive rosette + blossoms',
    description: 'Low-poly 3D fern fronds and multi-petal wildflower stalks adapted to highland, archipelago, or arid meadows.',
    sway: 0.95,
    doubleSided: true,
    embeddedSkirt: true,
  },
  {
    id: 'flora.ground.bush',
    label: 'Berry & Scrub Bush',
    group: 'ground',
    biomeHint: 'all',
    subtitle: 'Biome-adaptive woody shrub',
    description: 'Multi-lobe low-poly foliage shrub with woody basal stems and biome-keyed seasonal berries.',
    sway: 0.50,
  },
  {
    id: 'flora.ground.saguaro',
    label: 'Saguaro Cactus',
    group: 'ground',
    biomeHint: 'dune',
    subtitle: 'Arid branched column + crown bloom',
    description: 'Ribbed desert saguaro column with asymmetric curved arms and a crowned golden blossom.',
    sway: 0.12,
    embeddedSkirt: true,
  },
  {
    id: 'flora.ground.barrelCactus',
    label: 'Barrel & Prickly-Pear',
    group: 'ground',
    biomeHint: 'dune',
    subtitle: 'Desert ovoid ribs + cladode pads',
    description: 'Clustered barrel cactus mound flanked by ribbed pups and angled prickly-pear cladodes.',
    sway: 0.10,
    embeddedSkirt: true,
  },
  {
    id: 'flora.ground.reeds',
    label: 'Shoreline Cattail Reeds',
    group: 'ground',
    biomeHint: 'oceanForest',
    subtitle: 'Wetland / littoral margin stalks',
    description: 'Tall waterfront reed stalks and velvety brown cattail heads placed along shallow lakes and lagoons.',
    sway: 1.10,
    doubleSided: true,
    embeddedSkirt: true,
  },
  {
    id: 'flora.ground.boulder',
    label: 'Faceted Boulder Rock',
    group: 'ground',
    biomeHint: 'all',
    subtitle: 'Biome rock scatter outcrop',
    description: 'Noise-faceted basalt/sandstone boulder with deep embedded terrain skirt and tri-tone rock shading.',
    sway: 0,
    isRock: true,
    embeddedSkirt: true,
  },
  {
    id: 'flora.ground.spire',
    label: 'Rock Spire Shard',
    group: 'ground',
    biomeHint: 'all',
    subtitle: 'Tapering hexagonal rock crag',
    description: 'Kinked hexagonal ridge spire providing vertical geological landmarks and rocky outcrop variation.',
    sway: 0,
    isRock: true,
    embeddedSkirt: true,
  },
];

const TREE_ENTRIES: readonly FloraEntry[] = TREE_BREEDS.map((b) => ({
  id: `flora.tree.${b.id}`,
  label: b.label,
  group: 'tree',
  biomeHint: b.biome,
  subtitle: `${b.canopyShape} · ${b.moisturePref} · wind ×${b.windCompliance.toFixed(2)}`,
  description: `Procedural stemless tree breed (${b.canopyShape} silhouette, ${b.moisturePref} moisture niche) native to ${b.biome}.`,
  sway: b.windCompliance,
  doubleSided: b.canopyShape === 'palmCrown' || b.canopyShape === 'pendulous',
  embeddedSkirt: true,
  breedId: b.id,
}));

export const FLORA_ENTRIES: readonly FloraEntry[] = [...TREE_ENTRIES, ...GROUND_ENTRIES];
const FLORA_MAP = new Map(FLORA_ENTRIES.map((e) => [e.id, e]));

export function isFloraId(id: string): boolean {
  return id.startsWith('flora.') && FLORA_MAP.has(id);
}

export function getFloraEntry(id: string): FloraEntry | undefined {
  return FLORA_MAP.get(id);
}

export function listFloraEntries(group?: FloraGroup): readonly FloraEntry[] {
  if (!group) return FLORA_ENTRIES;
  return FLORA_ENTRIES.filter((e) => e.group === group);
}

function buildFloraGeometry(entry: FloraEntry, biome: PlanetKind, seed: number): THREE.BufferGeometry {
  if (entry.breedId) return buildTreeBreedGeo(entry.breedId, seed);
  const rockTint = new THREE.Color(PLANET_SPECS[biome].palette.rock).lerp(
    new THREE.Color(PLANET_SPECS[biome].palette.rockDark),
    0.25,
  );
  switch (entry.id) {
    case 'flora.ground.grassTuft': return makeGrassTuftGeo(biome, seed);
    case 'flora.ground.wildflower': return makeWildflowerGeo(biome, seed);
    case 'flora.ground.bush': return makeBushGeo(biome, seed);
    case 'flora.ground.saguaro': return makeSaguaroCactusGeo(seed);
    case 'flora.ground.barrelCactus': return makeBarrelCactusGeo(seed);
    case 'flora.ground.reeds': return makeShoreReedsGeo(seed);
    case 'flora.ground.boulder': return makeBoulderGeo(seed, rockTint);
    case 'flora.ground.spire': return makeSpireGeo(seed, rockTint);
    default: return makeBushGeo(biome, seed);
  }
}

/** Instantiates a live wind-animated foliage or rock mesh matching planetary scatter shaders. */
export function createFloraMesh(id: string, biome: PlanetKind, seed = 17): FloraMeshBuild {
  const entry = getFloraEntry(id);
  if (!entry) throw new Error(`Unknown flora entry: ${id}`);
  const timeU = { value: 0 };
  const geo = buildFloraGeometry(entry, biome, seed);
  geo.computeBoundingBox();
  const mat = entry.isRock
    ? createRockMaterial({ rough: 0.9, flat: true })
    : createFoliageMaterial(timeU, entry.sway, Boolean(entry.doubleSided), false);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = entry.id;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return {
    mesh,
    timeU,
    dispose: () => {
      geo.dispose();
      mat.dispose();
    },
  };
}

export function floraStats(entry: FloraEntry, mesh?: THREE.Mesh): FloraStats {
  const geo = mesh ? mesh.geometry : buildFloraGeometry(entry, entry.biomeHint === 'all' ? 'forestRock' : entry.biomeHint, 17);
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const verts = geo.attributes.position.count;
  const tris = geo.index ? geo.index.count / 3 : verts / 3;
  const minY = bb.min.y;
  const size = bb.getSize(new THREE.Vector3());
  const attrs = Object.keys(geo.attributes);
  const plantedSkirt = minY < -0.025 && Boolean(entry.embeddedSkirt);
  const groundedOk = plantedSkirt || Math.abs(minY) <= 0.06;
  if (!mesh) geo.dispose();
  return { tris: Math.round(tris), verts, size, minY, attrs, groundedOk, plantedSkirt };
}
