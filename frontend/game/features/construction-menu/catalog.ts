import type { FlagSet } from '@terra/contracts';
import { ENTITY_KIND, formatUnlockAtTooltip, getItemUnlockStage, getStageSpec, TICK_MS } from '@terra/sim';
import { clientDataFor } from '../../core/flags/data';
import type { GameView } from '../../core/registry/types';
import { ENTITY_STRIDE } from '../../store/replica/viewCodec';

export type BuildingKind =
  | 'commandHub'
  | 'metalsExtractor'
  | 'solar'
  | 'builder'
  | 'pylon'
  | 'depot'
  | 'roboticsFactory'
  | 'turret'
  | 'outpostBeacon'
  | 'tradeHub';

export interface BuildingCardModel {
  id: string;
  building: BuildingKind;
  label: string;
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
  metalsExtractor: 'Metals Extractor',
  solar: 'Solar Collector Array',
  builder: 'Builder',
  pylon: 'Pylon',
  depot: 'Depot',
  roboticsFactory: 'Robotics Factory',
  turret: 'Turret',
  outpostBeacon: 'Outpost Beacon',
  tradeHub: 'Trade Hub',
};

const STAGE_BUILDING_ROWS: readonly Record<string, unknown>[] = [
  {
    id: 'builder',
    building: 'builder',
    label: 'Builder',
    tier: 1,
    unlockStage: 2,
    footprintW: 1,
    footprintD: 1,
    designBuildS: 12,
    cost: { 'metals.t1': 55, 'minerals.t1': 25, 'bio.biomass': 10, 'bio.water': 0 },
    powerDrainPerS: 2,
  },
  {
    id: 'pylon',
    building: 'pylon',
    label: 'Pylon',
    tier: 1,
    unlockStage: 2,
    footprintW: 1,
    footprintD: 1,
    designBuildS: 6,
    cost: { 'metals.t1': 20, 'minerals.t1': 15, 'bio.biomass': 0, 'bio.water': 0 },
    powerDrainPerS: 0,
  },
  {
    id: 'depot',
    building: 'depot',
    label: 'Depot',
    tier: 1,
    unlockStage: 2,
    footprintW: 2,
    footprintD: 2,
    designBuildS: 16,
    cost: { 'metals.t1': 80, 'minerals.t1': 40, 'bio.biomass': 0, 'bio.water': 0 },
    powerDrainPerS: 2,
  },
  {
    id: 'roboticsFactory',
    building: 'roboticsFactory',
    label: 'Robotics Factory',
    tier: 1,
    unlockStage: 3,
    footprintW: 3,
    footprintD: 3,
    designBuildS: 25,
    cost: { 'metals.t1': 150, 'minerals.t1': 100, 'bio.biomass': 25, 'bio.water': 25 },
    powerDrainPerS: 8,
  },
  {
    id: 'turret',
    building: 'turret',
    label: 'Turret',
    tier: 1,
    unlockStage: 3,
    footprintW: 1,
    footprintD: 1,
    designBuildS: 12,
    cost: { 'metals.t1': 70, 'minerals.t1': 40, 'bio.biomass': 0, 'bio.water': 0 },
    powerDrainPerS: 4,
  },
  {
    id: 'outpostBeacon',
    building: 'outpostBeacon',
    label: 'Outpost Beacon',
    tier: 1,
    unlockStage: 4,
    footprintW: 1,
    footprintD: 1,
    designBuildS: 15,
    cost: { 'metals.t1': 90, 'minerals.t1': 60, 'bio.biomass': 0, 'bio.water': 0 },
    powerDrainPerS: 3,
  },
  {
    id: 'tradeHub',
    building: 'tradeHub',
    label: 'Trade Hub',
    tier: 1,
    unlockStage: 4,
    footprintW: 2,
    footprintD: 2,
    designBuildS: 20,
    cost: { 'metals.t1': 120, 'minerals.t1': 80, 'bio.biomass': 20, 'bio.water': 20 },
    powerDrainPerS: 5,
  },
];

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
  const key = String(row.building ?? row.id ?? '');
  return getItemUnlockStage(key);
}

function formatPower(row: Record<string, unknown>): string {
  const gen = typeof row.founderCoreGenPerS === 'number' ? row.founderCoreGenPerS : 0;
  const drain = typeof row.powerDrainPerS === 'number' ? row.powerDrainPerS : 0;
  const net = typeof row.netOutputPerS === 'number' ? row.netOutputPerS : 0;

  if (gen > 0 && drain > 0) {
    return `+${gen} / −${drain} E/s`;
  }
  if (net > 0) {
    return `+${net} E/s`;
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

function makeCard(
  row: Record<string, unknown>,
  view: GameView | undefined,
  fs: FlagSet,
  colonyStage: number | undefined,
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

  const stageLocked = isStageLocked(unlockStage, colonyStage);
  let disabled = false;
  let disabledReason: string | undefined;
  let unlockConditionText: string | undefined;
  let unlockDetailText: string | undefined;

  if (building === 'commandHub' && isHubBuilt(view)) {
    disabled = true;
    disabledReason = 'Already built';
  } else if (stageLocked) {
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
  const colonyStage = resolveColonyUnlockStage(view);
  const candidateRows: Record<string, unknown>[] = [];
  const seenBuildings = new Set<string>();

  const hubRow = data.tables['hub']?.['t1'];
  if (hubRow) {
    candidateRows.push(hubRow as Record<string, unknown>);
    seenBuildings.add(String(hubRow.building));
  }

  const econTable = data.tables['economyT1Basic'];
  if (econTable) {
    const buildingRows = Object.values(econTable).filter((r) => r.kind === 'building');
    for (const row of buildingRows) {
      candidateRows.push(row as Record<string, unknown>);
      seenBuildings.add(String(row.building));
    }
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
    if (colonyStage !== undefined && itemStage > colonyStage + 1) {
      continue;
    }
    cards.push(makeCard(row, view, fs, colonyStage));
  }

  return cards;
}
