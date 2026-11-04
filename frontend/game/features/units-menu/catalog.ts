import type { FlagSet } from '@terra/contracts';
import { ENTITY_KIND, formatUnlockAtTooltip, getItemUnlockStage, getStageSpec } from '@terra/sim';
import { clientDataFor } from '../../core/flags/data';
import type { GameView } from '../../core/registry/types';
import { ENTITY_STRIDE } from '../../store/replica/viewCodec';

export type UnitKind = 'harvester' | 'builder' | 'scout' | 'guard' | 'combatEngineer' | 'hauler';

export interface UnitCardModel {
  id: string;
  unit: UnitKind;
  label: string;
  archetype: string;
  tier: number;
  unlockStage: number;
  stageLocked: boolean;
  disabled: boolean;
  disabledReason?: string;
  unlockConditionText?: string;
  unlockDetailText?: string;
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

const STAGE_UNIT_ROWS: readonly Record<string, unknown>[] = [
  {
    id: 'builder',
    unit: 'builder',
    label: 'Builder',
    archetype: 'robot.builder',
    tier: 1,
    unlockStage: 2,
    designBuildS: 12,
    supply: 1,
    powerDrainPerS: 2,
    cost: { 'metals.t1': 55, 'minerals.t1': 25, 'bio.biomass': 10, 'bio.water': 0 },
  },
  {
    id: 'scout',
    unit: 'scout',
    label: 'Scout',
    archetype: 'robot.scout',
    tier: 1,
    unlockStage: 3,
    designBuildS: 12,
    supply: 1,
    powerDrainPerS: 1.5,
    cost: { 'metals.t1': 50, 'minerals.t1': 20, 'bio.biomass': 10, 'bio.water': 0 },
  },
  {
    id: 'guard',
    unit: 'guard',
    label: 'Guard',
    archetype: 'robot.combat',
    tier: 1,
    unlockStage: 3,
    designBuildS: 15,
    supply: 2,
    powerDrainPerS: 2,
    cost: { 'metals.t1': 75, 'minerals.t1': 35, 'bio.biomass': 15, 'bio.water': 0 },
  },
  {
    id: 'combatEngineer',
    unit: 'combatEngineer',
    label: 'Combat Engineer',
    archetype: 'robot.engineer',
    tier: 1,
    unlockStage: 4,
    designBuildS: 16,
    supply: 2,
    powerDrainPerS: 2,
    cost: { 'metals.t1': 80, 'minerals.t1': 40, 'bio.biomass': 15, 'bio.water': 0 },
  },
  {
    id: 'hauler',
    unit: 'hauler',
    label: 'Hauler',
    archetype: 'robot.hauler',
    tier: 1,
    unlockStage: 4,
    designBuildS: 14,
    supply: 1,
    powerDrainPerS: 1.5,
    cost: { 'metals.t1': 60, 'minerals.t1': 25, 'bio.biomass': 10, 'bio.water': 0 },
  },
];

function resolveColonyUnlockStage(view?: GameView): number | undefined {
  if (!view) return undefined;
  const v = view as {
    colonyId?: number;
    colonyIndex?: number;
    unlockStage?: number;
    stage?: number;
    colonies?: Array<{ index?: number; unlockStage?: number; stage?: number }>;
  };
  const idx = v.colonyIndex ?? v.colonyId ?? 0;
  const col = v.colonies?.find((c) => c?.index === idx) ?? v.colonies?.[idx] ?? v.colonies?.[0];
  const val = col?.unlockStage ?? col?.stage ?? v.unlockStage ?? v.stage;
  return typeof val === 'number' && Number.isFinite(val) ? val : undefined;
}

function formatUnlockDetail(stage: number): string {
  const spec = getStageSpec(stage);
  if (!spec) return formatUnlockAtTooltip(stage);
  if (stage === 2) {
    return 'Unlocks at S2: extractor + generator complete · 2 min';
  }
  return formatUnlockAtTooltip(stage);
}

function resolveUnitUnlockStage(row: Record<string, unknown>): number {
  if (typeof row.unlockStage === 'number' && Number.isFinite(row.unlockStage)) {
    return row.unlockStage;
  }
  return getItemUnlockStage(String(row.unit ?? row.id ?? ''));
}

function makeUnitCard(row: Record<string, unknown>, colonyStage: number | undefined): UnitCardModel {
  const unit = String(row.unit ?? row.id ?? 'harvester') as UnitKind;
  const unlockStage = resolveUnitUnlockStage(row);
  const stageLocked = colonyStage !== undefined && colonyStage < unlockStage;
  const buildS = typeof row.designBuildS === 'number'
    ? row.designBuildS
    : typeof row.buildS === 'number'
      ? Math.round(row.buildS / 5)
      : 10;
  const powerDrain = typeof row.powerDrainPerS === 'number' ? row.powerDrainPerS : 1.5;
  const cost = (row.cost as Record<string, number>) ?? {};

  const costPills: string[] = [];
  for (const [res, amt] of Object.entries(cost)) {
    if (amt > 0) {
      costPills.push(`${amt} ${formatResourceLabel(res)}`);
    }
  }
  const costSummary = costPills.join(' · ');
  const unlockConditionText = stageLocked ? formatUnlockAtTooltip(unlockStage) : undefined;
  const unlockDetailText = stageLocked ? formatUnlockDetail(unlockStage) : undefined;

  return {
    id: String(row.id ?? unit),
    unit,
    label: typeof row.label === 'string' ? row.label : unit,
    archetype: typeof row.archetype === 'string' ? row.archetype : 'robot.miner',
    tier: typeof row.tier === 'number' ? row.tier : 1,
    unlockStage,
    stageLocked,
    disabled: stageLocked,
    disabledReason: unlockConditionText,
    unlockConditionText,
    unlockDetailText,
    buildS,
    supply: typeof row.supply === 'number' ? row.supply : 1,
    powerDrainPerS: powerDrain,
    powerText: formatPower(powerDrain),
    cost,
    costSummary,
    costPills,
  };
}

export function buildUnitsCatalog(
  flags: ReadonlySet<string> | FlagSet,
  view?: GameView,
): UnitCardModel[] {
  const fs = toFlagSet(flags);
  if (!fs.has('W02')) return [];

  const data = clientDataFor(fs);
  const unitsTable = data.tables['unitsWorkersBasic'];
  if (!unitsTable) return [];

  const harvesterRow = unitsTable['harvester'];
  if (!harvesterRow) return [];

  const isLiveGameView = Boolean(view && typeof view === 'object' && 'planet' in view && (view as { planet?: unknown }).planet !== undefined);
  const colonyStage = !fs.has('W08') && isLiveGameView ? undefined : resolveColonyUnlockStage(view);
  const candidateRows: Record<string, unknown>[] = [harvesterRow as Record<string, unknown>];
  if (colonyStage !== undefined) {
    candidateRows.push(...STAGE_UNIT_ROWS);
  }

  const cards: UnitCardModel[] = [];
  for (const row of candidateRows) {
    const itemStage = resolveUnitUnlockStage(row);
    if (colonyStage !== undefined && itemStage > colonyStage + 1) {
      continue;
    }
    cards.push(makeUnitCard(row, colonyStage));
  }
  return cards;
}
