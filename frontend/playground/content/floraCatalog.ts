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
  type GroundVariantIndex,
} from '@terra/render/visuals/terrain/groundFloraGeos';
import { TREE_BREEDS, buildTreeBreedGeo, type TreeBreedId } from '@terra/render/visuals/terrain/treeBreeds';

export type FloraGroup = 'tree' | 'ground';
export type GroundObjectFamily =
  | 'grassTuft'
  | 'wildflower'
  | 'bush'
  | 'saguaro'
  | 'barrelCactus'
  | 'reeds'
  | 'boulder'
  | 'spire';

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
  groundKind?: GroundObjectFamily;
  variantIndex?: GroundVariantIndex;
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

interface GroundFamilyConfig {
  readonly kind: GroundObjectFamily;
  readonly biomeHint: PlanetKind | 'all';
  readonly sway: number;
  readonly doubleSided?: boolean;
  readonly isRock?: boolean;
  readonly variants: readonly {
    readonly slug?: string;
    readonly label: string;
    readonly subtitle: string;
    readonly description: string;
  }[];
}

const GROUND_FAMILY_TABLE: readonly GroundFamilyConfig[] = [
  {
    kind: 'grassTuft',
    biomeHint: 'all',
    sway: 0.85,
    doubleSided: true,
    variants: [
      { label: 'Grass Tuft', subtitle: '7-blade 3D cluster', description: 'Seven curved 3D triangular-prism grass blades tinted to the active biome palette with wind sway.' },
      { slug: 'sedge', label: 'Upright Sedge Plumes', subtitle: 'Tall blades with seed plumes', description: 'Tall upright sedge blades crowned with three slender seed-head plumes.' },
      { slug: 'fescue', label: 'Arching Fescue Tuft', subtitle: 'Low sweeping meadow rosette', description: 'Wide arching meadow fescue blades radiating low across open turf.' },
      { slug: 'tussock', label: 'Dense Tussock Mound', subtitle: '11-blade mounded ring grass', description: 'Dense eleven-blade tussock clump rooted around a central basal mound.' },
      { slug: 'plumeGrass', label: 'Windswept Plume Grass', subtitle: 'Directional blades & panicles', description: 'Wind-bent grass cluster topped with directional flowering panicles.' },
    ],
  },
  {
    kind: 'wildflower',
    biomeHint: 'all',
    sway: 0.95,
    doubleSided: true,
    variants: [
      { label: 'Wildflower & Fern Clump', subtitle: 'Fern rosette + tri-blossoms', description: 'Low-poly 3D fern fronds and multi-petal wildflower stalks adapted to the active biome.' },
      { slug: 'foxglove', label: 'Tiered Foxglove Spikes', subtitle: 'Stacked blossom whorls', description: 'Three tall foxglove stalks carrying stacked blossom whorls over basal leaves.' },
      { slug: 'daisy', label: 'Meadow Aster Bouquet', subtitle: '5-head broadleaf daisy patch', description: 'Compact five-flower daisy cluster nestled into a low broadleaf rosette.' },
      { slug: 'bellflower', label: 'Arching Bellflower', subtitle: 'Hanging cup blooms + fronds', description: 'Four gracefully arching stems carrying inverted cup bellflowers above fern fronds.' },
      { slug: 'rosette', label: 'Star Rosette Bloom', subtitle: '8-leaf rosette & star crown', description: 'Eight-leaf succulent meadow rosette crowned by a central star bloom and twin side buds.' },
    ],
  },
  {
    kind: 'bush',
    biomeHint: 'all',
    sway: 0.50,
    variants: [
      { label: 'Berry & Scrub Bush', subtitle: 'Multi-lobe shrub with berries', description: 'Multi-lobe low-poly foliage shrub with woody basal stems and biome-keyed seasonal berries.' },
      { slug: 'bramble', label: 'Sprawling Bramble Thicket', subtitle: 'Low 6-lobe thicket & berries', description: 'Broad low-growing six-lobe bramble thicket studded with wild berry clusters.' },
      { slug: 'juniper', label: 'Conical Scrub Juniper', subtitle: '3-tier upright evergreen scrub', description: 'Three-tier upright conical juniper scrub rising from a single woody basal stem.' },
      { slug: 'sagebrush', label: 'Windswept Sagebrush', subtitle: 'Gnarled stems & flat pads', description: 'Forked woody sagebrush carrying five flattened wind-sculpted foliage pads.' },
      { slug: 'flowering', label: 'Flowering Hedgerow', subtitle: '5-dome shrub with blossoms', description: 'Dense five-dome hedgerow shrub bursting with six bright seasonal blossom clusters.' },
    ],
  },
  {
    kind: 'saguaro',
    biomeHint: 'dune',
    sway: 0.12,
    variants: [
      { label: 'Saguaro Cactus', subtitle: 'Classic 2-arm column + bloom', description: 'Ribbed desert saguaro column with asymmetric curved arms and a crowned golden blossom.' },
      { slug: 'candelabra', label: 'Candelabra Saguaro', subtitle: 'Monarch 4-arm desert giant', description: 'Ancient four-armed candelabra saguaro bearing staggered branches and twin blooms.' },
      { slug: 'organPipe', label: 'Organ-Pipe Cactus', subtitle: '5-column curved desert cluster', description: 'Five graduated ribbed cactus columns curving outward from a shared root crown.' },
      { slug: 'sentinel', label: 'Sentinel Saguaro', subtitle: 'Tall crook column + basal pup', description: 'Tall solitary desert column with a single high crook arm and companion basal pup.' },
      { slug: 'cardon', label: 'Cardon Cactus', subtitle: 'Low-forked 3-stem giant', description: 'Heavy low-forking desert cactus splitting above the base into three parallel columns.' },
    ],
  },
  {
    kind: 'barrelCactus',
    biomeHint: 'dune',
    sway: 0.10,
    variants: [
      { label: 'Barrel & Prickly-Pear', subtitle: 'Barrel mound + pup + cladode', description: 'Clustered barrel cactus mound flanked by ribbed pups and angled prickly-pear cladodes.' },
      { slug: 'pricklyPear', label: 'Prickly-Pear Thicket', subtitle: '6-pad opuntia + rim fruit', description: 'Branching opuntia thicket of six interlocking oval cladode pads crowned with red fruit.' },
      { slug: 'goldenCluster', label: 'Golden Barrel Cluster', subtitle: '5-dome hummock + flowers', description: 'Mounded five-dome cluster of spherical golden barrel cacti topped with orange flowers.' },
      { slug: 'cholla', label: 'Teddy-Bear Cholla', subtitle: 'Jointed branching desert scrub', description: 'Branching jointed cholla cactus shrub with four cylindrical arms and golden buds.' },
      { slug: 'agave', label: 'Desert Agave Rosette', subtitle: '10-blade succulent + spike', description: 'Ten pointed desert agave blades radiating around a tall central flowering spike.' },
    ],
  },
  {
    kind: 'reeds',
    biomeHint: 'oceanForest',
    sway: 1.10,
    doubleSided: true,
    variants: [
      { label: 'Shoreline Cattail Reeds', subtitle: '6-stalk cattail & heads', description: 'Tall waterfront reed stalks and velvety brown cattail heads placed along shallow coves.' },
      { slug: 'papyrus', label: 'Lagoon Papyrus Reeds', subtitle: 'Tall stalks + bract crowns', description: 'Slender lagoon stalks crowned with radiating green papyrus umbel bracts.' },
      { slug: 'bulrush', label: 'Marsh Bulrush Clump', subtitle: '9-stalk dense wetland clump', description: 'Dense nine-stalk wetland bulrush clump topped with tapering brown seed spikes.' },
      { slug: 'horsetail', label: 'Segmented Horsetail', subtitle: 'Jointed reed stems + cones', description: 'Seven segmented marsh horsetail stems with dark node rings and terminal cones.' },
      { slug: 'waterIris', label: 'Water-Iris Margin', subtitle: 'Sword blades & flag blooms', description: 'Sword-like littoral iris blades framing three tall violet-blue flag blossoms.' },
    ],
  },
  {
    kind: 'boulder',
    biomeHint: 'all',
    sway: 0,
    isRock: true,
    variants: [
      { label: 'Faceted Boulder Rock', subtitle: 'Noise-faceted outcrop rock', description: 'Noise-faceted basalt/sandstone boulder with deep embedded terrain skirt.' },
      { slug: 'slab', label: 'Tilted Rock Slab', subtitle: 'Tabular stone & basal ledge', description: 'Tilted tabular stone slab resting on a stepped secondary basal rock ledge.' },
      { slug: 'erratic', label: 'Split Erratic Boulder', subtitle: 'Twin-cleft faceted rock', description: 'Twin-cleft glacial erratic split into two interlocking angular rock masses.' },
      { slug: 'mesa', label: 'Layered Mesa Block', subtitle: '3-strata sedimentary shelf', description: 'Terraced three-tier sedimentary rock outcrop with flat-topped weathered shelves.' },
      { slug: 'talus', label: 'Talus Boulder Cluster', subtitle: 'Crag with companion stones', description: 'Primary angular rock outcrop flanked by two embedded companion talus stones.' },
    ],
  },
  {
    kind: 'spire',
    biomeHint: 'all',
    sway: 0,
    isRock: true,
    variants: [
      { label: 'Rock Spire Shard', subtitle: 'Tapering hexagonal crag', description: 'Kinked hexagonal ridge spire providing vertical geological landmarks.' },
      { slug: 'twinObelisk', label: 'Twin Basalt Obelisk', subtitle: 'Paired leaning rock shards', description: 'Unequal pair of leaning hexagonal basalt shards rising from a shared outcrop.' },
      { slug: 'hoodoo', label: 'Weathered Hoodoo Rock', subtitle: 'Narrow neck + caprock crown', description: 'Eroded desert/highland hoodoo pillar balancing a wider faceted caprock crown.' },
      { slug: 'curvedFang', label: 'Curved Ridge Fang', subtitle: 'Swept monolithic rock horn', description: 'Swept curved monolithic rock horn tapering sharply to an angled apex.' },
      { slug: 'columnar', label: 'Columnar Basalt Pillars', subtitle: '3-step hexagonal columns', description: 'Trio of stepped hexagonal columnar-basalt pillars emerging from bedrock.' },
    ],
  },
];

