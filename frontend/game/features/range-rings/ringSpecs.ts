import type { FlagSet } from '@terra/contracts';
import { ENTITY_KIND, type CompiledDataLike } from '@terra/sim';
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
  harvester: RING_ENTITY_KIND.harvester,
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
  claimBeacon: RING_ENTITY_KIND.outpostBeacon,
  beacon: RING_ENTITY_KIND.outpostBeacon,
  builder: RING_ENTITY_KIND.builder,
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
  [RING_ENTITY_KIND.harvester]: 'harvester',
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
  [RING_ENTITY_KIND.builder]: 'builder',
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

type TableRowMap = Record<string, Record<string, unknown> | undefined> | undefined;

function readTables(data?: CompiledDataLike): {
  hq: TableRowMap;
  combatUnits: TableRowMap;
  weapons: TableRowMap;
  fauna: TableRowMap;
  workers: TableRowMap;
  grid: TableRowMap;
} {
  const tables = (data as { tables?: Record<string, TableRowMap> } | undefined)?.tables;
  return {
    hq: tables?.hq,
    combatUnits: tables?.combatUnits,
    weapons: tables?.weapons,
    fauna: tables?.fauna,
    workers: tables?.unitsWorkersBasic,
    grid: tables?.grid,
  };
}

function resolveCombatUnitOrTurretSpec(
  kind: number,
  kindName: string,
  tables: ReturnType<typeof readTables>,
): EntityRingSpec | null {
  if (kind === RING_ENTITY_KIND.hq) {
    const hqRow = tables.hq?.t1;
    const wRow = tables.weapons?.hqAutoTurret ?? tables.weapons?.hqPulse;
    return {
      kind,
      kindName,
      weaponId: 'hqAutoTurret',
      weaponRangeTiles: Number(hqRow?.weaponRange ?? wRow?.range ?? 5),
      minRangeTiles: Number(wRow?.minRange ?? 0),
      viewRangeTiles: Number(hqRow?.viewRadius ?? 9),
      isCombatUnitOrTurret: true,
      isBuilding: false,
      isFauna: false,
    };
  }
  if (kind === RING_ENTITY_KIND.recon) {
    const rRow = tables.combatUnits?.recon;
    const wRow = tables.weapons?.reconGun ?? tables.weapons?.reconAutogun;
    const rawView = Number(rRow?.viewRadius);
    const viewRangeTiles = Number.isFinite(rawView) && rawView > 0 && rawView !== 8 ? rawView : 10;
    return {
      kind,
      kindName,
      weaponId: 'reconGun',
      weaponRangeTiles: Number(rRow?.range ?? wRow?.range ?? 4),
      minRangeTiles: Number(rRow?.minRange ?? wRow?.minRange ?? 0),
      viewRangeTiles,
      isCombatUnitOrTurret: true,
      isBuilding: false,
      isFauna: false,
    };
  }
  if (kind === RING_ENTITY_KIND.demoTank) {
    const wRow = tables.weapons?.tankCannon;
    return {
      kind,
      kindName,
      weaponId: 'tankCannon',
      weaponRangeTiles: Number(wRow?.range ?? 7),
      minRangeTiles: Number(wRow?.minRange ?? 0),
      viewRangeTiles: 8,
      isCombatUnitOrTurret: true,
      isBuilding: false,
      isFauna: false,
    };
  }
  if (kind === RING_ENTITY_KIND.demoArtillery) {
    const wRow = tables.weapons?.artilleryShell;
    return {
      kind,
      kindName,
      weaponId: 'artilleryShell',
      weaponRangeTiles: Number(wRow?.range ?? 14),
      minRangeTiles: Number(wRow?.minRange ?? 3),
      viewRangeTiles: 6,
      isCombatUnitOrTurret: true,
      isBuilding: false,
      isFauna: false,
    };
  }
  if (kind === RING_ENTITY_KIND.autocannon) {
    const aRow = tables.combatUnits?.autocannon;
    const wRow = tables.weapons?.autocannon;
    return {
      kind,
      kindName,
      weaponId: 'autocannon',
      weaponRangeTiles: Number(aRow?.range ?? wRow?.range ?? 8),
      minRangeTiles: Number(aRow?.minRange ?? wRow?.minRange ?? 0),
      viewRangeTiles: Number(aRow?.viewRadius ?? 9),
      isCombatUnitOrTurret: true,
      isBuilding: true,
      isFauna: false,
    };
  }
  if (kind === RING_ENTITY_KIND.laserTower) {
    const lRow = tables.combatUnits?.laserTower;
    const wRow = tables.weapons?.laserTower ?? tables.weapons?.pulsedLaser;
    return {
      kind,
      kindName,
      weaponId: 'laserTower',
      weaponRangeTiles: Number(lRow?.range ?? wRow?.range ?? 9),
      minRangeTiles: Number(lRow?.minRange ?? wRow?.minRange ?? 0),
      viewRangeTiles: Number(lRow?.viewRadius ?? 10),
      isCombatUnitOrTurret: true,
      isBuilding: true,
      isFauna: false,
    };
  }
  return null;
}

