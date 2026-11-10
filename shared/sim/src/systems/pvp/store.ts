import { ensureColonyRecord } from '../../kernel/colonies';
import type { CompiledDataLike } from '../../kernel/config';
import { TICKS_PER_SECOND } from '../../kernel/constants';
import { setBlob, type PlanetState } from '../../kernel/state';

export const PVP_BLOB_KEY = 'pvp';

export const TICKS_PER_HOUR = 3600 * TICKS_PER_SECOND;
export const DEFAULT_SHIELD_DURATION_TICKS = 6 * TICKS_PER_HOUR; // 21,600s = 108,000 ticks
export const DEFAULT_SHIELD_DROP_STAGE = 4; // S4 in Tier-1 vertical slice (S0..S4)
export const DEFAULT_SIPHON_RATE_PER_TICK = 2 / TICKS_PER_SECOND; // 2 units/s = 0.4/tick
export const DEFAULT_SIPHON_CARRY_CAP = 40;
export const DEFAULT_SIPHON_RANGE_TILES = 1;

export interface ActiveRaidGroupState {
  raidId: string;
  attackerColony: number;
  targetColony: number;
  startedAtTick: number;
  unitIds: number[];
  groupId: number;
  currentTargetEntityId: number | null;
  currentTargetQ: number;
  currentTargetR: number;
  repelled: boolean;
}

export interface ColonyPvpRecord {
  colonyIndex: number;
  foundedAtTick: number;
  raidProtectedUntil: number;
  shieldDropped: boolean;
  manualShieldOverride?: boolean;
  activeRaidId?: string | null;
  activeRaidTargetColony?: number | null;
  raidGroupId?: number | null;
  raiderUnitIds?: number[];
  siphonCarryingByUnit?: Record<number, Partial<Record<string, number>>>;
}

export interface PvpBlobState {
  byColony: Record<string, ColonyPvpRecord>;
  raidProtectedUntilByColony: Record<string, number>;
  activeRaids: Record<string, ActiveRaidGroupState>;
  crossSectorEnabled?: boolean;
  nextRaidSeq: number;
}

export interface PvpConfig {
  shieldDurationTicks: number;
  shieldDropStage: number;
  siphonRatePerTick: number;
  siphonCarryCap: number;
  siphonRangeTiles: number;
}

/**
 * Returns `true` when W18 PvP data is compiled in `data` (or when `data` is omitted).
 * Note: `compileData` creates an empty `{}` table object when all rows are filtered out by wave flags,
 * so we check `diplomacy.pvp` specifically.
 */
export function isW18PvpActive(data?: CompiledDataLike): boolean {
  if (!data?.tables) return true;
  const dip = (data.tables as Record<string, Record<string, unknown> | undefined>).diplomacy;
  return Boolean(dip?.pvp);
}

/** Resolves W18 PvP balance parameters from `data.tables.diplomacy.pvp` with D-35 fallbacks. */
export function resolvePvpConfig(data?: CompiledDataLike): PvpConfig {
  const row = (
    data?.tables as { diplomacy?: { pvp?: Record<string, unknown> } } | undefined
  )?.diplomacy?.pvp;

  const rawShield = Number(row?.shieldDurationS ?? 0);
  const shieldDurationTicks =
    rawShield > 25_000
      ? Math.round(rawShield)
      : rawShield > 0
        ? Math.round(rawShield * TICKS_PER_SECOND)
        : DEFAULT_SHIELD_DURATION_TICKS;

  const rawDropStage = Number(row?.shieldDropStage ?? DEFAULT_SHIELD_DROP_STAGE);
  const shieldDropStage =
    Number.isFinite(rawDropStage) && rawDropStage > 0
      ? Math.floor(rawDropStage)
      : DEFAULT_SHIELD_DROP_STAGE;

  const rawSiphonRate = Number(row?.siphonRatePerS ?? 0);
  const siphonRatePerTick =
    rawSiphonRate > 0 && rawSiphonRate < 1
      ? rawSiphonRate
      : rawSiphonRate >= 1
        ? rawSiphonRate / TICKS_PER_SECOND
        : DEFAULT_SIPHON_RATE_PER_TICK;

  const rawCap = Number(row?.siphonCarryCap ?? DEFAULT_SIPHON_CARRY_CAP);
  const siphonCarryCap = rawCap > 0 ? rawCap : DEFAULT_SIPHON_CARRY_CAP;

  const rawRange = Number(row?.siphonRangeTiles ?? DEFAULT_SIPHON_RANGE_TILES);
  const siphonRangeTiles = rawRange > 0 ? Math.floor(rawRange) : DEFAULT_SIPHON_RANGE_TILES;

  return {
    shieldDurationTicks,
    shieldDropStage,
    siphonRatePerTick,
    siphonCarryCap,
    siphonRangeTiles,
  };
}

