import type { FlagSet } from '@terra/contracts';
import { ENTITY_KIND, getEntitySpottingRadius, isFaunaBugKind, isFaunaHiveKind, resolveKindWeaponRow, type CompiledDataLike } from '@terra/sim';
import { clientDataFor } from '../../core/flags/data';
import type { FeatureStore } from '../../core/registry/types';

export const RING_ENTITY_KIND = {
  ...ENTITY_KIND,
  outpostBeacon: 21,
  demoTank: 52,
  demoArtillery: 53,
} as const;

export interface EntityRingSpec {
  kind: number;
  kindName: string;
  weaponId: string | null;
  weaponRangeTiles: number;
  minRangeTiles: number;
  viewRangeTiles: number;
  isCombatUnitOrTurret: boolean;
  isBuilding: boolean;
  isFauna: boolean;
}

const KIND_NAME_TO_CODE: Readonly<Record<string, number>> = {
  devProbe: RING_ENTITY_KIND.devProbe,
  pod: RING_ENTITY_KIND.pod,
  dropPod: RING_ENTITY_KIND.dropPod,
  hq: RING_ENTITY_KIND.hq,
  commandHub: RING_ENTITY_KIND.commandHub,
  hub: RING_ENTITY_KIND.hub,
  metalsExtractor: RING_ENTITY_KIND.metalsExtractor,
  solar: RING_ENTITY_KIND.solar,
  worker: RING_ENTITY_KIND.worker,
  harvester: RING_ENTITY_KIND.worker,
  tradeHub: RING_ENTITY_KIND.tradeHub,
  pylon: RING_ENTITY_KIND.pylon,
  capacitor: RING_ENTITY_KIND.capacitor,
  wind: RING_ENTITY_KIND.wind,
  thermal: RING_ENTITY_KIND.thermal,
  supplyDepot: RING_ENTITY_KIND.supplyDepot,
  depot: RING_ENTITY_KIND.depot,
  mineralsQuarry: RING_ENTITY_KIND.mineralsQuarry,
  quarry: RING_ENTITY_KIND.quarry,
  waterExtractor: RING_ENTITY_KIND.waterExtractor,
  waterPump: RING_ENTITY_KIND.waterPump,
  petroleumWell: RING_ENTITY_KIND.petroleumWell,
  oilWell: RING_ENTITY_KIND.oilWell,
  roboticsFactory: RING_ENTITY_KIND.roboticsFactory,
  droneControlArray: RING_ENTITY_KIND.droneControlArray,
  droneArray: RING_ENTITY_KIND.droneArray,
  autocannon: RING_ENTITY_KIND.autocannon,
  turret: RING_ENTITY_KIND.turret,
  laserTower: RING_ENTITY_KIND.laserTower,
  pulseTurret: RING_ENTITY_KIND.pulseTurret,
  outpostBeacon: RING_ENTITY_KIND.outpostBeacon,
  territoryBeacon: RING_ENTITY_KIND.territoryBeacon,
  claimBeacon: RING_ENTITY_KIND.outpostBeacon,
  beacon: RING_ENTITY_KIND.outpostBeacon,
  hazardShield: RING_ENTITY_KIND.hazardShield,
  shieldDome: RING_ENTITY_KIND.shieldDome,
  lightningRod: RING_ENTITY_KIND.lightningRod,
  hydro: RING_ENTITY_KIND.hydro,
  hydroGenerator: RING_ENTITY_KIND.hydroGenerator,
  builder: RING_ENTITY_KIND.worker,
  recon: RING_ENTITY_KIND.recon,
  demoTank: RING_ENTITY_KIND.demoTank,
  tank: RING_ENTITY_KIND.demoTank,
  demoArtillery: RING_ENTITY_KIND.demoArtillery,
  artillery: RING_ENTITY_KIND.demoArtillery,
  blackAnt: RING_ENTITY_KIND.blackAnt,
  blueBeetle: RING_ENTITY_KIND.blueBeetle,
  greenSpitter: RING_ENTITY_KIND.greenSpitter,
  hiveBlackAnt: RING_ENTITY_KIND.hiveBlackAnt,
  hiveBlueBeetle: RING_ENTITY_KIND.hiveBlueBeetle,
  hiveGreenSpitter: RING_ENTITY_KIND.hiveGreenSpitter,
};