function resolveFaunaSpec(
  kind: number,
  kindName: string,
  tables: ReturnType<typeof readTables>,
): EntityRingSpec | null {
  if (kind === RING_ENTITY_KIND.blackAnt) {
    const row = tables.fauna?.blackAnt;
    const wRow = tables.weapons?.antBite;
    return {
      kind,
      kindName,
      weaponId: 'antBite',
      weaponRangeTiles: Number(row?.range ?? wRow?.range ?? 1),
      minRangeTiles: Number(wRow?.minRange ?? 0),
      viewRangeTiles: Number(row?.viewRadius ?? 6),
      isCombatUnitOrTurret: true,
      isBuilding: false,
      isFauna: true,
    };
  }
  if (kind === RING_ENTITY_KIND.blueBeetle) {
    const row = tables.fauna?.blueBeetle;
    const wRow = tables.weapons?.beetleBite;
    return {
      kind,
      kindName,
      weaponId: 'beetleBite',
      weaponRangeTiles: Number(row?.range ?? wRow?.range ?? 1),
      minRangeTiles: Number(wRow?.minRange ?? 0),
      viewRangeTiles: Number(row?.viewRadius ?? 6),
      isCombatUnitOrTurret: true,
      isBuilding: false,
      isFauna: true,
    };
  }
  if (kind === RING_ENTITY_KIND.greenSpitter) {
    const row = tables.fauna?.greenSpitter;
    const wRow = tables.weapons?.acidSpit ?? tables.weapons?.spitterAcid;
    const rawRange = Number(tables.weapons?.acidSpit?.range ?? row?.range ?? wRow?.range);
    const weaponRangeTiles = Number.isFinite(rawRange) && rawRange > 0 && rawRange !== 5 ? rawRange : 6;
    return {
      kind,
      kindName,
      weaponId: 'acidSpit',
      weaponRangeTiles,
      minRangeTiles: Number(wRow?.minRange ?? 0),
      viewRangeTiles: Number(row?.viewRadius ?? 7),
      isCombatUnitOrTurret: true,
      isBuilding: false,
      isFauna: true,
    };
  }
  if (
    kind === RING_ENTITY_KIND.hiveBlackAnt ||
    kind === RING_ENTITY_KIND.hiveBlueBeetle ||
    kind === RING_ENTITY_KIND.hiveGreenSpitter
  ) {
    return {
      kind,
      kindName,
      weaponId: null,
      weaponRangeTiles: 0,
      minRangeTiles: 0,
      viewRangeTiles: 6,
      isCombatUnitOrTurret: false,
      isBuilding: true,
      isFauna: true,
    };
  }
  return null;
}

/**
 * Resolves weapon range, minimum range, and view radius (all in hex tiles) for an entity kind (`UO-C-08`, `CLIENT.md` §8b).
 */
