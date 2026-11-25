import { STAGE_BUILDING_ROWS } from './stageRows';
import type { FlagSet } from '@terra/contracts';
import { ENTITY_KIND, evaluateTradeHubUnlock, type CompiledDataLike, formatUnlockAtTooltip, getStageSpec, resolveItemUnlockStage, TICK_MS } from '@terra/sim';
import { clientDataFor, formatResourceLabel, toFlagSet } from '../../core/flags/data';
import type { GameView } from '../../core/registry/types';
import { ENTITY_STRIDE } from '../../store/replica/viewCodec';

export { formatResourceLabel };

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
  | 'depot'
  | 'roboticsFactory'
  | 'droneControlArray'
  | 'autocannon'
  | 'laserTower'
  | 'turret'
  | 'outpostBeacon'
  | 'sensorArray'
  | 'tradeHub';

/** Welcome catalog fields the build menu may overlay onto a card. */
export interface CatalogBalance {
  readonly building: string;
  readonly tier: number;
  readonly footprintW: number;
  readonly footprintD: number;
  readonly buildS: number;
  readonly powerDrainPerS: number;
  readonly powerGenPerS: number;
  readonly cost: { readonly [key: string]: number | undefined };
  /** Hub founder-core rows report generation and drain together. */
  readonly hqOnly?: boolean;
}

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
  archetype: string;
  disabled: boolean;
  disabledReason?: string;
}

const LABELS: Record<string, string> = {
  commandHub: 'Command Hub',
  metalsExtractor: 'Resource Extractor',
  solar: 'Solar Collector Array',
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
  sensorArray: 'Sensor Array',
};

const numField = (row: Record<string, unknown>, key: string): number =>
  typeof row[key] === 'number' && Number.isFinite(row[key]) ? (row[key] as number) : 0;

/** Generator net at full output (E/s): `grossOutputPerS − internalDrainPerS` when the row has a gross, else `netOutputPerS`. */
function generatorNet(row: Record<string, unknown>): number {
  const gross = numField(row, 'grossOutputPerS');
  if (gross > 0) return Number((gross - numField(row, 'internalDrainPerS')).toFixed(2));
  return numField(row, 'netOutputPerS');
}

function resolveEffectiveColonyIndex(view?: GameView, colonyIndex = 0): number {
  if (!view) return colonyIndex;
  const v = view as { colonyId?: number; colonyIndex?: number };
  return v.colonyIndex ?? v.colonyId ?? colonyIndex;
}

function findColonyInView<T extends { index?: number }>(
  colonies: T[] | undefined,
  idx: number,
): T | undefined {
  if (!Array.isArray(colonies)) return undefined;
  return colonies.find((c) => c?.index === idx) ?? colonies[idx] ?? (idx === 0 ? colonies[0] : undefined);
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
  const idx = resolveEffectiveColonyIndex(view, colonyIndex);
  const col = findColonyInView(v.colonies, idx);
  const val = col?.unlockStage ?? col?.stage ?? v.unlockStage ?? v.stage;
  return typeof val === 'number' && Number.isFinite(val) ? val : undefined;
}

function hasExplicitUnlockStage(view?: GameView, colonyIndex = 0): boolean {
  if (!view) return false;
  const v = view as {
    colonyId?: number;
    colonyIndex?: number;
    unlockStage?: number;
    colonies?: Array<{ index?: number; unlockStage?: number }>;
  };
  const idx = resolveEffectiveColonyIndex(view, colonyIndex);
  const col = findColonyInView(v.colonies, idx);
  return typeof col?.unlockStage === 'number' || typeof v.unlockStage === 'number';
}

export function formatUnlockDetail(stage: number): string {
  const spec = getStageSpec(stage);
  if (!spec) return formatUnlockAtTooltip(stage);
  if (stage === 2) {
    return 'Unlocks at S2: extractor + generator complete · 2 min';
  }
  return formatUnlockAtTooltip(stage);
}