const CODE_TO_KIND_NAME: Readonly<Record<number, string>> = {
  [RING_ENTITY_KIND.devProbe]: 'devProbe',
  [RING_ENTITY_KIND.pod]: 'pod',
  [RING_ENTITY_KIND.hq]: 'hq',
  [RING_ENTITY_KIND.commandHub]: 'commandHub',
  [RING_ENTITY_KIND.metalsExtractor]: 'metalsExtractor',
  [RING_ENTITY_KIND.solar]: 'solar',
  [RING_ENTITY_KIND.worker]: 'worker',
  [RING_ENTITY_KIND.tradeHub]: 'tradeHub',
  [RING_ENTITY_KIND.pylon]: 'pylon',
  [RING_ENTITY_KIND.capacitor]: 'capacitor',
  [RING_ENTITY_KIND.wind]: 'wind',
  [RING_ENTITY_KIND.thermal]: 'thermal',
  [RING_ENTITY_KIND.supplyDepot]: 'supplyDepot',
  [RING_ENTITY_KIND.mineralsQuarry]: 'mineralsQuarry',
  [RING_ENTITY_KIND.waterExtractor]: 'waterExtractor',
  [RING_ENTITY_KIND.petroleumWell]: 'petroleumWell',
  [RING_ENTITY_KIND.roboticsFactory]: 'roboticsFactory',
  [RING_ENTITY_KIND.droneControlArray]: 'droneControlArray',
  [RING_ENTITY_KIND.autocannon]: 'autocannon',
  [RING_ENTITY_KIND.laserTower]: 'laserTower',
  [RING_ENTITY_KIND.outpostBeacon]: 'outpostBeacon',
  [RING_ENTITY_KIND.hazardShield]: 'hazardShield',
  [RING_ENTITY_KIND.lightningRod]: 'lightningRod',
  [RING_ENTITY_KIND.hydro]: 'hydro',
  [RING_ENTITY_KIND.recon]: 'recon',
  [RING_ENTITY_KIND.demoTank]: 'demoTank',
  [RING_ENTITY_KIND.demoArtillery]: 'demoArtillery',
  [RING_ENTITY_KIND.blackAnt]: 'blackAnt',
  [RING_ENTITY_KIND.blueBeetle]: 'blueBeetle',
  [RING_ENTITY_KIND.greenSpitter]: 'greenSpitter',
  [RING_ENTITY_KIND.hiveBlackAnt]: 'hiveBlackAnt',
  [RING_ENTITY_KIND.hiveBlueBeetle]: 'hiveBlueBeetle',
  [RING_ENTITY_KIND.hiveGreenSpitter]: 'hiveGreenSpitter',
};

const TWO_BY_TWO_BUILDING_CODES: ReadonlySet<number> = new Set([
  RING_ENTITY_KIND.tradeHub,
  RING_ENTITY_KIND.metalsExtractor,
  RING_ENTITY_KIND.solar,
  RING_ENTITY_KIND.capacitor,
  RING_ENTITY_KIND.wind,
  RING_ENTITY_KIND.thermal,
  RING_ENTITY_KIND.supplyDepot,
  RING_ENTITY_KIND.mineralsQuarry,
  RING_ENTITY_KIND.waterExtractor,
  RING_ENTITY_KIND.petroleumWell,
]);

function toFlagSet(flags: ReadonlySet<string> | FlagSet): FlagSet {
  if ('spec' in flags && 'list' in flags && typeof flags.has === 'function') return flags as FlagSet;
  const set = flags as ReadonlySet<string>;
  const list = Array.from(set);
  return { has: (w: string) => set.has(w), list, spec: list.join(',') };
}