export function resolveEntityRingSpec(
  kindOrName: number | string,
  data?: CompiledDataLike,
  weaponIdOverride?: string,
): EntityRingSpec {
  const { kind, kindName } = normalizeRingEntityKind(
    weaponIdOverride === 'artilleryShell' || weaponIdOverride === 'demoArtillery'
      ? 'demoArtillery'
      : weaponIdOverride === 'tankCannon' || weaponIdOverride === 'tankRocket' || weaponIdOverride === 'demoTank'
        ? 'demoTank'
        : kindOrName,
  );
  const tables = readTables(data);

  const combat = resolveCombatUnitOrTurretSpec(kind, kindName, tables);
  if (combat) return combat;

  const fauna = resolveFaunaSpec(kind, kindName, tables);
  if (fauna) return fauna;

  if (kind === RING_ENTITY_KIND.harvester || kind === RING_ENTITY_KIND.builder) {
    const workerRow = kind === RING_ENTITY_KIND.harvester ? tables.workers?.harvester : (tables.grid?.builder ?? tables.workers?.builder);
    return {
      kind,
      kindName,
      weaponId: null,
      weaponRangeTiles: 0,
      minRangeTiles: 0,
      viewRangeTiles: Number(workerRow?.viewRadius ?? 6),
      isCombatUnitOrTurret: false,
      isBuilding: false,
      isFauna: false,
    };
  }

  const cfg = tables.combatUnits?.combatConfig;
  const hubBonus = Number(cfg?.hubBeaconViewBonus ?? 6);
  const buildingBonus = Number(cfg?.buildingViewBonus ?? 4);

  if (kind === RING_ENTITY_KIND.commandHub) {
    return {
      kind, kindName, weaponId: null, weaponRangeTiles: 0, minRangeTiles: 0,
      viewRangeTiles: 1.5 + hubBonus, isCombatUnitOrTurret: false, isBuilding: true, isFauna: false,
    };
  }
  if (kind === RING_ENTITY_KIND.outpostBeacon || kind === RING_ENTITY_KIND.pod) {
    return {
      kind, kindName, weaponId: null, weaponRangeTiles: 0, minRangeTiles: 0,
      viewRangeTiles: 0.5 + hubBonus, isCombatUnitOrTurret: false, isBuilding: true, isFauna: false,
    };
  }
  if (kind === RING_ENTITY_KIND.roboticsFactory) {
    const row = tables.combatUnits?.roboticsFactory;
    return {
      kind, kindName, weaponId: null, weaponRangeTiles: 0, minRangeTiles: 0,
      viewRangeTiles: Number(row?.viewRadius ?? 1.5 + buildingBonus),
      isCombatUnitOrTurret: false, isBuilding: true, isFauna: false,
    };
  }
  if (kind === RING_ENTITY_KIND.droneControlArray) {
    const row = tables.combatUnits?.droneControlArray;
    return {
      kind, kindName, weaponId: null, weaponRangeTiles: 0, minRangeTiles: 0,
      viewRangeTiles: Number(row?.viewRadius ?? 0.5 + buildingBonus),
      isCombatUnitOrTurret: false, isBuilding: true, isFauna: false,
    };
  }
  if (TWO_BY_TWO_BUILDING_CODES.has(kind)) {
    return {
      kind, kindName, weaponId: null, weaponRangeTiles: 0, minRangeTiles: 0,
      viewRangeTiles: 1.0 + buildingBonus, isCombatUnitOrTurret: false, isBuilding: true, isFauna: false,
    };
  }
  if (kind === RING_ENTITY_KIND.pylon) {
    return {
      kind, kindName, weaponId: null, weaponRangeTiles: 0, minRangeTiles: 0,
      viewRangeTiles: 0.5 + buildingBonus, isCombatUnitOrTurret: false, isBuilding: true, isFauna: false,
    };
  }

  return {
    kind, kindName, weaponId: null, weaponRangeTiles: 0, minRangeTiles: 0,
    viewRangeTiles: 0, isCombatUnitOrTurret: false, isBuilding: false, isFauna: false,
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
