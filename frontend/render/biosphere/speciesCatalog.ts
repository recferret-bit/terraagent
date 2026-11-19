import type { PlanetKind } from '../planets/PlanetSpec';
import type {
  AnimalScheduleState,
  BirdSpeciesSpec,
  CircadianSlot,
  LandAnimalSpeciesSpec,
} from './biosphereTypes';

export const BIRD_SPECIES_CATALOG: readonly BirdSpeciesSpec[] = [
  // ---- forestRock (5 endemic bird species) ----
  {
    id: 'fauna.bird.highlandHawk', label: 'Highland Red-Tail Hawk', biome: 'forestRock',
    pattern: 'thermalSoar', habitatPref: 'rock', flockSize: [2, 3], altitude: [12, 19],
    speed: 4.8, orbitRadius: 14, flapBase: 0.22, scale: 0.72,
  },
  {
    id: 'fauna.bird.pineCrossbill', label: 'Boreal Pine Crossbill', biome: 'forestRock',
    pattern: 'canopyOrbit', habitatPref: 'forest', flockSize: [6, 9], altitude: [5.5, 9.0],
    speed: 5.4, orbitRadius: 6.5, flapBase: 0.95, scale: 0.56,
  },
  {
    id: 'fauna.bird.alpineRaven', label: 'Alpine Slate Raven', biome: 'forestRock',
    pattern: 'figureEight', habitatPref: 'forest', flockSize: [3, 5], altitude: [8.5, 13.5],
    speed: 5.2, orbitRadius: 11, flapBase: 0.65, scale: 0.66,
  },
  {
    id: 'fauna.bird.mountainCrane', label: 'Crowned Mountain Crane', biome: 'forestRock',
    pattern: 'veeFormation', habitatPref: 'water', flockSize: [5, 7], altitude: [10.5, 15.0],
    speed: 5.8, orbitRadius: 22, flapBase: 0.78, scale: 0.76,
  },
  {
    id: 'fauna.bird.brookKingfisher', label: 'Cobalt Brook Kingfisher', biome: 'forestRock',
    pattern: 'waterSkim', habitatPref: 'water', flockSize: [3, 5], altitude: [2.8, 5.2],
    speed: 6.4, orbitRadius: 7.5, flapBase: 0.98, scale: 0.54,
  },

  // ---- oceanForest (5 endemic bird species) ----
  {
    id: 'fauna.bird.seaAlbatross', label: 'Great Pelagic Albatross', biome: 'oceanForest',
    pattern: 'thermalSoar', habitatPref: 'water', flockSize: [2, 4], altitude: [11, 17],
    speed: 5.5, orbitRadius: 16, flapBase: 0.18, scale: 0.78,
  },
  {
    id: 'fauna.bird.canopyToucan', label: 'Emerald-Billed Canopy Toucan', biome: 'oceanForest',
    pattern: 'canopyOrbit', habitatPref: 'forest', flockSize: [4, 7], altitude: [5.8, 9.2],
    speed: 4.9, orbitRadius: 7.0, flapBase: 0.88, scale: 0.64,
  },
  {
    id: 'fauna.bird.coralFlamingo', label: 'Coral Lagoon Flamingo', biome: 'oceanForest',
    pattern: 'veeFormation', habitatPref: 'water', flockSize: [5, 8], altitude: [8.5, 13.0],
    speed: 5.6, orbitRadius: 20, flapBase: 0.82, scale: 0.74,
  },
  {
    id: 'fauna.bird.reefTern', label: 'Silver-Capped Reef Tern', biome: 'oceanForest',
    pattern: 'waterSkim', habitatPref: 'water', flockSize: [5, 8], altitude: [2.6, 5.0],
    speed: 6.8, orbitRadius: 8.5, flapBase: 0.92, scale: 0.58,
  },
  {
    id: 'fauna.bird.stormFrigate', label: 'Crimson-Pouched Frigatebird', biome: 'oceanForest',
    pattern: 'ridgePatrol', habitatPref: 'open', flockSize: [3, 5], altitude: [13, 19],
    speed: 6.0, orbitRadius: 18, flapBase: 0.35, scale: 0.74,
  },

  // ---- dune (5 endemic bird species) ----
  {
    id: 'fauna.bird.duneVulture', label: 'Sun-Baked Griffon Vulture', biome: 'dune',
    pattern: 'thermalSoar', habitatPref: 'rock', flockSize: [3, 5], altitude: [12, 19],
    speed: 4.5, orbitRadius: 15, flapBase: 0.16, scale: 0.78,
  },
  {
    id: 'fauna.bird.oasisSwallow', label: 'Copper Oasis Swallow', biome: 'dune',
    pattern: 'canopyOrbit', habitatPref: 'forest', flockSize: [6, 9], altitude: [4.5, 8.0],
    speed: 6.6, orbitRadius: 6.8, flapBase: 0.96, scale: 0.54,
  },
  {
    id: 'fauna.bird.sandGrouse', label: 'Pin-Tailed Sandgrouse', biome: 'dune',
    pattern: 'veeFormation', habitatPref: 'open', flockSize: [5, 8], altitude: [7.5, 11.5],
    speed: 6.0, orbitRadius: 19, flapBase: 0.86, scale: 0.62,
  },
  {
    id: 'fauna.bird.canyonFalcon', label: 'Lanner Canyon Falcon', biome: 'dune',
    pattern: 'figureEight', habitatPref: 'rock', flockSize: [2, 4], altitude: [9.0, 14.5],
    speed: 7.0, orbitRadius: 12, flapBase: 0.72, scale: 0.66,
  },
  {
    id: 'fauna.bird.mirageIbis', label: 'Bronze Wadi Ibis', biome: 'dune',
    pattern: 'ridgePatrol', habitatPref: 'water', flockSize: [4, 7], altitude: [8.0, 12.5],
    speed: 5.3, orbitRadius: 16, flapBase: 0.80, scale: 0.70,
  },
] as const;