export function getPvpState(state: PlanetState): PvpBlobState {
  const raw = state.blobs[PVP_BLOB_KEY]?.value as Partial<PvpBlobState> | undefined;
  return {
    byColony: raw?.byColony ? { ...raw.byColony } : {},
    raidProtectedUntilByColony: raw?.raidProtectedUntilByColony
      ? { ...raw.raidProtectedUntilByColony }
      : {},
    activeRaids: raw?.activeRaids ? { ...raw.activeRaids } : {},
    ...(raw?.crossSectorEnabled !== undefined
      ? { crossSectorEnabled: Boolean(raw.crossSectorEnabled) }
      : {}),
    nextRaidSeq: typeof raw?.nextRaidSeq === 'number' ? raw.nextRaidSeq : 1,
  };
}

export function savePvpState(
  state: PlanetState,
  pvpState: PvpBlobState,
  tick = state.meta.tick,
): void {
  const byColony: Record<string, ColonyPvpRecord> = {};
  const raidProtectedUntilByColony: Record<string, number> = {
    ...pvpState.raidProtectedUntilByColony,
  };

  for (const [key, rec] of Object.entries(pvpState.byColony)) {
    byColony[key] = { ...rec };
    raidProtectedUntilByColony[key] = rec.raidProtectedUntil;
    const col = state.colonies[rec.colonyIndex];
    if (col) {
      col.raidProtectedUntil = rec.raidProtectedUntil;
      col.changedAt = tick;
    }
  }

  setBlob(
    state,
    PVP_BLOB_KEY,
    {
      ...pvpState,
      byColony,
      raidProtectedUntilByColony,
      activeRaids: { ...pvpState.activeRaids },
    },
    tick,
  );
}

/** Resolves the highest stage / threatStage reached by `colonyIndex` for shield evaluation. */
export function getEffectiveColonyStageForShield(
  state: PlanetState,
  colonyIndex: number,
): number {
  const col = state.colonies[colonyIndex];
  const colStage = typeof col?.stage === 'number' && Number.isFinite(col.stage) ? col.stage : 0;
  const colThreat =
    typeof col?.threatStage === 'number' && Number.isFinite(col.threatStage) ? col.threatStage : 0;

  const progByCol = (
    state.blobs.progression?.value as
      | { byColony?: Record<string, { stage?: number; threatStage?: number }> }
      | undefined
  )?.byColony?.[String(colonyIndex)];
  const progStage =
    typeof progByCol?.stage === 'number' && Number.isFinite(progByCol.stage) ? progByCol.stage : 0;
  const progThreat =
    typeof progByCol?.threatStage === 'number' && Number.isFinite(progByCol.threatStage)
      ? progByCol.threatStage
      : 0;

  return Math.max(0, Math.floor(Math.max(colStage, colThreat, progStage, progThreat)));
}

export function ensureColonyPvpRecord(
  state: PlanetState,
  colonyIndex: number,
  tick = state.meta.tick,
  data?: CompiledDataLike,
): ColonyPvpRecord {
  const col = ensureColonyRecord(state, colonyIndex, tick);
  const pvpState = getPvpState(state);
  const key = String(colonyIndex);
  const existing = pvpState.byColony[key];
  if (existing) {
    return { ...existing };
  }

  const cfg = resolvePvpConfig(data);
  const foundedAtTick =
    typeof col.foundedAtTick === 'number' && Number.isFinite(col.foundedAtTick)
      ? col.foundedAtTick
      : typeof col.createdAt === 'number' && Number.isFinite(col.createdAt)
        ? col.createdAt
        : 0;
  const stage = getEffectiveColonyStageForShield(state, colonyIndex);
  const explicitColShield =
    typeof col.raidProtectedUntil === 'number' && Number.isFinite(col.raidProtectedUntil)
      ? col.raidProtectedUntil
      : typeof pvpState.raidProtectedUntilByColony[key] === 'number'
        ? pvpState.raidProtectedUntilByColony[key]
        : undefined;

  let raidProtectedUntil: number;
  let shieldDropped: boolean;
  if (explicitColShield !== undefined) {
    raidProtectedUntil = stage >= cfg.shieldDropStage ? 0 : Math.max(0, explicitColShield);
    shieldDropped = raidProtectedUntil <= 0;
  } else if (stage >= cfg.shieldDropStage) {
    raidProtectedUntil = 0;
    shieldDropped = true;
  } else {
    raidProtectedUntil = foundedAtTick + cfg.shieldDurationTicks;
    shieldDropped = false;
  }

  const created: ColonyPvpRecord = {
    colonyIndex,
    foundedAtTick,
    raidProtectedUntil,
    shieldDropped,
    activeRaidId: null,
    activeRaidTargetColony: null,
    raidGroupId: null,
    raiderUnitIds: [],
    siphonCarryingByUnit: {},
  };
  pvpState.byColony[key] = created;
  savePvpState(state, pvpState, tick);
  return { ...created };
}
