import { RESOURCE_FAMILY_OF, type ResourceFamily, type ResourceKey } from '@terra/contracts';
import { consumeDepositRichness, type CompiledRow } from '../../data';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { setField } from '../../ecs/store';
import { DEPOSIT } from '../../grid/layers';
import type { CompiledDataLike } from '../../kernel/config';
import { TICK_MS } from '../../kernel/constants';
import type { StepContext } from '../../kernel/context';
import type { ColonyState, PlanetState } from '../../kernel/state';
import { defineSystem } from '../../kernel/system';
import { defineSimModule } from '../define';
import { colonyTerraformStats } from '../terraform-basic/rules';
import {
  creditResource,
  ensureColonyLedger,
  isFamilyAtCap,
  type ExtractorLivingBonusRecord,
} from '../economy/ledger';
import {
  checkExtractorDepositCoverage,
  ensureColonyForOwner,
  getExtractorLivingBonus,
  resolveExtractorRow,
  resolveMineralsQuarryRow,
  resolvePetroleumWellRow,
  resolveWaterExtractorRow,
  type ExtractorLivingBonusInfo,
  type IncomeMapByOwner,
} from './helpers';
import {
  computeColonyTierGates,
  creditExtractedDepositSlice,
  emitTierUnlockedIfNeeded,
  evaluateExtractorTierGate,
  type ColonyTierGatesSummary,
  type ExtractorTierGateResult,
} from './tierGate';

export * from './helpers';
export * from './tierGate';

const METALS_KEYS: readonly ResourceKey[] = ['metals.t1', 'metals.t2', 'metals.t3'];
const NON_METALS_EXTRACTOR_KEYS: readonly ResourceKey[] = [
  'minerals.t1',
  'minerals.t2',
  'minerals.t3',
  'bio.water',
  'bio.t2',
  'bio.t3',
];

const lastExtractorIncomeByState = new WeakMap<PlanetState, IncomeMapByOwner>();

/** A colony's Terraform % (a full-grid scan), computed at most once per colony per step and shared by its extractors. */
type TerraformPctOf = (colonyIndex: number) => number;

function terraformPctMemo(state: PlanetState): TerraformPctOf {
  const memo = new Map<number, number>();
  return (colonyIndex) => {
    let pct = memo.get(colonyIndex);
    if (pct === undefined) memo.set(colonyIndex, (pct = colonyTerraformStats(state, colonyIndex).percent));
    return pct;
  };
}

function isOfflineExtractorState(st: number): boolean {
  return (
    st === ENTITY_STATE.constructing ||
    st === ENTITY_STATE.offlineBrownout ||
    st === ENTITY_STATE.offlineUnpowered ||
    st === ENTITY_STATE.offlineOverload ||
    st === ENTITY_STATE.offlineNoGrid ||
    st === ENTITY_STATE.offlineNoFuel
  );
}

/**
 * Extracts up to `desired` units from the covered deposit tiles (in order) and credits each tile's yield to the stock
 * key of its tier (`depositTier` or D-34 `tierGate` split). Returns what was extracted per key.
 */
function extractTiered(
  state: PlanetState,
  colony: ColonyState,
  depositTiles: readonly number[],
  desired: number,
  tick: number,
  depositKind: number = DEPOSIT.metals,
  fallbackKey?: ResourceKey,
  tierGate?: ExtractorTierGateResult,
): Map<ResourceKey, number> {
  const out = new Map<ResourceKey, number>();
  const tiers = state.grid.layers.depositTier as Uint8Array | undefined;
  let remaining = desired;
  for (const depTileIdx of depositTiles) {
    if (remaining <= 0) break;
    const got = consumeDepositRichness(state, depTileIdx, remaining, tick);
    if (got <= 0) continue;
    remaining -= got;
    const tier = tiers?.[depTileIdx] ?? 0;
    creditExtractedDepositSlice(colony, depositKind, tier, got, tick, tierGate, fallbackKey, out);
  }
  return out;
}

