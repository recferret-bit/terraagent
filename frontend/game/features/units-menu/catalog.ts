import type { FlagSet } from '@terra/contracts';
import type { ColonySupply } from '@terra/sim';
import { formatUnlockAtTooltip, getItemUnlockStage, getStageSpec } from '@terra/sim';
import { clientDataFor, formatResourceLabel, toFlagSet } from '../../core/flags/data';
import type { GameView } from '../../core/registry/types';
import { readColonySupply } from '../shared/supply';

export { formatResourceLabel };

export type UnitKind = 'worker' | 'scout' | 'guard' | 'combatEngineer' | 'hauler' | 'recon';
export type UnitSection = 'workers' | 'army';

export interface UnitCardModel {
  id: string;
  unit: UnitKind;
  label: string;
  archetype: string;
  section?: UnitSection;
  category?: 'Workers' | 'Army';
  producer?: 'commandHub' | 'roboticsFactory';
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

export type SupplySummary = ColonySupply;

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

const STAGE_UNIT_ROWS: readonly Record<string, unknown>[] = [
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
  if (typeof row.unlock === 'string') {
    const m = /^S(\d+)$/i.exec(row.unlock.trim());
    if (m) return Number(m[1]);
  }
  return getItemUnlockStage(String(row.unit ?? row.id ?? ''));
}

function isDevOnlyUnitRow(row: Record<string, unknown>): boolean {
  if (row.devOnly === true) return true;
  const id = String(row.unit ?? row.id ?? '');
  return id === 'demoTank' || id === 'demoArtillery' || id.startsWith('demo');
}

function makeUnitCard(row: Record<string, unknown>, colonyStage: number | undefined): UnitCardModel {
  const unit = String(row.unit ?? row.id ?? 'worker') as UnitKind;
  const unlockStage = resolveUnitUnlockStage(row);
  const stageLocked = colonyStage !== undefined && colonyStage < unlockStage;
  const isArmy = row.section === 'army' || row.producer === 'roboticsFactory' || unit === 'recon';
  const buildS = typeof row.designBuildS === 'number'
    ? row.designBuildS
    : typeof row.buildS === 'number'
      ? (isArmy && row.buildS <= 30 ? row.buildS : Math.round(row.buildS / 5))
      : 10;
  const supply = typeof row.supply === 'number'
    ? row.supply
    : typeof row.supplyCost === 'number'
      ? row.supplyCost
      : 1;
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
    section: isArmy ? 'army' : 'workers',
    category: isArmy ? 'Army' : 'Workers',
    producer: isArmy ? 'roboticsFactory' : 'commandHub',
    tier: typeof row.tier === 'number' ? row.tier : 1,
    unlockStage,
    stageLocked,
    disabled: stageLocked,
    disabledReason: unlockConditionText,
    unlockConditionText,
    unlockDetailText,
    buildS,
    supply,
    powerDrainPerS: powerDrain,
    powerText: formatPower(powerDrain),
    cost,
    costSummary,
    costPills,
  };
}

/** Balance rows are `t1`/`t2`/`t3` with `unit: 'worker'`. T1 is the miner mesh; T2 and T3 share `robot.builder`. */
function asWorkerRow(row: Record<string, unknown>, tier: 1 | 2 | 3): Record<string, unknown> {
  return {
    ...row,
    id: typeof row.id === 'string' ? row.id : `t${tier}`,
    unit: 'worker',
    tier,
    archetype: tier === 1 ? 'robot.miner' : 'robot.builder',
    label: typeof row.label === 'string' ? row.label : `Worker Drone T${tier}`,
  };
}

export function buildUnitsCatalog(
  flags: ReadonlySet<string> | FlagSet,
  view?: GameView,
): UnitCardModel[] {
  const fs = toFlagSet(flags);
  if (!fs.has('W02')) return [];

  const data = clientDataFor(fs);
  const unitsTable = data.tables['unitsWorkersBasic'] as Record<string, Record<string, unknown>> | undefined;
  const t1 = unitsTable?.t1;
  if (!t1) return [];

  const isLiveGameView = Boolean(view && typeof view === 'object' && 'planet' in view && (view as { planet?: unknown }).planet !== undefined);
  const colonyStage = !fs.has('W08') && isLiveGameView ? undefined : resolveColonyUnlockStage(view);
  const candidateRows: Record<string, unknown>[] = [asWorkerRow(t1, 1)];
  if (fs.has('W03') && unitsTable?.t2) candidateRows.push(asWorkerRow(unitsTable.t2, 2));
  if (fs.has('W05') && unitsTable?.t3) candidateRows.push(asWorkerRow(unitsTable.t3, 3));
  if (colonyStage !== undefined) candidateRows.push(...STAGE_UNIT_ROWS);

  const combatTable = fs.has('W07') ? data.tables['combatUnits'] : undefined;
  if (combatTable) {
    const seenCombat = new Set<string>();
    for (const row of Object.values(combatTable)) {
      if (!row || row.kind !== 'unit' || isDevOnlyUnitRow(row as Record<string, unknown>)) continue;
      const u = String(row.unit ?? row.id ?? '');
      if (u && !seenCombat.has(u)) {
        candidateRows.push({ ...row, unit: u, section: 'army' });
        seenCombat.add(u);
      }
    }
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
