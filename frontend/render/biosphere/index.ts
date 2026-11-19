export {
  createPlanetBiosphere,
  type CreatePlanetBiosphereOptions,
} from './PlanetBiosphere';
export { BirdFlockSimulator } from './BirdFlockSim';
export { LandAnimalSimulator } from './LandAnimalSim';
export {
  buildContinuousHabitatIndex,
  buildHexHabitatIndex,
} from './habitatIndex';
export {
  BIRD_SPECIES_CATALOG,
  BIRDS_BY_BIOME,
  canBiosphereFaunaAttackPlayer,
  LAND_ANIMAL_SPECIES_CATALOG,
  LAND_ANIMALS_BY_BIOME,
  resolveCircadianActivity,
} from './speciesCatalog';
export type {
  AnimalDiet,
  AnimalScheduleState,
  AnimalSocial,
  AvianFlightPattern,
  BiosphereAggressor,
  BiosphereBattleHotspot,
  BiosphereCounts,
  BiosphereHabitatIndex,
  BirdFlock,
  BirdFlockState,
  BirdHabitatPref,
  BirdMemberState,
  BirdSpeciesSpec,
  CircadianSlot,
  HabitatAnchor,
  LandAnimalAgent,
  LandAnimalSpeciesSpec,
  PlanetBiosphere,
} from './biosphereTypes';
