import type { FlagSet } from '@terra/contracts';
import { ENTITY_KIND } from '@terra/sim';
import { clientDataFor } from '../../core/flags/data';
import type { GameView } from '../../core/registry/types';
import { ENTITY_STRIDE } from '../../store/replica/viewCodec';

export interface UnitCardModel {
  id: string;
  unit: 'harvester';
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

export interface SupplySummary {
  used: number;
  cap: number;
}

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

export function resolveSupply(view?: GameView): SupplySummary {
  if (!view) return { used: 0, cap: 10 };
  const v = view as {
    colonies?: Array<{
      supply?: { used?: number; cap?: number };
      unitQueue?: Array<{ state?: string }>;
      [key: string]: unknown;
    }>;
    supply?: { used?: number; cap?: number };
    entities?: Float32Array | Array<{ kind?: number; unit?: string; hp?: number }>;
    blobs?: {
      hubProduction?: { entries?: Array<{ state?: string }> };
    };
  };

  const colSupply = v.colonies?.[0]?.supply ?? v.supply;
  if (typeof colSupply?.used === 'number' && typeof colSupply?.cap === 'number') {
    return { used: colSupply.used, cap: colSupply.cap };
  }

  let activeHarvesters = 0;
  if (v.entities) {
    if (v.entities instanceof Float32Array) {
      for (let i = 0; i < v.entities.length; i += ENTITY_STRIDE) {
        if (v.entities[i + 1] === ENTITY_KIND.harvester && v.entities[i + 8] > 0) {
          activeHarvesters++;
        }
      }
    } else if (Array.isArray(v.entities)) {
      for (const e of v.entities) {
        if (
          (e.kind === ENTITY_KIND.harvester || e.unit === 'harvester') &&
          (e.hp === undefined || e.hp > 0)
        ) {
          activeHarvesters++;
        }
      }
    }
  }

  const queue = v.colonies?.[0]?.unitQueue ?? v.blobs?.hubProduction?.entries ?? [];
  const inProgress = queue.filter((en) => en.state === 'in_progress').length;

  return { used: activeHarvesters + inProgress, cap: 10 };
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

  const harvesterRow = unitsTable['harvester'];
  if (!harvesterRow) return [];

  const buildS = typeof harvesterRow.designBuildS === 'number'
    ? harvesterRow.designBuildS
    : typeof harvesterRow.buildS === 'number'
      ? Math.round(harvesterRow.buildS / 5)
      : 10;
  const powerDrain = typeof harvesterRow.powerDrainPerS === 'number' ? harvesterRow.powerDrainPerS : 1.5;
  const cost = (harvesterRow.cost as Record<string, number>) ?? {};

  const costPills: string[] = [];
  for (const [res, amt] of Object.entries(cost)) {
    if (amt > 0) {
      costPills.push(`${amt} ${formatResourceLabel(res)}`);
    }
  }
  const costSummary = costPills.join(' · ');

  return [
    {
      id: String(harvesterRow.id ?? 'harvester'),
      unit: 'harvester',
      label: typeof harvesterRow.label === 'string' ? harvesterRow.label : 'Harvester Drone',
      archetype: typeof harvesterRow.archetype === 'string' ? harvesterRow.archetype : 'robot.miner',
      tier: typeof harvesterRow.tier === 'number' ? harvesterRow.tier : 1,
      buildS,
      supply: typeof harvesterRow.supply === 'number' ? harvesterRow.supply : 1,
      powerDrainPerS: powerDrain,
      powerText: formatPower(powerDrain),
      cost,
      costSummary,
      costPills,
    },
  ];
}
