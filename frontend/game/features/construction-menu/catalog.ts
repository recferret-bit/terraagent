import { STAGE_BUILDING_ROWS } from './stageRows';
import type { FlagSet } from '@terra/contracts';
import { ENTITY_KIND, evaluateTradeHubUnlock, type CompiledDataLike, formatUnlockAtTooltip, getItemUnlockStage, getStageSpec, TICK_MS } from '@terra/sim';
import { clientDataFor } from '../../core/flags/data';
import type { GameView } from '../../core/registry/types';
import { ENTITY_STRIDE } from '../../store/replica/viewCodec';

export type BuildingKind =
  | 'commandHub'
  | 'metalsExtractor'
  | 'solar'
  | 'pylon'
  | 'capacitor'
  | 'wind'
  | 'thermal'
  | 'supplyDepot'
  | 'mineralsQuarry'
  | 'waterExtractor'
  | 'petroleumWell'
  | 'builder'
  | 'depot'
  | 'roboticsFactory'
  | 'droneControlArray'
  | 'autocannon'
  | 'laserTower'
  | 'turret'
  | 'outpostBeacon'
  | 'tradeHub';

export interface BuildingCardModel {
  id: string;
  building: BuildingKind;
  label: string;
  category?: 'Command' | 'Economy' | 'Power';
  unlockHint?: string;
  tier: number;
  unlockStage: number;
  stageLocked: boolean;
  unlockConditionText?: string;
  unlockDetailText?: string;
  footprintW: number;
  footprintD: number;
  footprintText: string;
  designBuildS: number;
  hqBuildS: number;
  cost: Record<string, number>;
  powerText: string;
  disabled: boolean;
  disabledReason?: string;
}

function toFlagSet(flags: ReadonlySet<string> | FlagSet): FlagSet {
  if ('spec' in flags && 'list' in flags && typeof flags.has === 'function') {
    return flags as FlagSet;
  }
  const set = flags as ReadonlySet<string>;
  const list = Array.from(set);
  return {
    has: (w: string) => set.has(w),
    list,
    spec: list.join(','),
  };
}

const LABELS: Record<string, string> = {
  commandHub: 'Command Hub',
  metalsExtractor: 'Resource Extractor',
  solar: 'Solar Collector Array',
  builder: 'Builder',
  depot: 'Depot',
  roboticsFactory: 'Robotics Factory',
  droneControlArray: 'Drone Control Array',
  autocannon: 'Autocannon Turret',
  laserTower: 'Laser Tower',
  turret: 'Turret',
  outpostBeacon: 'Outpost Beacon',
  tradeHub: 'Trade Hub',
  pylon: 'Power Pylon',
  capacitor: 'Capacitor Bank',
  wind: 'Wind Turbine',
  thermal: 'Thermal Plant',
  supplyDepot: 'Supply Depot',
  mineralsQuarry: 'Minerals Quarry',
  waterExtractor: 'Water Extractor',
  petroleumWell: 'Petroleum Well',
};

const numField = (row: Record<string, unknown>, key: string): number =>
  typeof row[key] === 'number' && Number.isFinite(row[key]) ? (row[key] as number) : 0;

/** Generator net at full output (E/s): `grossOutputPerS − internalDrainPerS` when the row has a gross, else `netOutputPerS`. */
function generatorNet(row: Record<string, unknown>): number {
  const gross = numField(row, 'grossOutputPerS');
  if (gross > 0) return Number((gross - numField(row, 'internalDrainPerS')).toFixed(2));
  return numField(row, 'netOutputPerS');
}

/** A card's power line, read from its balance row (`founderCoreGenPerS`, `powerDrainPerS`, gross / net, `capacityE`). */
export function resolveColonyUnlockStage(view?: GameView, colonyIndex = 0): number | undefined {
  if (!view) return undefined;
  const v = view as {
    colonyId?: number;
    colonyIndex?: number;
    unlockStage?: number;
    stage?: number;
    colonies?: Array<{ index?: number; unlockStage?: number; stage?: number }>;
  };
  const idx = v.colonyIndex ?? v.colonyId ?? colonyIndex;
  const col = v.colonies?.find((c) => c?.index === idx) ?? v.colonies?.[idx] ?? v.colonies?.[0];
  const val = col?.unlockStage ?? col?.stage ?? v.unlockStage ?? v.stage;
  return typeof val === 'number' && Number.isFinite(val) ? val : undefined;
}

