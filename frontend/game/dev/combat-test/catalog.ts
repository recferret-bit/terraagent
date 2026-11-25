import type { PlanetKind } from '@terra/render/planets/PlanetSpec';
import { DEV_PLANET_RADIUS, type DevPlanetType } from '@terra/sim';

export interface CombatTestMapSpec {
  readonly kind: PlanetKind;
  readonly biome: DevPlanetType;
  readonly label: string;
  readonly shortLabel: string;
  readonly subtitle: string;
  readonly defaultSeed: string;
  readonly radius: number;
}

export interface CombatSpawnPreset {
  readonly id: string;
  readonly label: string;
  readonly shortCode: string;
  readonly category: 'battle-unit' | 'support-unit' | 'battle-building' | 'support-building' | 'insect' | 'hive';
  readonly commandKind: 'dev.spawnunit' | 'dev.spawnbuilding' | 'dev.spawnhive';
  readonly hint: string;
}

export const COMBAT_TEST_MAP_SPECS: readonly CombatTestMapSpec[] = [
  {
    kind: 'dune',
    biome: 'desert',
    label: 'Kharon Dunes',
    shortLabel: 'DESERT',
    subtitle: 'Arid dunes & mesas · Solar-rich · 56-tile radius',
    defaultSeed: 'combat-test-desert',
    radius: DEV_PLANET_RADIUS,
  },
  {
    kind: 'oceanForest',
    biome: 'ocean',
    label: 'Thalassa Verde',
    shortLabel: 'OCEAN',
    subtitle: 'Island chains & dense woods · Hydro terrain · 56-tile radius',
    defaultSeed: 'combat-test-ocean',
    radius: DEV_PLANET_RADIUS,
  },
  {
    kind: 'forestRock',
    biome: 'temperate',
    label: 'Granite Hollow',
    shortLabel: 'TEMPERATE',
    subtitle: 'Pine highlands & granite cliffs · Balanced · 56-tile radius',
    defaultSeed: 'combat-test-temperate',
    radius: DEV_PLANET_RADIUS,
  },
];

export const COMBAT_SPAWN_PRESETS: readonly CombatSpawnPreset[] = [
  // Battle units
  { id: 'recon', label: 'Recon Scout', shortCode: 'RCN', category: 'battle-unit', commandKind: 'dev.spawnunit', hint: 'Fast kinetic armored scout' },
  { id: 'demoTank', label: 'Assault Tank', shortCode: 'TNK', category: 'battle-unit', commandKind: 'dev.spawnunit', hint: 'Heavy rocket spider walker' },
  { id: 'demoArtillery', label: 'Mobile Artillery', shortCode: 'ART', category: 'battle-unit', commandKind: 'dev.spawnunit', hint: 'Long-range AoE indirect shell (min range 3)' },
  // Utility/support bots (optional combat support, no HQ needed)
  { id: 'worker', label: 'Harvester Bot', shortCode: 'HAR', category: 'support-unit', commandKind: 'dev.spawnunit', hint: 'Resource gatherer' },
  { id: 'builder', label: 'Builder Bot', shortCode: 'BLD', category: 'support-unit', commandKind: 'dev.spawnunit', hint: 'Field engineer / repair unit' },
  // Battle buildings
  { id: 'autocannon', label: 'Autocannon Turret', shortCode: 'ACN', category: 'battle-building', commandKind: 'dev.spawnbuilding', hint: '1x1 kinetic defense turret (immediately active)' },
  { id: 'laserTower', label: 'Laser Tower', shortCode: 'LSR', category: 'battle-building', commandKind: 'dev.spawnbuilding', hint: '1x1 high-energy precision laser defense' },
  { id: 'roboticsFactory', label: 'Robotics Factory', shortCode: 'FAC', category: 'battle-building', commandKind: 'dev.spawnbuilding', hint: '3x3 combat unit factory (can queue Recons)' },
  { id: 'droneControlArray', label: 'Drone Control Array', shortCode: 'DCA', category: 'battle-building', commandKind: 'dev.spawnbuilding', hint: '1x1 combat command & supply support array' },
  { id: 'sensorArray', label: 'Sensor Array', shortCode: 'SNS', category: 'battle-building', commandKind: 'dev.spawnbuilding', hint: '2x2 long-range radar & targeting sensor' },
  // Support buildings
  { id: 'pylon', label: 'Power Pylon', shortCode: 'PYL', category: 'support-building', commandKind: 'dev.spawnbuilding', hint: '1x1 grid relay node' },
  { id: 'supplyDepot', label: 'Supply Depot', shortCode: 'DEP', category: 'support-building', commandKind: 'dev.spawnbuilding', hint: '2x2 unit supply & storage cap' },
  // Insects & hives
  { id: 'blackAnt', label: 'Black Ant', shortCode: 'ANT', category: 'insect', commandKind: 'dev.spawnunit', hint: 'Fast melee swarm insect' },
  { id: 'blueBeetle', label: 'Armored Beetle', shortCode: 'BTL', category: 'insect', commandKind: 'dev.spawnunit', hint: 'Heavy chitin melee insect' },
  { id: 'greenSpitter', label: 'Acid Spitter', shortCode: 'SPT', category: 'insect', commandKind: 'dev.spawnunit', hint: 'Ranged corrosive projectile insect' },
  { id: 'hiveBlackAnt', label: 'Ant Hive', shortCode: 'H-A', category: 'hive', commandKind: 'dev.spawnhive', hint: '3x3 Black Ant nest with resident brood' },
  { id: 'hiveBlueBeetle', label: 'Beetle Hive', shortCode: 'H-B', category: 'hive', commandKind: 'dev.spawnhive', hint: '3x3 Armored Beetle nest with resident brood' },
  { id: 'hiveGreenSpitter', label: 'Spitter Hive', shortCode: 'H-S', category: 'hive', commandKind: 'dev.spawnhive', hint: '3x3 Acid Spitter nest with resident brood' },
];

