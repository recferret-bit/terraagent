import { canonicalPlanetById } from '@terra/contracts';
import { PLANET_SEEN_HEARTBEAT_MS } from '../presence/planet-seen';
import type { PlanetActivityRow } from './planet-activity.store';

export const HOUR_MS = 3_600_000;
/** Default idle time before a planet is unloaded (`TA_PLANET_IDLE_UNLOAD_H`). */
export const DEFAULT_IDLE_UNLOAD_H = 24;
/** Default period of the per-planet idle check (`TA_PLANET_IDLE_CHECK_S`). */
export const DEFAULT_IDLE_CHECK_S = 300;
/** Default loaded planets per sim thread when `TA_PLANET_CAP` is unset. */
export const PLANETS_PER_SIM_THREAD = 4;

/**
 * Shortest idle time outside tests: three presence heartbeats, so a planet with a connected player (whose clock is
 * refreshed once per heartbeat) is never taken for idle.
 */
export const MIN_IDLE_MS = 3 * PLANET_SEEN_HEARTBEAT_MS;

export interface LifecycleConfig {
  /** 0 = idle unload off. */
  readonly idleMs: number;
  readonly checkMs: number;
  readonly cap: number;
}

/** Reads the three lifecycle settings from the game env section (see `game.module.ts`). */
export function lifecycleConfig(env: Readonly<Record<string, unknown>>): LifecycleConfig {
  const threads = Math.max(1, Number(env.SIM_THREADS) || 1);
  const rawCap = env.TA_PLANET_CAP;
  const idleH = env.TA_PLANET_IDLE_UNLOAD_H === undefined ? DEFAULT_IDLE_UNLOAD_H : Number(env.TA_PLANET_IDLE_UNLOAD_H);
  const checkS = env.TA_PLANET_IDLE_CHECK_S === undefined ? DEFAULT_IDLE_CHECK_S : Number(env.TA_PLANET_IDLE_CHECK_S);
  const idleMs = Math.max(0, idleH * HOUR_MS);
  return {
    idleMs: idleMs > 0 && env.NODE_ENV !== 'test' ? Math.max(MIN_IDLE_MS, idleMs) : idleMs,
    checkMs: Math.max(1_000, checkS * 1000),
    cap: rawCap === undefined || rawCap === '' ? PLANETS_PER_SIM_THREAD * threads : Math.max(1, Number(rawCap)),
  };
}

/**
 * Planets the idle unload may take down: player planets. Canonical worlds, scenario planets (dev sessions play their
 * colonies) and spectator planets (`pl_spec_`) stay loaded.
 */
export function idleUnloadEligible(planetId: string, isScenario: (planetId: string) => boolean): boolean {
  return canonicalPlanetById(planetId) === null && !isScenario(planetId) && !planetId.startsWith('pl_spec_');
}

/** No human for `idleMs` (inclusive). */
export function isIdle(row: Pick<PlanetActivityRow, 'lastHumanSeenAt'>, nowMs: number, idleMs: number): boolean {
  return idleMs > 0 && row.lastHumanSeenAt.getTime() <= nowMs - idleMs;
}