function hasExplicitUnlockStage(view?: GameView): boolean {
  if (!view) return false;
  const v = view as {
    unlockStage?: number;
    colonies?: Array<{ unlockStage?: number }>;
  };
  return typeof v.colonies?.[0]?.unlockStage === 'number' || typeof v.unlockStage === 'number';
}

export function formatUnlockDetail(stage: number): string {
  const spec = getStageSpec(stage);
  if (!spec) return formatUnlockAtTooltip(stage);
  if (stage === 2) {
    return 'Unlocks at S2: extractor + generator complete · 2 min';
  }
  return formatUnlockAtTooltip(stage);
}

function resolveRowUnlockStage(row: Record<string, unknown>): number {
  if (typeof row.unlockStage === 'number' && Number.isFinite(row.unlockStage)) {
    return row.unlockStage;
  }
  if (typeof row.unlock === 'string') {
    const m = /^S(\d+)$/i.exec(row.unlock.trim());
    if (m) return Number(m[1]);
  }
  const key = String(row.building ?? row.id ?? '');
  return getItemUnlockStage(key);
}

function formatPower(row: Record<string, unknown>): string {
  const gen = numField(row, 'founderCoreGenPerS');
  const drain = numField(row, 'powerDrainPerS');
  const net = generatorNet(row);
  const capE = numField(row, 'capacityE');

  if (gen > 0 && drain > 0) {
    return `+${gen} / −${drain} E/s`;
  }
  if (net > 0) {
    return `+${net} E/s`;
  }
  if (capE > 0 && drain > 0) {
    return `−${drain} E/s · ${capE} E`;
  }
  if (drain > 0) {
    return `−${drain} E/s`;
  }
  return '0 E/s';
}

function isHubBuilt(view?: GameView): boolean {
  if (!view) return false;
  const v = view as {
    entities?: Float32Array | Array<{ kind?: number }>;
    colonies?: Array<{ hubBuilt?: boolean; [k: string]: unknown }>;
    hubBuilt?: boolean;
  };
  if (v.hubBuilt === true) return true;
  if (v.colonies?.[0]?.hubBuilt === true) return true;
  if (v.entities) {
    if (v.entities instanceof Float32Array) {
      for (let i = 0; i < v.entities.length; i += ENTITY_STRIDE) {
        if (v.entities[i + 1] === ENTITY_KIND.commandHub) return true;
      }
    } else if (Array.isArray(v.entities)) {
      for (const e of v.entities) {
        if (e && e.kind === ENTITY_KIND.commandHub) return true;
      }
    }
  }
  return false;
}

function hasInsufficientStock(cost: Record<string, number>, view?: GameView): boolean {
  if (!view) return false;
  const v = view as {
    colonies?: Array<{ stock?: Record<string, number> }>;
    stock?: Record<string, number>;
  };
  const stock = v.colonies?.[0]?.stock ?? v.stock;
  if (!stock) return false;
  for (const [res, amt] of Object.entries(cost)) {
    if (amt > 0 && (stock[res] ?? 0) < amt) {
      return true;
    }
  }
  return false;
}

function isStageLocked(unlockStage: number, colonyStage: number | undefined): boolean {
  if (colonyStage === undefined) return false;
  return colonyStage < unlockStage;
}

function categoryForBuilding(building: BuildingKind): 'Command' | 'Economy' | 'Power' {
  if (building === 'commandHub') return 'Command';
  if (building === 'solar') return 'Power';
  return 'Economy';
}

