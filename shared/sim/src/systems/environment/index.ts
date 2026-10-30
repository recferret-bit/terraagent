import { dataRow } from '../../data';
import type { CompiledDataLike } from '../../kernel/config';
import { setBlob, type PlanetState, type PlanetType } from '../../kernel/state';
import { defineSystem } from '../../kernel/system';
import { defineSimModule } from '../define';

export interface EnvironmentState {
  cycleTick: number;
  dayLengthTicks: number;
  nightShare: number;
  dayShare: number;
  cycleProgress: number;
  phase: 'day' | 'night';
  daylight: number;
  hourOfDay: number;
  clockText: string;
  stormActive: boolean;
  stormDaylightMult: number;
}

const DEFAULT_DAY_LENGTH_TICKS = 6000; // 20 min at 5 TPS

export function getNightShare(planetType: PlanetType, data?: CompiledDataLike): number {
  const table = data?.tables?.economyT1Basic as Record<string, unknown> | undefined;
  const row = table?.dayCycle as
    | { defaultNightShare?: number; nightShareByPlanetType?: Record<string, number> }
    | undefined;
  const byType = row?.nightShareByPlanetType?.[planetType];
  if (typeof byType === 'number') return byType;
  if (planetType === 'temperate') return 0.45;
  return typeof row?.defaultNightShare === 'number' ? row.defaultNightShare : 0.4;
}

export function getDayLengthTicks(data?: CompiledDataLike): number {
  const table = data?.tables?.economyT1Basic as Record<string, unknown> | undefined;
  const row = table?.dayCycle as { dayLengthS?: number } | undefined;
  return typeof row?.dayLengthS === 'number' && row.dayLengthS > 0 ? row.dayLengthS : DEFAULT_DAY_LENGTH_TICKS;
}

