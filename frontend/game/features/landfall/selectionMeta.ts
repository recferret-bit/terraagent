import { ENTITY_KIND, ENTITY_STATE } from '@terra/sim';

export const COMBAT_KIND_CODES = {
  recon: ENTITY_KIND.recon ?? 51,
  demoTank: (ENTITY_KIND as Record<string, number>).demoTank ?? 52,
  demoArtillery: (ENTITY_KIND as Record<string, number>).demoArtillery ?? 53,
  roboticsFactory: ENTITY_KIND.roboticsFactory ?? 17,
  droneControlArray: ENTITY_KIND.droneControlArray ?? 18,
  autocannon: ENTITY_KIND.autocannon ?? 19,
  laserTower: ENTITY_KIND.laserTower ?? 20,
  blackAnt: ENTITY_KIND.blackAnt ?? 60,
  blueBeetle: ENTITY_KIND.blueBeetle ?? 61,
  greenSpitter: ENTITY_KIND.greenSpitter ?? 62,
  blackAntHive: (ENTITY_KIND as Record<string, number>).blackAntHive ?? ENTITY_KIND.hiveBlackAnt ?? 63,
  blueBeetleHive: (ENTITY_KIND as Record<string, number>).blueBeetleHive ?? ENTITY_KIND.hiveBlueBeetle ?? 64,
  greenSpitterHive: (ENTITY_KIND as Record<string, number>).greenSpitterHive ?? ENTITY_KIND.hiveGreenSpitter ?? 65,
  hiveBlackAnt: ENTITY_KIND.hiveBlackAnt ?? 63,
  hiveBlueBeetle: ENTITY_KIND.hiveBlueBeetle ?? 64,
  hiveGreenSpitter: ENTITY_KIND.hiveGreenSpitter ?? 65,
} as const;

export const KIND_BY_NAME: Record<string, number> = {
  hq: ENTITY_KIND.hq,
  harvester: ENTITY_KIND.harvester,
  builder: ENTITY_KIND.builder,
  commandHub: ENTITY_KIND.commandHub,
  metalsExtractor: ENTITY_KIND.metalsExtractor,
  solar: ENTITY_KIND.solar,
  solarArray: ENTITY_KIND.solar,
  tradeHub: ENTITY_KIND.tradeHub,
  pod: ENTITY_KIND.pod,
  devProbe: ENTITY_KIND.devProbe,
  pylon: ENTITY_KIND.pylon,
  capacitor: ENTITY_KIND.capacitor,
  wind: ENTITY_KIND.wind,
  thermal: ENTITY_KIND.thermal,
  supplyDepot: ENTITY_KIND.supplyDepot,
  mineralsQuarry: ENTITY_KIND.mineralsQuarry,
  waterExtractor: ENTITY_KIND.waterExtractor,
  petroleumWell: ENTITY_KIND.petroleumWell,
  recon: COMBAT_KIND_CODES.recon,
  demoTank: COMBAT_KIND_CODES.demoTank,
  demoArtillery: COMBAT_KIND_CODES.demoArtillery,
  roboticsFactory: COMBAT_KIND_CODES.roboticsFactory,
  droneControlArray: COMBAT_KIND_CODES.droneControlArray,
  droneArray: COMBAT_KIND_CODES.droneControlArray,
  autocannon: COMBAT_KIND_CODES.autocannon,
  turret: COMBAT_KIND_CODES.autocannon,
  laserTower: COMBAT_KIND_CODES.laserTower,
  pulseTurret: COMBAT_KIND_CODES.laserTower,
  blackAnt: COMBAT_KIND_CODES.blackAnt,
  blueBeetle: COMBAT_KIND_CODES.blueBeetle,
  greenSpitter: COMBAT_KIND_CODES.greenSpitter,
  blackAntHive: COMBAT_KIND_CODES.blackAntHive,
  blueBeetleHive: COMBAT_KIND_CODES.blueBeetleHive,
  greenSpitterHive: COMBAT_KIND_CODES.greenSpitterHive,
  hiveBlackAnt: COMBAT_KIND_CODES.hiveBlackAnt,
  hiveBlueBeetle: COMBAT_KIND_CODES.hiveBlueBeetle,
  hiveGreenSpitter: COMBAT_KIND_CODES.hiveGreenSpitter,
};

export const STATE_BY_NAME: Record<string, number> = {
  idle: ENTITY_STATE.idle,
  moving: ENTITY_STATE.moving,
  working: ENTITY_STATE.working,
  constructing: ENTITY_STATE.constructing,
  harvesting: ENTITY_STATE.harvesting,
  waiting: ENTITY_STATE.waiting,
  repairing: ENTITY_STATE.repairing,
  offlineNoFuel: ENTITY_STATE.offlineNoFuel,
  offlineNoGrid: ENTITY_STATE.offlineNoGrid,
  offlineOverload: ENTITY_STATE.offlineOverload,
};

