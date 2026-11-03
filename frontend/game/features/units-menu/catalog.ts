import type { FlagSet } from '@terra/contracts';
import type { ColonySupply } from '@terra/sim';
import { clientDataFor } from '../../core/flags/data';
import type { GameView } from '../../core/registry/types';
import { readColonySupply } from '../shared/supply';

export interface UnitCardModel {
  id: string;
  unit: 'harvester' | 'builder';
  label: string;
  archetype: string;
  tier: number;
  buildS: number;
  supply: number;
  powerDrainPerS: number;
  powerText: string;
  cost: Record<string, number>;
  costSummary: string;
  costPills: string[];
}

export type SupplySummary = ColonySupply;

const RESOURCE_LABELS: Record<string, string> = {
  'metals.t1': 'Metals',
  'minerals.t1': 'Minerals',
  'bio.biomass': 'Biomass',
  'bio.water': 'Water',
};

export function formatResourceLabel(res: string): string {
  if (RESOURCE_LABELS[res]) return RESOURCE_LABELS[res];
  const parts = res.split('.');
  const last = parts[parts.length - 1];
  return last.charAt(0).toUpperCase() + last.slice(1);
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

function formatPower(drain: number): string {
  if (drain > 0) return `−${drain} E/s`;
  return '0 E/s';
}

/**
 * The own colony's unit supply as the host computed it (`colony.supply`, `shared/sim/src/systems/supply`), or `null`
 * before the host sent one. The client never counts units itself.
 */
export function resolveSupply(view: GameView | undefined, colonyIndex = 0): SupplySummary | null {
  return readColonySupply(view, colonyIndex);
}

function toUnitCardModel(
  row: Record<string, unknown>,
  unit: 'harvester' | 'builder',
  fallbackLabel: string,
  fallbackArchetype: string,
  fallbackBuildS: number,
  fallbackDrain: number,
): UnitCardModel {
  const buildS = typeof row.designBuildS === 'number'
    ? row.designBuildS
    : typeof row.buildS === 'number'
      ? Math.round(row.buildS / 5)
      : fallbackBuildS;
  const powerDrain = typeof row.powerDrainPerS === 'number' ? row.powerDrainPerS : fallbackDrain;
  const cost = (row.cost as Record<string, number>) ?? {};
  const costPills: string[] = [];
  for (const [res, amt] of Object.entries(cost)) {
    if (amt > 0) {
      costPills.push(`${amt} ${formatResourceLabel(res)}`);
    }
  }
  return {
    id: String(row.id ?? unit),
    unit,
    label: typeof row.label === 'string' ? row.label : fallbackLabel,
    archetype: typeof row.archetype === 'string' ? row.archetype : fallbackArchetype,
    tier: typeof row.tier === 'number' ? row.tier : 1,
    buildS,
    supply: typeof row.supply === 'number' ? row.supply : 1,
    powerDrainPerS: powerDrain,
    powerText: formatPower(powerDrain),
    cost,
    costSummary: costPills.join(' · '),
    costPills,
  };
}

export function buildUnitsCatalog(
  flags: ReadonlySet<string> | FlagSet,
  _view?: GameView,
): UnitCardModel[] {
  const fs = toFlagSet(flags);
  if (!fs.has('W02')) return [];

  const data = clientDataFor(fs);
  const unitsTable = data.tables['unitsWorkersBasic'];
  if (!unitsTable) return [];

  const cards: UnitCardModel[] = [];
  const harvesterRow = unitsTable['harvester'];
  if (harvesterRow) {
    cards.push(toUnitCardModel(harvesterRow, 'harvester', 'Harvester Drone', 'robot.miner', 10, 1.5));
  }

  if (fs.has('W03')) {
    const builderRow = data.tables['grid']?.['builder'] ?? unitsTable['builder'];
    if (builderRow) {
      cards.push(toUnitCardModel(builderRow, 'builder', 'Builder Drone', 'robot.worker_biped', 12, 2.0));
    }
  }

  return cards;
}