function formatClock(hourOfDay: number): string {
  const norm = ((hourOfDay % 24) + 24) % 24;
  const totalMinutes = Math.floor(norm * 60 + 1e-6);
  const hh = Math.floor(totalMinutes / 60) % 24;
  const mm = totalMinutes % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/**
 * Computes the deterministic environment state for a given `cycleTick`.
 * - Daytime occupies `cycleProgress in [0, dayShare)` and maps to `06:00 .. 18:00`.
 * - Nighttime occupies `cycleProgress in [dayShare, 1)` and maps to `18:00 .. 06:00`.
 * - On `temperate` (`nightShare = 0.45`, `dayShare = 0.55`), advancing 11 min (`3300` ticks) from tick 0
 *   reaches `cycleProgress = 0.55` (`18:00`), where `phase === 'night'` and `daylight === 0`.
 */
export function computeEnvironmentAtCycleTick(
  planetType: PlanetType,
  cycleTick: number,
  data?: CompiledDataLike,
  stormActive = false,
): EnvironmentState {
  const dayLengthTicks = getDayLengthTicks(data);
  const nightShare = getNightShare(planetType, data);
  const dayShare = Math.max(0.05, 1 - nightShare);
  const wrappedTick = ((cycleTick % dayLengthTicks) + dayLengthTicks) % dayLengthTicks;
  const cycleProgress = wrappedTick / dayLengthTicks;

  let phase: 'day' | 'night';
  let baseDaylight: number;
  let hourOfDay: number;

  if (cycleProgress < dayShare - 1e-9) {
    phase = 'day';
    const dayProgress = cycleProgress / dayShare; // 0 (06:00) -> 0.5 (12:00) -> 1.0 (18:00)
    hourOfDay = 6 + dayProgress * 12;
    if (dayProgress < 0.85) {
      baseDaylight = 1;
    } else {
      const duskT = Math.min(1, Math.max(0, (dayProgress - 0.85) / 0.15));
      baseDaylight = Number((0.5 * (1 + Math.cos(Math.PI * duskT))).toFixed(4));
    }
  } else {
    phase = 'night';
    baseDaylight = 0;
    const nightProgress = nightShare > 0 ? (cycleProgress - dayShare) / nightShare : 0;
    hourOfDay = (18 + nightProgress * 12) % 24;
  }

  const stormDaylightMult = stormActive ? 0.5 : 1;
  const daylight = baseDaylight === 0 ? 0 : Number((baseDaylight * stormDaylightMult).toFixed(4));

  return {
    cycleTick: wrappedTick,
    dayLengthTicks,
    nightShare,
    dayShare,
    cycleProgress,
    phase,
    daylight,
    hourOfDay,
    clockText: formatClock(hourOfDay),
    stormActive,
    stormDaylightMult,
  };
}

/** Converts `'day'`, `'night'`, or `'HH:MM'` into a `cycleTick` in `[0, dayLengthTicks)`. */
export function cycleTickForTimeSpec(
  target: string,
  planetType: PlanetType,
  data?: CompiledDataLike,
): number {
  const dayLengthTicks = getDayLengthTicks(data);
  const nightShare = getNightShare(planetType, data);
  const dayShare = 1 - nightShare;
  const trimmed = target.trim().toLowerCase();

  let hour = 12;
  if (trimmed === 'day' || trimmed === 'midday' || trimmed === 'noon') {
    hour = 12;
  } else if (trimmed === 'morning' || trimmed === 'sunrise' || trimmed === 'dawn') {
    hour = 6;
  } else if (trimmed === 'night' || trimmed === 'sunset' || trimmed === 'dusk') {
    hour = 18;
  } else if (trimmed === 'midnight') {
    hour = 0;
  } else {
    const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(trimmed);
    if (m) {
      const hh = Number(m[1]) % 24;
      const mm = Number(m[2] ?? '0') % 60;
      hour = hh + mm / 60;
    }
  }

  let cycleProgress: number;
  if (hour >= 6 && hour < 18) {
    cycleProgress = ((hour - 6) / 12) * dayShare;
  } else {
    const nightHours = hour >= 18 ? hour - 18 : hour + 6;
    cycleProgress = dayShare + (nightHours / 12) * nightShare;
  }
  return Math.round(cycleProgress * dayLengthTicks) % dayLengthTicks;
}

export function getEnvironment(state: PlanetState, data?: CompiledDataLike): EnvironmentState {
  const existing = state.blobs.environment?.value as EnvironmentState | undefined;
  if (existing && typeof existing.daylight === 'number') return existing;
  return computeEnvironmentAtCycleTick(state.meta.planetType, state.meta.tick, data, false);
}

export function applyEnvironmentState(state: PlanetState, env: EnvironmentState, tick: number): void {
  setBlob(state, 'environment', env, tick);
  for (const colony of state.colonies) {
    if (colony.daylight !== env.daylight || colony.dayPhase !== env.phase || colony.timeOfDay !== env.clockText) {
      colony.daylight = env.daylight;
      colony.dayPhase = env.phase;
      colony.timeOfDay = env.clockText;
      colony.changedAt = tick;
    }
  }
}

const environmentSystem = defineSystem({
  id: 'environment.dayCycle',
  slot: 1,
  wave: 'W02',
  run(state, ctx) {
    // Ensure dayCycle row exists when W02 is enabled
    dataRow(ctx.data, 'economyT1Basic', 'dayCycle');
    const prev = state.blobs.environment?.value as Partial<EnvironmentState> | undefined;
    const stormActive = prev?.stormActive === true;
    const changedAtThisTick = state.blobs.environment?.changedAt === ctx.tick;
    const baseCycleTick = typeof prev?.cycleTick === 'number'
      ? (changedAtThisTick ? prev.cycleTick : prev.cycleTick + ctx.dt)
      : ctx.tick;
    const env = computeEnvironmentAtCycleTick(state.meta.planetType, baseCycleTick, ctx.data, stormActive);
    applyEnvironmentState(state, env, ctx.tick);
  },
});

export default defineSimModule({
  id: 'environment',
  wave: 'W02',
  systems: [environmentSystem],
});