function recordExtractorBonus(
  colony: ColonyState,
  entityId: number,
  q: number,
  r: number,
  family: ResourceFamily,
  livingBonus: ExtractorLivingBonusInfo,
  ratePerS: number,
  tierGate: ExtractorTierGateResult,
  incomePerSByKey?: Partial<Record<ResourceKey, number>>,
): void {
  const c = ensureColonyLedger(colony);
  const entry: ExtractorLivingBonusRecord = {
    entityId,
    q,
    r,
    family,
    adjacentToLiving: livingBonus.adjacentToLiving,
    livingBonus: livingBonus.bonus,
    livingBonusText: livingBonus.label,
    ratePerS: Number(ratePerS.toFixed(4)),
    unlockedTier: tierGate.unlockedTier,
    ringRadius: tierGate.ring.ringRadius,
    ringTotalTiles: tierGate.ring.totalTiles,
    ringTerraformedTiles: tierGate.ring.terraformedTiles,
    ringLivingTiles: tierGate.ring.livingTiles,
    ringTerraformedRatio: Number(tierGate.ring.terraformedRatio.toFixed(4)),
    ringLivingRatio: Number(tierGate.ring.livingRatio.toFixed(4)),
    ringTerraformedPct: tierGate.ring.terraformedPct,
    ringLivingPct: tierGate.ring.livingPct,
    shares: tierGate.shares,
    ...(incomePerSByKey ? { incomePerSByKey } : {}),
  };
  if (!c.production.extractors) c.production.extractors = {};
  c.production.extractors[entityId] = entry;
  const bonuses = ((colony as { extractorBonuses?: Record<number, ExtractorLivingBonusRecord> }).extractorBonuses ??= {});
  bonuses[entityId] = entry;
}

function stepDepositExtractorRow(
  state: PlanetState,
  row: number,
  ctx: StepContext,
  rowDef: CompiledRow,
  depositKind: number,
  family: ResourceFamily,
  extractorIncomeByOwner: IncomeMapByOwner,
  pctOf: TerraformPctOf,
  fallbackKey?: ResourceKey,
): void {
  const e = state.entities, cols = e.cols;
  const st = cols.state[row];
  if (isOfflineExtractorState(st)) return;

  const owner = cols.owner[row];
  const colony = ensureColonyForOwner(state, owner, ctx.tick);
  if (isFamilyAtCap(colony, family)) {
    if (st !== ENTITY_STATE.offlineCapped) setField(e, row, 'state', ENTITY_STATE.offlineCapped, ctx.tick);
    return;
  }
  if (st === ENTITY_STATE.offlineCapped) setField(e, row, 'state', ENTITY_STATE.active, ctx.tick);

  const q = cols.q[row], r = cols.r[row], rot = cols.rot[row];
  const w = cols.footprintW?.[row] || Number(rowDef.footprintW ?? 2);
  const d = cols.footprintD?.[row] || Number(rowDef.footprintD ?? 2);
  const cov = checkExtractorDepositCoverage(state, q, r, w, d, rot, depositKind);
  if (!cov.covered) return;

  const livingBonus = getExtractorLivingBonus(state, q, r, w, d, rot, ctx.data);
  const tierGate = evaluateExtractorTierGate(state, owner, q, r, w, d, rot, ctx.data, pctOf(owner));
  emitTierUnlockedIfNeeded(state, colony, owner, cols.id[row], family, q, r, tierGate.unlockedTier, ctx);

  const entityTier = Math.max(1, Number(cols.tier?.[row] ?? 1));
  const rowTier = Math.max(1, Number(rowDef.tier ?? 1));
  const mkRateMult = entityTier > rowTier ? entityTier / rowTier : 1;
  const baseOutputPerS = Number(rowDef.outputPerS ?? 1.0);
  const ratePerS = baseOutputPerS * mkRateMult * cov.richnessMult * livingBonus.mult;

  const desiredAmount = (ratePerS * TICK_MS * ctx.dt) / 1000;
  const byKey = extractTiered(state, colony, cov.depositTiles, desiredAmount, ctx.tick, depositKind, fallbackKey, tierGate);
  let extracted = 0;
  for (const v of byKey.values()) extracted += v;
  const incomePerSByKey: Partial<Record<ResourceKey, number>> = {};
  if (extracted > 0) {
    const income = extractorIncomeByOwner.get(owner) ?? {};
    for (const [key, got] of byKey) {
      const keyRate = (ratePerS * got) / extracted;
      incomePerSByKey[key] = Number(keyRate.toFixed(4));
      income[key] = (income[key] ?? 0) + keyRate;
    }
    extractorIncomeByOwner.set(owner, income);
  }
  recordExtractorBonus(colony, cols.id[row], q, r, family, livingBonus, ratePerS, tierGate, incomePerSByKey);
  if (extracted <= 0) return;

  if (isFamilyAtCap(colony, family)) setField(e, row, 'state', ENTITY_STATE.offlineCapped, ctx.tick);
}

