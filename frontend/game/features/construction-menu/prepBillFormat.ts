import {
  PREP,
  TERRAIN,
  planPrepJobs,
  summarizePrepJobs,
  type CompiledDataLike,
  type PlacementBill,
} from '@terra/sim';
import { formatCost } from '../shared/resources';
import type { PlacementGhostTile } from './PlacementGhost';

const LEGACY_PREP_LABELS: Record<string, string> = {
  prepare: 'Prepare',
  'clear + prepare': 'Clear + Prepare',
  'break + prepare': 'Break + Prepare',
  'flatten + prepare': 'Flatten + Prepare',
};

const W05_OP_ORDER = ['level', 'fill', 'reclaim', 'deepReclaim', 'clear', 'break', 'grade'] as const;

const W05_OP_LABELS: Readonly<Record<string, string>> = {
  level: 'Level',
  fill: 'Fill',
  reclaim: 'Reclaim',
  deepReclaim: 'Deep Reclaim',
  clear: 'Clear',
  break: 'Break',
  grade: 'Grade',
};

export function isW05LinkedPrepActive(flags: { has(flag: string): boolean }, data?: CompiledDataLike): boolean {
  if (flags.has('W05')) return true;
  return Boolean((data?.tables?.opsBasic as Record<string, unknown> | undefined)?.level);
}

export function getTilePrepOp(terrain: number, prep: number, w05Active = false): string | undefined {
  if (prep === PREP.prepared || prep === PREP.irrigated || prep === PREP.living) return undefined;
  if (!w05Active) return 'prepare';
  if (terrain === TERRAIN.slope) return 'level';
  if (terrain === TERRAIN.hole) return 'fill';
  if (terrain === TERRAIN.shallow) return 'reclaim';
  if (terrain === TERRAIN.deep) return 'deepReclaim';
  if (terrain === TERRAIN.forest) return 'clear';
  if (terrain === TERRAIN.rock) return 'break';
  return 'grade';
}

export function formatPrepBillText(bill: Record<string, number>): string {
  const entries = Object.entries(bill);
  if (entries.length === 0) return 'Site prepared';
  const order: Record<string, number> = {
    'clear + prepare': 1,
    'break + prepare': 2,
    'flatten + prepare': 3,
    prepare: 4,
  };
  entries.sort((a, b) => (order[a[0]] ?? 99) - (order[b[0]] ?? 99));
  return `Prep: ${entries.map(([op, count]) => `${count}× ${LEGACY_PREP_LABELS[op] ?? (op.charAt(0).toUpperCase() + op.slice(1))}`).join(', ')}`;
}

export interface GhostPrepBillSummary {
  prepBill: Record<string, number>;
  prepBillText: string;
  prepEnergyE?: number;
  prepTimeS?: number;
  prepCost?: Record<string, number>;
}

export function resolveGhostPrepBill(
  tiles: readonly PlacementGhostTile[],
  legacyPrepBill: Record<string, number>,
  simBill: PlacementBill | undefined,
  data: CompiledDataLike,
  w05Active: boolean,
): GhostPrepBillSummary {
  if (!w05Active) {
    return {
      prepBill: legacyPrepBill,
      prepBillText: formatPrepBillText(legacyPrepBill),
    };
  }

  const inBounds = tiles.filter((t) => t.tileIdx >= 0);
  const computed = summarizePrepJobs(planPrepJobs(inBounds, data), data);
  const useSim = simBill && (simBill.totalEnergyE > 0 || computed.totalEnergyE === 0);
  const ops = useSim ? simBill.ops : computed.countsByOp;
  const totalEnergyE = useSim ? simBill.totalEnergyE : computed.totalEnergyE;
  const baseSeconds = useSim ? simBill.baseSeconds : computed.baseSeconds;
  const rawCost = (useSim ? simBill.cost : computed.cost) as Record<string, number> | undefined;

  const prepBill: Record<string, number> = {};
  const opParts: string[] = [];
  for (const op of W05_OP_ORDER) {
    const count = Number((ops as unknown as Record<string, number | undefined>)[op] ?? 0);
    if (count > 0) {
      prepBill[op] = count;
      opParts.push(`${W05_OP_LABELS[op] ?? op} ×${count}`);
    }
  }

  if (opParts.length === 0) {
    return {
      prepBill: {},
      prepBillText: 'Site prepared',
      prepEnergyE: 0,
      prepTimeS: 0,
    };
  }

  const costText = rawCost ? formatCost(rawCost) : '';
  const prepBillText = `Prep: ${opParts.join(' + ')} · ${totalEnergyE} E · ${baseSeconds}s${costText ? ` · ${costText}` : ''}`;
  return {
    prepBill,
    prepBillText,
    prepEnergyE: totalEnergyE,
    prepTimeS: baseSeconds,
    ...(rawCost && Object.keys(rawCost).length > 0 ? { prepCost: { ...rawCost } } : {}),
  };
}
