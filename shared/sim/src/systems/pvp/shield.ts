import { ensureColonyRecord } from '../../kernel/colonies';
import type { CompiledDataLike } from '../../kernel/config';
import type { PlanetState } from '../../kernel/state';
import {
  ensureColonyPvpRecord,
  getEffectiveColonyStageForShield,
  getPvpState,
  isW18PvpActive,
  resolvePvpConfig,
  savePvpState,
  TICKS_PER_HOUR,
  type ColonyPvpRecord,
} from './store';

/**
 * Initializes the newcomer shield (`raidProtectedUntil`) when a colony is founded (`UO-T-05`, `W18-06`).
 * Protected for 6 hours (`21,600s` = `108,000` ticks) while below `shieldDropStage` (`S4` in Tier-1 vertical slice).
 */
export function initColonyNewcomerShield(
  state: PlanetState,
  colonyIndex: number,
  tick = state.meta.tick,
  data?: CompiledDataLike,
): ColonyPvpRecord {
  const col = ensureColonyRecord(state, colonyIndex, tick);
  col.foundedAtTick = tick;
  const cfg = resolvePvpConfig(data);
  const stage = getEffectiveColonyStageForShield(state, colonyIndex);
  const pvpState = getPvpState(state);
  const key = String(colonyIndex);
  const prev = pvpState.byColony[key];

  const raidProtectedUntil = stage >= cfg.shieldDropStage ? 0 : tick + cfg.shieldDurationTicks;
  const shieldDropped = raidProtectedUntil <= 0;

  const next: ColonyPvpRecord = {
    colonyIndex,
    foundedAtTick: tick,
    raidProtectedUntil,
    shieldDropped,
    manualShieldOverride: false,
    activeRaidId: prev?.activeRaidId ?? null,
    activeRaidTargetColony: prev?.activeRaidTargetColony ?? null,
    raidGroupId: prev?.raidGroupId ?? null,
    raiderUnitIds: prev?.raiderUnitIds ?? [],
    siphonCarryingByUnit: prev?.siphonCarryingByUnit ?? {},
  };
  pvpState.byColony[key] = next;
  savePvpState(state, pvpState, tick);
  return { ...next };
}

/**
 * Synchronizes `colonyIndex`'s newcomer shield against its current stage (`>= shieldDropStage` drops shield)
 * and the current simulation clock (`tick >= raidProtectedUntil` expires shield).
 */
export function syncColonyNewcomerShield(
  state: PlanetState,
  colonyIndex: number,
  tick = state.meta.tick,
  data?: CompiledDataLike,
): ColonyPvpRecord {
  const rec = ensureColonyPvpRecord(state, colonyIndex, tick, data);
  const col = state.colonies[colonyIndex];
  const cfg = resolvePvpConfig(data);
  let changed = false;

  if (
    col &&
    typeof col.raidProtectedUntil === 'number' &&
    Number.isFinite(col.raidProtectedUntil) &&
    col.raidProtectedUntil !== rec.raidProtectedUntil
  ) {
    rec.raidProtectedUntil = Math.max(0, col.raidProtectedUntil);
    if (rec.raidProtectedUntil <= 0) {
      rec.shieldDropped = true;
      rec.manualShieldOverride = false;
    } else {
      rec.shieldDropped = false;
    }
    changed = true;
  }

  const stage = getEffectiveColonyStageForShield(state, colonyIndex);
  if (!rec.manualShieldOverride && stage >= cfg.shieldDropStage) {
    if (rec.raidProtectedUntil > 0 || !rec.shieldDropped) {
      rec.raidProtectedUntil = 0;
      rec.shieldDropped = true;
      changed = true;
    }
  } else if (rec.raidProtectedUntil > 0 && tick >= rec.raidProtectedUntil) {
    rec.raidProtectedUntil = 0;
    rec.manualShieldOverride = false;
    changed = true;
  }

  if (changed) {
    const pvpState = getPvpState(state);
    pvpState.byColony[String(colonyIndex)] = rec;
    savePvpState(state, pvpState, tick);
  }
  return rec;
}

/**
 *Synchronizes newcomer shields for all active colonies on `state`.
 */
export function syncAllColonyShields(
  state: PlanetState,
  tick = state.meta.tick,
  data?: CompiledDataLike,
): void {
  if (!isW18PvpActive(data)) return;
  for (const col of state.colonies) {
    if (!col || col.status === 'eliminated') continue;
    syncColonyNewcomerShield(state, col.index, tick, data);
  }
}

/**
 * Returns `true` when `colonyIndex` is currently protected by a newcomer shield (`raidProtectedUntil > tick`,
 * `stage < shieldDropStage`, and not dropped by an offensive raid).
 */
export function isColonyRaidProtected(
  state: PlanetState,
  colonyIndex: number,
  tick = state.meta.tick,
  data?: CompiledDataLike,
): boolean {
  if (!isW18PvpActive(data)) return false;
  if (colonyIndex < 0 || colonyIndex >= state.colonies.length) return false;
  const col = state.colonies[colonyIndex];
  if (!col || col.status === 'eliminated') return false;

  const rec = syncColonyNewcomerShield(state, colonyIndex, tick, data);
  if (rec.shieldDropped) return false;
  const cfg = resolvePvpConfig(data);
  if (!rec.manualShieldOverride && getEffectiveColonyStageForShield(state, colonyIndex) >= cfg.shieldDropStage) {
    return false;
  }
  return rec.raidProtectedUntil > tick;
}

/**
 * Returns the tick until which `colonyIndex` is raid-protected, or `0` if not protected.
 */
export function getColonyRaidProtectedUntil(
  state: PlanetState,
  colonyIndex: number,
  tick = state.meta.tick,
  data?: CompiledDataLike,
): number {
  if (!isColonyRaidProtected(state, colonyIndex, tick, data)) return 0;
  const pvpState = getPvpState(state);
  return pvpState.byColony[String(colonyIndex)]?.raidProtectedUntil ?? 0;
}

/**
 * Immediately drops `colonyIndex`'s newcomer shield (called when the colony launches a raid or reaches `S4+`).
 */
export function dropColonyShield(
  state: PlanetState,
  colonyIndex: number,
  tick = state.meta.tick,
  data?: CompiledDataLike,
): void {
  if (colonyIndex < 0) return;
  const rec = ensureColonyPvpRecord(state, colonyIndex, tick, data);
  rec.raidProtectedUntil = 0;
  rec.shieldDropped = true;
  rec.manualShieldOverride = false;
  const pvpState = getPvpState(state);
  pvpState.byColony[String(colonyIndex)] = rec;
  savePvpState(state, pvpState, tick);
}

/**
 * Sets or clears `colonyIndex`'s newcomer shield duration in hours from `tick` (`dev.setShield` / scenario setup).
 */
export function setColonyShieldHours(
  state: PlanetState,
  colonyIndex: number,
  hours: number,
  tick = state.meta.tick,
  data?: CompiledDataLike,
): number {
  if (colonyIndex < 0) return 0;
  ensureColonyRecord(state, colonyIndex, tick);
  if (!Number.isFinite(hours) || hours <= 0) {
    dropColonyShield(state, colonyIndex, tick, data);
    return 0;
  }
  const rec = ensureColonyPvpRecord(state, colonyIndex, tick, data);
  const until = tick + Math.round(hours * TICKS_PER_HOUR);
  rec.raidProtectedUntil = until;
  rec.shieldDropped = false;
  rec.manualShieldOverride = true;
  const pvpState = getPvpState(state);
  pvpState.byColony[String(colonyIndex)] = rec;
  savePvpState(state, pvpState, tick);
  return until;
}