function stepWaterExtractorRow(
  state: PlanetState,
  row: number,
  ctx: StepContext,
  waterRow: CompiledRow,
  extractorIncomeByOwner: IncomeMapByOwner,
  pctOf: TerraformPctOf,
): void {
  const e = state.entities, cols = e.cols;
  const st = cols.state[row];
  if (isOfflineExtractorState(st)) return;

  const owner = cols.owner[row];
  const colony = ensureColonyForOwner(state, owner, ctx.tick);
  if (isFamilyAtCap(colony, 'bio')) {
    if (st !== ENTITY_STATE.offlineCapped) setField(e, row, 'state', ENTITY_STATE.offlineCapped, ctx.tick);
    return;
  }
  if (st === ENTITY_STATE.offlineCapped) setField(e, row, 'state', ENTITY_STATE.active, ctx.tick);

  const q = cols.q[row], r = cols.r[row], rot = cols.rot[row];
  const w = cols.footprintW?.[row] || Number(waterRow.footprintW ?? 2);
  const d = cols.footprintD?.[row] || Number(waterRow.footprintD ?? 2);
  const livingBonus = getExtractorLivingBonus(state, q, r, w, d, rot, ctx.data);
  const tierGate = evaluateExtractorTierGate(state, owner, q, r, w, d, rot, ctx.data, pctOf(owner));
  const baseWaterPerS = Number(waterRow.outputPerS ?? 0.875);
  const planetMult = state.meta.planetType === 'desert' ? Number(waterRow.desertOutputMult ?? 0.5) : 1.0;
  const ratePerS = baseWaterPerS * planetMult * livingBonus.mult;
  const desiredAmount = (ratePerS * TICK_MS * ctx.dt) / 1000;
  const { credited } = creditResource(colony, 'bio.water', desiredAmount, ctx.tick);
  const keyRate = credited > 0 ? (ratePerS * credited) / desiredAmount : 0;
  recordExtractorBonus(colony, cols.id[row], q, r, 'bio', livingBonus, ratePerS, tierGate, {
    'bio.water': Number(keyRate.toFixed(4)),
  });
  if (credited <= 0) return;

  const income = extractorIncomeByOwner.get(owner) ?? {};
  income['bio.water'] = (income['bio.water'] ?? 0) + keyRate;
  extractorIncomeByOwner.set(owner, income);

  if (isFamilyAtCap(colony, 'bio')) setField(e, row, 'state', ENTITY_STATE.offlineCapped, ctx.tick);
}

