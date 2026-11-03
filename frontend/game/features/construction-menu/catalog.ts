import type { FlagSet } from '@terra/contracts';
import { ENTITY_KIND, TICK_MS } from '@terra/sim';
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
  | 'petroleumWell';

export interface BuildingCardModel {
  id: string;
  building: BuildingKind;
  label: string;
  tier: number;
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

function isStageLocked(unlockStage: unknown, view?: GameView): boolean {
  if (unlockStage === undefined || unlockStage === null || !view) return false;
  const required = Number(unlockStage);
  if (!Number.isFinite(required)) return false;
  const v = view as {
    colonies?: Array<{ stage?: number }>;
    stage?: number;
  };
  const colonyStage = v.colonies?.[0]?.stage ?? v.stage;
  if (typeof colonyStage !== 'number') return false;
  return colonyStage < required;
}

function makeCard(row: Record<string, unknown>, view?: GameView): BuildingCardModel {
  const building = String(row.building) as BuildingKind;
  const label = typeof row.label === 'string' ? row.label : (LABELS[building] ?? building);
  const tier = typeof row.tier === 'number' ? row.tier : 1;
  const defaultFp = typeof row.footprint === 'number' ? row.footprint : 1;
  const footprintW = typeof row.footprintW === 'number' ? row.footprintW : defaultFp;
  const footprintD = typeof row.footprintD === 'number' ? row.footprintD : defaultFp;
  const footprintText = `${footprintW}×${footprintD}`;
  const designBuildS =
    typeof row.designBuildS === 'number' ? row.designBuildS : (Number(row.buildS ?? 0) * TICK_MS) / 1000;
  const hqBuildS = Number((designBuildS / 1.5).toFixed(1));
  const cost = (row.cost as Record<string, number>) ?? {};
  const powerText = formatPower(row);

  let disabled = false;
  let disabledReason: string | undefined;

  if (building === 'commandHub' && isHubBuilt(view)) {
    disabled = true;
    disabledReason = 'Already built';
  } else if (isStageLocked(row.unlockStage, view)) {
    disabled = true;
    disabledReason = 'Locked';
  } else if (hasInsufficientStock(cost, view)) {
    disabled = true;
    disabledReason = 'Insufficient resources';
  }

  return {
    id: String(row.id),
    building,
    label,
    tier,
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
  const data = clientDataFor(toFlagSet(flags));
  const cards: BuildingCardModel[] = [];

  const hubTable = data.tables['hub'];
  const hubRow = hubTable?.['t1'];
  if (hubRow) {
    cards.push(makeCard(hubRow as Record<string, unknown>, view));
  }

  const econTable = data.tables['economyT1Basic'];
  if (econTable) {
    const buildingRows = Object.values(econTable).filter((r) => r.kind === 'building');
    for (const row of buildingRows) {
      cards.push(makeCard(row as Record<string, unknown>, view));
    }
  }

  const gridTable = data.tables['grid'];
  if (gridTable) {
    const gridBuildingRows = Object.values(gridTable).filter((r) => r.kind === 'building');
    for (const row of gridBuildingRows) {
      cards.push(makeCard(row as Record<string, unknown>, view));
    }
  }

  return cards;
}