const GROUND_ENTRIES: readonly FloraEntry[] = GROUND_FAMILY_TABLE.flatMap((fam) =>
  fam.variants.map((v, idx) => ({
    id: v.slug ? `flora.ground.${fam.kind}.${v.slug}` : `flora.ground.${fam.kind}`,
    label: v.label,
    group: 'ground' as const,
    biomeHint: fam.biomeHint,
    subtitle: v.subtitle,
    description: v.description,
    sway: fam.sway,
    ...(fam.doubleSided ? { doubleSided: true } : {}),
    ...(fam.isRock ? { isRock: true } : {}),
    embeddedSkirt: true,
    groundKind: fam.kind,
    variantIndex: idx as GroundVariantIndex,
  })),
);

const TREE_ENTRIES: readonly FloraEntry[] = TREE_BREEDS.map((b) => ({
  id: `flora.tree.${b.id}`,
  label: b.label,
  group: 'tree',
  biomeHint: b.biome,
  subtitle: `${b.canopyShape} · ${b.moisturePref} · wind ×${b.windCompliance.toFixed(2)}`,
  description: `Procedural stemmed tree breed (${b.canopyShape} silhouette, ${b.moisturePref} moisture niche, woody aBark stem) native to ${b.biome}.`,
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
  const v = entry.variantIndex ?? 0;
  const rockTint = new THREE.Color(PLANET_SPECS[biome].palette.rock).lerp(
    new THREE.Color(PLANET_SPECS[biome].palette.rockDark),
    0.25,
  );
  switch (entry.groundKind) {
    case 'grassTuft': return makeGrassTuftGeo(biome, seed, v);
    case 'wildflower': return makeWildflowerGeo(biome, seed, v);
    case 'bush': return makeBushGeo(biome, seed, v);
    case 'saguaro': return makeSaguaroCactusGeo(seed, v);
    case 'barrelCactus': return makeBarrelCactusGeo(seed, v);
    case 'reeds': return makeShoreReedsGeo(seed, v);
    case 'boulder': return makeBoulderGeo(seed, rockTint, v);
    case 'spire': return makeSpireGeo(seed, rockTint, v);
    default: return makeBushGeo(biome, seed, v);
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