const DIURNAL_GRAZER_SCHEDULE: readonly CircadianSlot[] = [
  { fromHour: 0, toHour: 5.5, activity: 'SLEEPING' },
  { fromHour: 5.5, toHour: 8.0, activity: 'DRINKING' },
  { fromHour: 8.0, toHour: 12.5, activity: 'EATING_GRASS' },
  { fromHour: 12.5, toHour: 15.5, activity: 'ROAMING' },
  { fromHour: 15.5, toHour: 18.5, activity: 'EATING_GRASS' },
  { fromHour: 18.5, toHour: 20.5, activity: 'DRINKING' },
  { fromHour: 20.5, toHour: 24, activity: 'SLEEPING' },
];

const DIURNAL_BROWSER_SCHEDULE: readonly CircadianSlot[] = [
  { fromHour: 0, toHour: 6.0, activity: 'SLEEPING' },
  { fromHour: 6.0, toHour: 10.5, activity: 'BROWSING_TREES' },
  { fromHour: 10.5, toHour: 13.0, activity: 'DRINKING' },
  { fromHour: 13.0, toHour: 16.0, activity: 'ROAMING' },
  { fromHour: 16.0, toHour: 19.5, activity: 'BROWSING_TREES' },
  { fromHour: 19.5, toHour: 24, activity: 'SLEEPING' },
];

const CREPUSCULAR_PREDATOR_SCHEDULE: readonly CircadianSlot[] = [
  { fromHour: 0, toHour: 4.5, activity: 'HUNTING' },
  { fromHour: 4.5, toHour: 9.5, activity: 'ROAMING' },
  { fromHour: 9.5, toHour: 11.5, activity: 'DRINKING' },
  { fromHour: 11.5, toHour: 16.5, activity: 'SLEEPING' },
  { fromHour: 16.5, toHour: 19.0, activity: 'DRINKING' },
  { fromHour: 19.0, toHour: 24, activity: 'HUNTING' },
];

const DIURNAL_PREDATOR_SCHEDULE: readonly CircadianSlot[] = [
  { fromHour: 0, toHour: 5.5, activity: 'SLEEPING' },
  { fromHour: 5.5, toHour: 9.5, activity: 'HUNTING' },
  { fromHour: 9.5, toHour: 12.0, activity: 'DRINKING' },
  { fromHour: 12.0, toHour: 15.5, activity: 'ROAMING' },
  { fromHour: 15.5, toHour: 19.5, activity: 'HUNTING' },
  { fromHour: 19.5, toHour: 24, activity: 'SLEEPING' },
];

