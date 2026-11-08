import { defineTable, type Row } from './_define';

export interface StageRow extends Row {
  readonly id: string;
  readonly stage: number;
  readonly wave: 'W08' | 'W17' | 'W19';
  readonly name: string;
  readonly label: string;
  readonly triggerKind: string;
  readonly triggerText: string;
  readonly unlockConditionText: string;
  readonly dwellS: number;
  readonly designDwellS: number;
  readonly targetTimeS: number;
  readonly teaches: string;
  readonly units: readonly string[];
  readonly buildings: readonly string[];
  readonly orders: readonly string[];
  readonly suggestedGoal: string;
  readonly gatingBuilding: string;
}

export const STAGE_TABLE_ROWS: readonly StageRow[] = [
  {
    id: 'S0',
    stage: 0,
    wave: 'W08',
    name: 'Landing',
    label: 'S0 Landing',
    triggerKind: 'landed',
    triggerText: 'Pod touches down',
    unlockConditionText: 'Pod touches down',
    dwellS: 0,
    designDwellS: 0,
    targetTimeS: 120,
    teaches: 'Prepare ground, then build',
    units: ['hq'],
    buildings: ['commandHub'],
    orders: ['grade', 'clear', 'break'],
    suggestedGoal: 'establish_colony',
    gatingBuilding: '',
  },
  {
    id: 'S1',
    stage: 1,
    wave: 'W08',
    name: 'First Light',
    label: 'S1 First Light',
    triggerKind: 'hub_complete',
    triggerText: 'Command Hub T1 complete',
    unlockConditionText: 'Command Hub T1 complete · 1 min',
    dwellS: 60,
    designDwellS: 60,
    targetTimeS: 360,
    teaches: 'Resources flow, and everything costs energy, terraforming included',
    units: ['worker'],
    buildings: ['metalsExtractor', 'solar'],
    orders: ['harvest'],
    suggestedGoal: 'grow_economy',
    gatingBuilding: 'commandHub',
  },
  {
    id: 'S2',
    stage: 2,
    wave: 'W08',
    name: 'The Grid',
    label: 'S2 The Grid',
    triggerKind: 'extractor_and_generator',
    triggerText: 'extractor + generator',
    unlockConditionText: 'extractor + generator · 2 min',
    dwellS: 120,
    designDwellS: 120,
    targetTimeS: 900,
    teaches: 'Grid reach, parallel workers, storage, night',
    units: [],
    buildings: ['pylon', 'depot', 'storageDepot', 'capacitor', 'wind', 'waterExtractor', 'petroleumWell', 'supplyDepot'],
    orders: ['fill', 'bridge', 'dismantle'],
    suggestedGoal: 'secure_power',
    gatingBuilding: 'extractor_and_generator',
  },
  {
    id: 'S3',
    stage: 3,
    wave: 'W08',
    name: 'First Contact',
    label: 'S3 First Contact',
    triggerKind: 'buildings_or_fauna',
    triggerText: '6 buildings + 2nd extractor',
    unlockConditionText: '6 buildings + 2nd extractor · 3 min',
    dwellS: 180,
    designDwellS: 180,
    targetTimeS: 1500,
    teaches: 'Threat and defense, supply cap',
    units: ['scout', 'guard'],
    buildings: ['roboticsFactory', 'robotics_factory', 'turret', 'pulseTurret', 'wall', 'radar', 'thermal'],
    orders: ['patrol', 'hold', 'guard'],
    suggestedGoal: 'defend_colony',
    gatingBuilding: 'roboticsFactory',
  },
  {
    id: 'S4',
    stage: 4,
    wave: 'W08',
    name: 'Neighbor',
    label: 'S4 Neighbor',
    triggerKind: 'factory_or_scout',
    triggerText: 'Robotics Factory T1 + 5 tiles scouted',
    unlockConditionText: 'Robotics Factory T1 + 5 tiles scouted · 3 min',
    dwellS: 180,
    designDwellS: 180,
    targetTimeS: 2400,
    teaches: 'Territory and reclaiming land (water, Living tiles)',
    units: ['combatEngineer', 'hauler'],
    buildings: ['outpostBeacon', 'tradeHub', 'road'],
    orders: ['claimSector', 'clearCorridor'],
    suggestedGoal: 'expand_territory',
    gatingBuilding: 'roboticsFactory',
  },
  {
    id: 'S5',
    stage: 5,
    wave: 'W17',
    name: 'Industrial',
    label: 'S5 Industrial',
    triggerKind: 'sectors_or_hub_t2',
    triggerText: 'sectors or Command Hub T2',
    unlockConditionText: 'sectors or Command Hub T2 · 5 min',
    dwellS: 300,
    designDwellS: 300,
    targetTimeS: 3600,
    teaches: 'Tiers and multirole: lanes merge',
    units: ['worker'],
    buildings: ['commandHub_t2', 'smelter', 'chemicalPlant', 'thermalGenerator', 'shieldDome'],
    orders: ['upgrade', 'prioritySliders'],
    suggestedGoal: 'tech_up',
    gatingBuilding: 'smelter',
  },
  {
    id: 'S6',
    stage: 6,
    wave: 'W17',
    name: 'Frontier',
    label: 'S6 Frontier',
    triggerKind: 'refinery_and_units',
    triggerText: 'refinery + units',
    unlockConditionText: 'refinery + units · 5 min',
    dwellS: 300,
    designDwellS: 300,
    targetTimeS: 5400,
    teaches: 'Counters (the ground triangle)',
    units: ['striker', 'sapper', 'envirobot'],
    buildings: ['roboticsFactory_t2', 'capacitor_t2', 'missileBattery', 'researchLab'],
    orders: ['tunnel', 'drain', 'irrigate', 'stabilize', 'tradeContract'],
    suggestedGoal: 'terraform_zone',
    gatingBuilding: 'roboticsFactory_t2',
  },
  {
    id: 'S7',
    stage: 7,
    wave: 'W17',
    name: 'Heavy Metal',
    label: 'S7 Heavy Metal',
    triggerKind: 'lab_and_sectors',
    triggerText: 'research lab + sectors',
    unlockConditionText: 'research lab + sectors · 8 min',
    dwellS: 480,
    designDwellS: 480,
    targetTimeS: 7200,
    teaches: 'Terrain as defense: walls stop ground units and direct fire; artillery, air and radar reach over',
    units: ['tank', 'artillery', 'warden', 'surveyDrone'],
    buildings: ['heavyFoundry', 'fusionReactor', 'shieldGenerator_t2', 'arcTower'],
    orders: ['siegeMode', 'artilleryBarrage', 'airRecon'],
    suggestedGoal: 'build_army',
    gatingBuilding: 'heavyFoundry',
  },
  {
    id: 'S8',
    stage: 8,
    wave: 'W19',
    name: 'Apex',
    label: 'S8 Apex',
    triggerKind: 'foundry_and_fusion',
    triggerText: 'heavy foundry + fusion reactor',
    unlockConditionText: 'heavy foundry + fusion reactor · 10 min',
    dwellS: 600,
    designDwellS: 600,
    targetTimeS: 10800,
    teaches: 'The air layer',
    units: ['goliath', 'valkyrie', 'archon', 'terraformingRig'],
    buildings: ['commandHub_t3', 'apexBay', 'orbitalUplink', 'planetaryShield'],
    orders: ['raiseMountain', 'carveCanyon', 'seedForest', 'purifyStep'],
    suggestedGoal: 'raid_target',
    gatingBuilding: 'commandHub_t3',
  },
  {
    id: 'S9',
    stage: 9,
    wave: 'W19',
    name: 'Orbital',
    label: 'S9 Orbital',
    triggerKind: 'hub_t3_and_uplink',
    triggerText: 'Command Hub T3 + orbital uplink',
    unlockConditionText: 'Command Hub T3 + orbital uplink · 10 min',
    dwellS: 600,
    designDwellS: 600,
    targetTimeS: 14400,
    teaches: 'The air triangle',
    units: ['hq_t3', 'hauler_t3'],
    buildings: ['launchPad', 'fuelSynthesizer', 'telemetryArray'],
    orders: ['rocketStage1', 'rocketStage2', 'rocketStage3'],
    suggestedGoal: 'build_rocket',
    gatingBuilding: 'orbitalUplink',
  },
  {
    id: 'S10',
    stage: 10,
    wave: 'W19',
    name: 'Ascendant',
    label: 'S10 Ascendant',
    triggerKind: 'first_rocket_launched',
    triggerText: 'first rocket launched',
    unlockConditionText: 'first rocket launched',
    dwellS: 0,
    designDwellS: 0,
    targetTimeS: 18000,
    teaches: 'Endgame tier and the rocket',
    units: ['ascendantSkin'],
    buildings: ['monument'],
    orders: ['allOrders'],
    suggestedGoal: 'build_rocket',
    gatingBuilding: 'launchPad',
  },
];

export function getStageSpec(stage: number): StageRow | undefined {
  return STAGE_TABLE_ROWS.find((r) => r.stage === stage);
}

export function getItemUnlockStage(itemId: string): number {
  for (const row of STAGE_TABLE_ROWS) {
    if (
      row.units.includes(itemId) ||
      row.buildings.includes(itemId) ||
      row.orders.includes(itemId)
    ) {
      return row.stage;
    }
  }
  return 0;
}

export function formatUnlockAtTooltip(stage: number): string {
  const spec = getStageSpec(stage);
  if (!spec) return `Unlocks at S${stage}`;
  return `Unlocks at S${stage}: ${spec.unlockConditionText}`;
}

/**
 * Progression stages S0 through S10 learning curve, triggers, dwells, unlock lists, and suggested goals.
 * Matches `units-orders-and-progression-spec.md` §6.2.
 */
export default defineTable<StageRow>({
  name: 'stages',
  summary: 'Progression stages S0..S10 learning curve, triggers, dwells, unlock lists, and suggested goals.',
  units: {
    dwellS: 'seconds',
    targetTimeS: 'seconds',
  },
  rows: STAGE_TABLE_ROWS,
});