function applyExtractorIncomeToLedger(
  state: PlanetState,
  extractorIncomeByOwner: IncomeMapByOwner,
  pctOf: TerraformPctOf,
  data?: CompiledDataLike,
): void {
  for (const colony of state.colonies) {
    if (!colony) continue;
    const c = ensureColonyLedger(colony);
    const tierGates = computeColonyTierGates(state, c.index, data, pctOf(c.index));
    c.production.tierGates = tierGates;
    (c as { tierGates?: ColonyTierGatesSummary }).tierGates = tierGates;

    const income = extractorIncomeByOwner.get(c.index) ?? {};
    let metalsFam = 0;
    for (const key of METALS_KEYS) {
      c.production.incomePerS[key] = Number((income[key] ?? 0).toFixed(4));
      metalsFam += income[key] ?? 0;
    }
    c.production.familyIncomePerS.metals = Number(metalsFam.toFixed(4));

    let mineralsFam = 0;
    let bioFam = 0;
    for (const key of NON_METALS_EXTRACTOR_KEYS) {
      const rate = income[key] ?? 0;
      c.production.incomePerS[key] = Number(rate.toFixed(4));
      if (RESOURCE_FAMILY_OF[key] === 'minerals') mineralsFam += rate;
      else if (RESOURCE_FAMILY_OF[key] === 'bio') bioFam += rate;
    }
    c.production.familyIncomePerS.minerals = Number(mineralsFam.toFixed(4));
    c.production.familyIncomePerS.bio = Number(bioFam.toFixed(4));
  }
}

const extractorProductionSystem = defineSystem({
  id: 'production.extractors',
  slot: 8,
  wave: 'W02',
  run(state, ctx) {
    const extRow = resolveExtractorRow(ctx.data);
    const quarryRow = resolveMineralsQuarryRow(ctx.data);
    const waterRow = resolveWaterExtractorRow(ctx.data);
    const wellRow = resolvePetroleumWellRow(ctx.data);
    const e = state.entities, cols = e.cols;
    const extractorIncomeByOwner: IncomeMapByOwner = new Map();
    const pctOf = terraformPctMemo(state);

    for (let row = 0; row < e.count; row++) {
      if (cols.hp[row] <= 0) continue;
      const k = cols.kind[row];
      if (k === ENTITY_KIND.metalsExtractor) {
        const metal = checkExtractorDepositCoverage(state, cols.q[row], cols.r[row], cols.footprintW[row] || 2, cols.footprintD[row] || 2, cols.rot[row], DEPOSIT.metals).covered;
        stepDepositExtractorRow(state, row, ctx, extRow, metal ? DEPOSIT.metals : DEPOSIT.minerals, metal ? 'metals' : 'minerals', extractorIncomeByOwner, pctOf);
      } else if (k === ENTITY_KIND.mineralsQuarry) {
        stepDepositExtractorRow(state, row, ctx, quarryRow, DEPOSIT.minerals, 'minerals', extractorIncomeByOwner, pctOf);
      } else if (k === ENTITY_KIND.waterExtractor) {
        stepWaterExtractorRow(state, row, ctx, waterRow, extractorIncomeByOwner, pctOf);
      } else if (k === ENTITY_KIND.petroleumWell) {
        stepDepositExtractorRow(state, row, ctx, wellRow, DEPOSIT.oil, 'bio', extractorIncomeByOwner, pctOf, 'bio.t2');
      }
    }

    lastExtractorIncomeByState.set(state, extractorIncomeByOwner);
    applyExtractorIncomeToLedger(state, extractorIncomeByOwner, pctOf, ctx.data);
  },
});

const extractorIncomeSyncSystem = defineSystem({
  id: 'production.incomeSync',
  slot: 8,
  wave: 'W02',
  run(state) {
    const extractorIncomeByOwner = lastExtractorIncomeByState.get(state);
    if (!extractorIncomeByOwner) return;
    for (const colony of state.colonies) {
      if (!colony) continue;
      const c = ensureColonyLedger(colony);
      const income = extractorIncomeByOwner.get(c.index);
      if (!income) continue;
      for (const key of NON_METALS_EXTRACTOR_KEYS) {
        const rate = income[key] ?? 0;
        if (rate <= 0) continue;
        const fam = RESOURCE_FAMILY_OF[key];
        c.production.incomePerS[key] = Number(((c.production.incomePerS[key] ?? 0) + rate).toFixed(4));
        c.production.familyIncomePerS[fam] = Number(((c.production.familyIncomePerS[fam] ?? 0) + rate).toFixed(4));
      }
    }
  },
});

export default defineSimModule({
  id: 'production',
  wave: 'W02',
  systems: [extractorProductionSystem, extractorIncomeSyncSystem],
});