let cachedData: { spec: string; data: CompiledDataLike } | null = null;

export function rangeRingsData(flags: ReadonlySet<string> | FlagSet, store?: FeatureStore | null): CompiledDataLike {
  const fromStore = store?.simData?.();
  if (fromStore) return fromStore;
  const fs = toFlagSet(flags);
  if (cachedData?.spec !== fs.spec) cachedData = { spec: fs.spec, data: clientDataFor(fs) };
  return cachedData.data;
}

export function normalizeRingEntityKind(kindOrName: number | string | undefined): { kind: number; kindName: string } {
  if (typeof kindOrName === 'number' && Number.isFinite(kindOrName)) {
    return { kind: kindOrName, kindName: CODE_TO_KIND_NAME[kindOrName] ?? `kind_${kindOrName}` };
  }
  if (typeof kindOrName === 'string') {
    const code = KIND_NAME_TO_CODE[kindOrName] ?? 0;
    return { kind: code, kindName: CODE_TO_KIND_NAME[code] ?? kindOrName };
  }
  return { kind: 0, kindName: 'unknown' };
}

export function is2x2RingBuildingKind(kind: number): boolean {
  return TWO_BY_TWO_BUILDING_CODES.has(kind);
}

const OTHER_BUILDINGS = new Set<number>([
  ENTITY_KIND.commandHub, ENTITY_KIND.pod, ENTITY_KIND.pylon, ENTITY_KIND.roboticsFactory,
  ENTITY_KIND.droneControlArray, ENTITY_KIND.autocannon, ENTITY_KIND.laserTower, RING_ENTITY_KIND.outpostBeacon,
]);

/** UI metadata only: combat and sight numbers come from the same shared rules the host enforces. */
export function resolveEntityRingSpec(
  kindOrName: number | string,
  data?: CompiledDataLike,
  weaponIdOverride?: string,
): EntityRingSpec {
  const overrideKind = weaponIdOverride === 'artilleryShell' || weaponIdOverride === 'demoArtillery' ? 'demoArtillery'
    : ['tankCannon', 'tankRocket', 'demoTank'].includes(weaponIdOverride ?? '') ? 'demoTank' : kindOrName;
  const { kind, kindName } = normalizeRingEntityKind(overrideKind);
  const weapon = resolveKindWeaponRow(kind, data);
  const hive = isFaunaHiveKind(kind);
  return {
    kind, kindName,
    weaponId: weapon?.id ?? null,
    weaponRangeTiles: Number(weapon?.range ?? 0),
    minRangeTiles: Number(weapon?.minRange ?? 0),
    viewRangeTiles: CODE_TO_KIND_NAME[kind] ? getEntitySpottingRadius(kind, data) : 0,
    isCombatUnitOrTurret: Boolean(weapon),
    isBuilding: hive || TWO_BY_TWO_BUILDING_CODES.has(kind) || OTHER_BUILDINGS.has(kind),
    isFauna: hive || isFaunaBugKind(kind),
  };
}

/**
 * Resolves weapon range and view radius for an active turret placement ghost (`autocannon`, `turret`, `laserTower`).
 */
export function resolveGhostTurretRingSpec(
  building: string,
  data?: CompiledDataLike,
): { weaponRangeTiles: number; viewRangeTiles: number } | null {
  if (building === 'autocannon' || building === 'turret') {
    const spec = resolveEntityRingSpec(RING_ENTITY_KIND.autocannon, data);
    return { weaponRangeTiles: spec.weaponRangeTiles, viewRangeTiles: spec.viewRangeTiles };
  }
  if (building === 'laserTower' || building === 'pulseTurret') {
    const spec = resolveEntityRingSpec(RING_ENTITY_KIND.laserTower, data);
    return { weaponRangeTiles: spec.weaponRangeTiles, viewRangeTiles: spec.viewRangeTiles };
  }
  return null;
}