export const LAND_ANIMAL_SPECIES_CATALOG: readonly LandAnimalSpeciesSpec[] = [
  // ---- forestRock (4 endemic warm-blooded species) ----
  {
    id: 'fauna.timberWolf', label: 'Highland Timber Wolf', biome: 'forestRock',
    diet: 'predator', social: 'group', groupSize: [3, 5],
    walkSpeed: 2.3, runSpeed: 4.8, scale: 0.76, schedule: CREPUSCULAR_PREDATOR_SCHEDULE,
  },
  {
    id: 'fauna.crownStag', label: 'Boreal Crown Stag', biome: 'forestRock',
    diet: 'grassEater', social: 'group', groupSize: [4, 6],
    walkSpeed: 1.9, runSpeed: 4.6, scale: 0.84, schedule: DIURNAL_GRAZER_SCHEDULE,
  },
  {
    id: 'fauna.cragUrsine', label: 'Montane Crag Ursine', biome: 'forestRock',
    diet: 'predator', social: 'solo', groupSize: [1, 1],
    walkSpeed: 1.6, runSpeed: 3.8, scale: 0.92, schedule: DIURNAL_PREDATOR_SCHEDULE,
  },
  {
    id: 'fauna.meadowHare', label: 'Alpine Meadow Hare', biome: 'forestRock',
    diet: 'grassEater', social: 'group', groupSize: [4, 7],
    walkSpeed: 1.8, runSpeed: 5.2, scale: 0.68, schedule: DIURNAL_GRAZER_SCHEDULE,
  },

  // ---- oceanForest (4 endemic warm-blooded species) ----
  {
    id: 'fauna.canopyPanther', label: 'Emerald Canopy Panther', biome: 'oceanForest',
    diet: 'predator', social: 'solo', groupSize: [1, 1],
    walkSpeed: 2.2, runSpeed: 5.0, scale: 0.80, schedule: CREPUSCULAR_PREDATOR_SCHEDULE,
  },
  {
    id: 'fauna.reefTapir', label: 'Archipelago Saddleback Tapir', biome: 'oceanForest',
    diet: 'treeBrowser', social: 'group', groupSize: [2, 4],
    walkSpeed: 1.6, runSpeed: 3.8, scale: 0.82, schedule: DIURNAL_BROWSER_SCHEDULE,
  },
  {
    id: 'fauna.lagoonCapybara', label: 'Lagoon Giant Capybara', biome: 'oceanForest',
    diet: 'grassEater', social: 'group', groupSize: [4, 7],
    walkSpeed: 1.5, runSpeed: 3.6, scale: 0.76, schedule: DIURNAL_GRAZER_SCHEDULE,
  },
  {
    id: 'fauna.islandLemur', label: 'Ring-Tailed Canopy Lemur', biome: 'oceanForest',
    diet: 'treeBrowser', social: 'group', groupSize: [4, 6],
    walkSpeed: 2.0, runSpeed: 4.4, scale: 0.72, schedule: DIURNAL_BROWSER_SCHEDULE,
  },

  // ---- dune (4 endemic warm-blooded species) ----
  {
    id: 'fauna.duneJackal', label: 'Golden Dune Jackal', biome: 'dune',
    diet: 'predator', social: 'group', groupSize: [3, 5],
    walkSpeed: 2.4, runSpeed: 5.0, scale: 0.74, schedule: CREPUSCULAR_PREDATOR_SCHEDULE,
  },
  {
    id: 'fauna.saberOryx', label: 'White Saber Oryx', biome: 'dune',
    diet: 'treeBrowser', social: 'group', groupSize: [4, 6],
    walkSpeed: 2.0, runSpeed: 4.9, scale: 0.84, schedule: DIURNAL_BROWSER_SCHEDULE,
  },
  {
    id: 'fauna.mesaCaracal', label: 'Red Mesa Caracal', biome: 'dune',
    diet: 'predator', social: 'solo', groupSize: [1, 1],
    walkSpeed: 2.2, runSpeed: 5.1, scale: 0.76, schedule: CREPUSCULAR_PREDATOR_SCHEDULE,
  },
  {
    id: 'fauna.oasisCamelid', label: 'Oasis Dromedary Camelid', biome: 'dune',
    diet: 'treeBrowser', social: 'group', groupSize: [3, 5],
    walkSpeed: 1.7, runSpeed: 4.1, scale: 0.90, schedule: DIURNAL_BROWSER_SCHEDULE,
  },
] as const;

export const BIRDS_BY_BIOME: Readonly<Record<PlanetKind, readonly BirdSpeciesSpec[]>> = {
  forestRock: BIRD_SPECIES_CATALOG.filter((s) => s.biome === 'forestRock'),
  oceanForest: BIRD_SPECIES_CATALOG.filter((s) => s.biome === 'oceanForest'),
  dune: BIRD_SPECIES_CATALOG.filter((s) => s.biome === 'dune'),
};

export const LAND_ANIMALS_BY_BIOME: Readonly<Record<PlanetKind, readonly LandAnimalSpeciesSpec[]>> = {
  forestRock: LAND_ANIMAL_SPECIES_CATALOG.filter((s) => s.biome === 'forestRock'),
  oceanForest: LAND_ANIMAL_SPECIES_CATALOG.filter((s) => s.biome === 'oceanForest'),
  dune: LAND_ANIMAL_SPECIES_CATALOG.filter((s) => s.biome === 'dune'),
};

export function resolveCircadianActivity(
  spec: LandAnimalSpeciesSpec,
  solarHour24: number,
): Exclude<AnimalScheduleState, 'FLEEING_PREDATOR' | 'FLEEING_AGGRESSOR'> {
  const h = ((solarHour24 % 24) + 24) % 24;
  for (const slot of spec.schedule) {
    if (h >= slot.fromHour && h < slot.toHour) return slot.activity;
  }
  return spec.schedule[0]?.activity ?? 'ROAMING';
}

/** Vertebrates (birds, fish, warm-blooded mammals) NEVER attack player units or structures. */
export function canBiosphereFaunaAttackPlayer(_archetypeId: string): false {
  return false;
}