export const BLDG_META: Record<number, { label: string; code: string; w: number; d: number; hpMax: number }> = {
  [ENTITY_KIND.tradeHub]: { label: 'TRADE HUB', code: 'TRD', w: 2, d: 2, hpMax: 900 },
  [ENTITY_KIND.commandHub]: { label: 'COMMAND HUB', code: 'HUB', w: 3, d: 3, hpMax: 1500 },
  [ENTITY_KIND.metalsExtractor]: { label: 'METALS EXTRACTOR', code: 'EXT', w: 2, d: 2, hpMax: 500 },
  [ENTITY_KIND.solar]: { label: 'SOLAR ARRAY', code: 'SOL', w: 2, d: 2, hpMax: 300 },
  [ENTITY_KIND.pod]: { label: 'DROP POD', code: 'POD', w: 1, d: 1, hpMax: 600 },
  [ENTITY_KIND.pylon]: { label: 'POWER PYLON', code: 'PYL', w: 1, d: 1, hpMax: 200 },
  [ENTITY_KIND.capacitor]: { label: 'CAPACITOR BANK', code: 'CAP', w: 2, d: 2, hpMax: 350 },
  [ENTITY_KIND.wind]: { label: 'WIND TURBINE', code: 'WND', w: 2, d: 2, hpMax: 280 },
  [ENTITY_KIND.thermal]: { label: 'THERMAL PLANT', code: 'THM', w: 2, d: 2, hpMax: 550 },
  [ENTITY_KIND.supplyDepot]: { label: 'SUPPLY DEPOT', code: 'DEP', w: 2, d: 2, hpMax: 600 },
  [ENTITY_KIND.mineralsQuarry]: { label: 'MINERALS QUARRY', code: 'QRY', w: 2, d: 2, hpMax: 500 },
  [ENTITY_KIND.waterExtractor]: { label: 'WATER EXTRACTOR', code: 'H2O', w: 2, d: 2, hpMax: 420 },
  [ENTITY_KIND.petroleumWell]: { label: 'PETROLEUM WELL', code: 'OIL', w: 2, d: 2, hpMax: 550 },
  [COMBAT_KIND_CODES.roboticsFactory]: { label: 'ROBOTICS FACTORY', code: 'FAC', w: 3, d: 3, hpMax: 1100 },
  [COMBAT_KIND_CODES.droneControlArray]: { label: 'DRONE CONTROL ARRAY', code: 'DCA', w: 1, d: 1, hpMax: 320 },
  [COMBAT_KIND_CODES.autocannon]: { label: 'AUTOCANNON TURRET', code: 'ACN', w: 1, d: 1, hpMax: 420 },
  [COMBAT_KIND_CODES.laserTower]: { label: 'LASER TOWER', code: 'LSR', w: 1, d: 1, hpMax: 460 },
};

export const COMBAT_UNIT_META: Record<number, { label: string; code: string; hpMax: number }> = {
  [COMBAT_KIND_CODES.recon]: { label: 'RECON DRONE', code: 'RCN', hpMax: 240 },
  [COMBAT_KIND_CODES.demoTank]: { label: 'ASSAULT TANK', code: 'TNK', hpMax: 520 },
  [COMBAT_KIND_CODES.demoArtillery]: { label: 'MOBILE ARTILLERY', code: 'ART', hpMax: 320 },
};

export function normalizeKindCode(k: unknown): number {
  if (typeof k === 'number' && Number.isFinite(k)) return k;
  if (typeof k === 'string') return KIND_BY_NAME[k] ?? 0;
  return 0;
}

export function normalizeStateCode(s: unknown): number {
  if (typeof s === 'number' && Number.isFinite(s)) return s;
  if (typeof s === 'string') return STATE_BY_NAME[s] ?? ENTITY_STATE.idle;
  return ENTITY_STATE.idle;
}

export function isHiveKind(kind: number): boolean {
  return (
    kind === COMBAT_KIND_CODES.blackAntHive ||
    kind === COMBAT_KIND_CODES.blueBeetleHive ||
    kind === COMBAT_KIND_CODES.greenSpitterHive
  );
}

export function isFaunaOrHiveKind(kind: number): boolean {
  return (
    isHiveKind(kind) ||
    kind === COMBAT_KIND_CODES.blackAnt ||
    kind === COMBAT_KIND_CODES.blueBeetle ||
    kind === COMBAT_KIND_CODES.greenSpitter
  );
}

export function isArmyCombatUnitKind(kind: number): boolean {
  return Boolean(COMBAT_UNIT_META[kind]);
}

export function isSelectableCombatUnitKind(kind: number): boolean {
  return isArmyCombatUnitKind(kind) || kind === ENTITY_KIND.hq;
}