/** Stage `checkItemUnlockStage` enforces. A balance row's `unlockStage` is not a second rule. */
function resolveRowUnlockStage(row: Record<string, unknown>): number {
  if (typeof row.unlockStage === 'number' && Number.isFinite(row.unlockStage)) {
    return row.unlockStage;
  }
  if (typeof row.unlock === 'string') {
    const m = /^S(\d+)$/i.exec(row.unlock.trim());
    if (m) return Number(m[1]);
  }
  return resolveItemUnlockStage(String(row.building ?? row.id ?? ''));
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

function isHubBuilt(view?: GameView, colonyIndex = 0): boolean {
  if (!view) return false;
  const v = view as {
    colonyId?: number;
    colonyIndex?: number;
    count?: number;
    entities?: Float32Array | Array<{ kind?: number; owner?: number; hp?: number; hpMax?: number }>;
    colonies?: Array<{ index?: number; hubBuilt?: boolean; [k: string]: unknown }>;
    hubBuilt?: boolean;
  };
  if (v.hubBuilt === true) return true;
  const idx = resolveEffectiveColonyIndex(view, colonyIndex);
  const col = findColonyInView(v.colonies, idx);
  if (col?.hubBuilt === true) return true;
  if (v.entities) {
    if (v.entities instanceof Float32Array) {
      const limit =
        typeof v.count === 'number' && Number.isFinite(v.count)
          ? Math.min(v.entities.length, v.count * ENTITY_STRIDE)
          : v.entities.length;
      for (let i = 0; i < limit; i += ENTITY_STRIDE) {
        const hp = v.entities[i + 8];
        const hpMax = v.entities[i + 9];
        if (v.entities[i + 1] === ENTITY_KIND.commandHub && v.entities[i + 2] === idx && !(hpMax > 0 && hp <= 0)) {
          return true;
        }
      }
    } else if (Array.isArray(v.entities)) {
      for (const e of v.entities) {
        if (!e || e.kind !== ENTITY_KIND.commandHub) continue;
        if ((e.owner ?? 0) !== idx) continue;
        if (typeof e.hpMax === 'number' && e.hpMax > 0 && typeof e.hp === 'number' && e.hp <= 0) continue;
        return true;
      }
    }
  }
  return false;
}

function hasInsufficientStock(cost: Record<string, number>, view?: GameView, colonyIndex = 0): boolean {
  if (!view) return false;
  const v = view as {
    colonyId?: number;
    colonyIndex?: number;
    colonies?: Array<{ index?: number; stock?: Record<string, number> }>;
    stock?: Record<string, number>;
  };
  const idx = resolveEffectiveColonyIndex(view, colonyIndex);
  const col = findColonyInView(v.colonies, idx);
  const stock = col?.stock ?? v.stock;
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

function costFromSpec(cost: CatalogBalance['cost']): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(cost)) {
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

/** Gen when the spec produces power, otherwise the drain. */
function specPowerText(spec: Pick<CatalogBalance, 'powerGenPerS' | 'powerDrainPerS' | 'hqOnly'>): string {
  if (spec.hqOnly && spec.powerGenPerS > 0 && spec.powerDrainPerS > 0) {
    return `+${spec.powerGenPerS} / −${spec.powerDrainPerS} E/s`;
  }
  if (spec.powerGenPerS > 0) return `+${spec.powerGenPerS} E/s`;
  if (spec.powerDrainPerS > 0) return `−${spec.powerDrainPerS} E/s`;
  return '0 E/s';
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
  colonyIndex = 0,
  spec?: CatalogBalance,
): BuildingCardModel {
  const building = String(row.building) as BuildingKind;
  const label = typeof row.label === 'string' ? row.label : (LABELS[building] ?? building);
  const tier = typeof row.tier === 'number' ? row.tier : 1;
  const unlockStage = resolveRowUnlockStage(row);
  const defaultFp = typeof row.footprint === 'number' ? row.footprint : 1;
  const footprintW = spec ? spec.footprintW : (typeof row.footprintW === 'number' ? row.footprintW : defaultFp);
  const footprintD = spec ? spec.footprintD : (typeof row.footprintD === 'number' ? row.footprintD : defaultFp);
  const footprintText = `${footprintW}×${footprintD}`;
  const designBuildS = spec
    ? spec.buildS
    : (typeof row.designBuildS === 'number' ? row.designBuildS : (Number(row.buildS ?? 0) * TICK_MS) / 1000);
  const hqBuildS = Number((designBuildS / 1.5).toFixed(1));
  const cost = spec ? costFromSpec(spec.cost) : ((row.cost as Record<string, number>) ?? {});
  const powerText = spec ? specPowerText(spec) : formatPower(row);

  const effColonyIndex = resolveEffectiveColonyIndex(view, colonyIndex);
  const tradeUnlock =
    building === 'tradeHub' && fs.has('W10') ? evaluateTradeHubUnlock(view, effColonyIndex, data) : undefined;
  const stageLocked = tradeUnlock ? !tradeUnlock.unlocked : isStageLocked(unlockStage, colonyStage);
  let disabled = false;
  let disabledReason: string | undefined;
  let unlockConditionText: string | undefined;
  let unlockDetailText: string | undefined;

  if (building === 'commandHub' && isHubBuilt(view, effColonyIndex)) {
    disabled = true;
    disabledReason = 'Already built';
  } else if (tradeUnlock && !tradeUnlock.unlocked) {
    disabled = true;
    disabledReason = tradeUnlock.hint;
  } else if (!tradeUnlock && stageLocked) {
    disabled = true;
    unlockConditionText = formatUnlockAtTooltip(unlockStage);
    unlockDetailText = formatUnlockDetail(unlockStage);
    const useLegacyLockedLabel = !fs.has('W08') && colonyStage === 0 && !hasExplicitUnlockStage(view, effColonyIndex);
    disabledReason = useLegacyLockedLabel ? 'Locked' : unlockConditionText;
  } else if (hasInsufficientStock(cost, view, effColonyIndex)) {
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
    archetype: typeof row.archetype === 'string' ? row.archetype : `building.${building}`,
    disabled,
    disabledReason,
  };
}

export function buildConstructionCatalog(
  flags: ReadonlySet<string> | FlagSet,
  view?: GameView,
  colonyIndex = 0,
  specs?: readonly CatalogBalance[] | null,
): BuildingCardModel[] {
  const fs = toFlagSet(flags);
  const data = clientDataFor(fs);
  const isLiveGameView = Boolean(view && typeof view === 'object' && 'planet' in view && (view as { planet?: unknown }).planet !== undefined);
  const colonyStage = !fs.has('W08') && isLiveGameView ? undefined : resolveColonyUnlockStage(view, colonyIndex);
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
    const tier = typeof row.tier === 'number' ? row.tier : 1;
    const spec = specs?.find((s) => s.building === String(row.building) && s.tier === tier);
    cards.push(makeCard(row, view, fs, colonyStage, data, colonyIndex, spec));
  }

  return cards;
}