export interface ParsedCombatTestParams {
  readonly spec: CombatTestMapSpec;
  readonly seed: string;
  readonly botCount: number;
  readonly waves: string | null;
}

export function resolveCombatTestMapSpec(raw?: string | null): CombatTestMapSpec {
  const key = (raw ?? '').trim().toLowerCase();
  if (key === 'dune' || key === 'desert') return COMBAT_TEST_MAP_SPECS[0]!;
  if (key === 'oceanforest' || key === 'ocean') return COMBAT_TEST_MAP_SPECS[1]!;
  return COMBAT_TEST_MAP_SPECS[2]!;
}

export function parseCombatTestUrlParams(search: string): ParsedCombatTestParams {
  const q = new URLSearchParams(search);
  const spec = resolveCombatTestMapSpec(q.get('biome') ?? q.get('planet'));
  const rawSeed = q.get('seed')?.trim();
  const rawBots = Number(q.get('bots') ?? '3');
  const botCount = Number.isFinite(rawBots) ? Math.max(1, Math.min(5, Math.floor(rawBots))) : 3;
  const rawWaves = q.get('waves')?.trim() ?? null;
  return {
    spec,
    seed: rawSeed && rawSeed.length > 0 ? rawSeed : spec.defaultSeed,
    botCount,
    waves: rawWaves && rawWaves.length > 0 ? rawWaves : null,
  };
}

export function buildCombatTestSearch(opts: { biome: PlanetKind | DevPlanetType; seed?: string; botCount?: number }): string {
  const spec = resolveCombatTestMapSpec(opts.biome);
  const q = new URLSearchParams();
  q.set('biome', spec.kind);
  if (opts.seed && opts.seed.trim() && opts.seed.trim() !== spec.defaultSeed) q.set('seed', opts.seed.trim());
  if (opts.botCount && opts.botCount !== 3) q.set('bots', String(Math.max(1, Math.min(5, Math.floor(opts.botCount)))));
  return `?${q.toString()}`;
}

export function hiveSpeciesForPresetId(presetId: string): 'blackAnt' | 'blueBeetle' | 'greenSpitter' {
  if (presetId === 'hiveBlueBeetle') return 'blueBeetle';
  if (presetId === 'hiveGreenSpitter') return 'greenSpitter';
  return 'blackAnt';
}