function makeCard(
  row: Record<string, unknown>,
  view: GameView | undefined,
  fs: FlagSet,
  colonyStage: number | undefined,
  data: CompiledDataLike,
): BuildingCardModel {
  const building = String(row.building) as BuildingKind;
  const label = typeof row.label === 'string' ? row.label : (LABELS[building] ?? building);
  const tier = typeof row.tier === 'number' ? row.tier : 1;
  const unlockStage = resolveRowUnlockStage(row);
  const defaultFp = typeof row.footprint === 'number' ? row.footprint : 1;
  const footprintW = typeof row.footprintW === 'number' ? row.footprintW : defaultFp;
  const footprintD = typeof row.footprintD === 'number' ? row.footprintD : defaultFp;
  const footprintText = `${footprintW}×${footprintD}`;
  const designBuildS =
    typeof row.designBuildS === 'number' ? row.designBuildS : (Number(row.buildS ?? 0) * TICK_MS) / 1000;
  const hqBuildS = Number((designBuildS / 1.5).toFixed(1));
  const cost = (row.cost as Record<string, number>) ?? {};
  const powerText = formatPower(row);

  const tradeUnlock = building === 'tradeHub' && fs.has('W10') ? evaluateTradeHubUnlock(view, 0, data) : undefined;
  const stageLocked = tradeUnlock ? !tradeUnlock.unlocked : isStageLocked(unlockStage, colonyStage);
  let disabled = false;
  let disabledReason: string | undefined;
  let unlockConditionText: string | undefined;
  let unlockDetailText: string | undefined;

  if (building === 'commandHub' && isHubBuilt(view)) {
    disabled = true;
    disabledReason = 'Already built';
  } else if (tradeUnlock && !tradeUnlock.unlocked) {
    disabled = true;
    disabledReason = tradeUnlock.hint;
  } else if (!tradeUnlock && stageLocked) {
    disabled = true;
    unlockConditionText = formatUnlockAtTooltip(unlockStage);
    unlockDetailText = formatUnlockDetail(unlockStage);
    const useLegacyLockedLabel = !fs.has('W08') && colonyStage === 0 && !hasExplicitUnlockStage(view);
    disabledReason = useLegacyLockedLabel ? 'Locked' : unlockConditionText;
  } else if (hasInsufficientStock(cost, view)) {
    disabled = true;
    disabledReason = 'Insufficient resources';
  }

  return {
    id: String(row.id),
    building,
    label,
    category: categoryForBuilding(building),
    unlockHint: tradeUnlock?.hint,
    tier,
    unlockStage,
    stageLocked,
    unlockConditionText,
    unlockDetailText,
    footprintW,
    footprintD,
    footprintText,
    designBuildS,
    hqBuildS,
    cost,
    powerText,
    disabled,
    disabledReason,
  };
}

export function buildConstructionCatalog(flags: ReadonlySet<string> | FlagSet, view?: GameView): BuildingCardModel[] {
  const fs = toFlagSet(flags);
  const data = clientDataFor(fs);
  const isLiveGameView = Boolean(view && typeof view === 'object' && 'planet' in view && (view as { planet?: unknown }).planet !== undefined);
  const colonyStage = !fs.has('W08') && isLiveGameView ? undefined : resolveColonyUnlockStage(view);
  const candidateRows: Record<string, unknown>[] = [];
  const seenBuildings = new Set<string>();

  const hubRow = data.tables['hub']?.['t1'];
  if (hubRow) {
    candidateRows.push(hubRow as Record<string, unknown>);
    seenBuildings.add(String(hubRow.building));
  }

  const econTable = data.tables['economyT1Basic'];
  if (econTable) {
    const buildingRows = Object.values(econTable).filter((r) => r.kind === 'building' && r.building !== 'mineralsQuarry');
    for (const row of buildingRows) {
      candidateRows.push(row as Record<string, unknown>);
      seenBuildings.add(String(row.building));
    }
  }

  const gridTable = data.tables['grid'];
  if (gridTable) {
    const gridBuildingRows = Object.values(gridTable).filter((r) => r.kind === 'building' && r.building !== 'mineralsQuarry');
    for (const row of gridBuildingRows) {
      candidateRows.push(row as Record<string, unknown>);
      seenBuildings.add(String(row.building));
      if (row.building === 'supplyDepot') seenBuildings.add('depot');
    }
  }

  const combatTable = fs.has('W07') ? data.tables['combatUnits'] : undefined;
  if (combatTable) {
    const combatBuildingRows = Object.values(combatTable).filter((r) => r && r.kind === 'building');
    for (const row of combatBuildingRows) {
      const bKey = String(row.building ?? row.id);
      if (!seenBuildings.has(bKey)) {
        candidateRows.push(row as Record<string, unknown>);
        seenBuildings.add(bKey);
        if (bKey === 'autocannon') seenBuildings.add('turret');
      }
    }
  }

  const tradeHubTable = data.tables['tradeHub'];
  const tradeHubRow = tradeHubTable?.['t1'];
  if (tradeHubRow) {
    candidateRows.push(tradeHubRow as Record<string, unknown>);
    seenBuildings.add('tradeHub');
  }

  if (colonyStage !== undefined && fs.has('W02')) {
    for (const stageRow of STAGE_BUILDING_ROWS) {
      const bKey = String(stageRow.building);
      if (!seenBuildings.has(bKey)) {
        candidateRows.push(stageRow);
        seenBuildings.add(bKey);
      }
    }
  }

  const cards: BuildingCardModel[] = [];
  for (const row of candidateRows) {
    const itemStage = resolveRowUnlockStage(row);
    if (row !== tradeHubRow && colonyStage !== undefined && itemStage > colonyStage + 1) {
      continue;
    }
    cards.push(makeCard(row, view, fs, colonyStage, data));
  }

  return cards;
}
