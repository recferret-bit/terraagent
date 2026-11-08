import { dataRow } from '../../data';
import type { CompiledDataLike } from '../../kernel/config';
import { setBlob, type PlanetState, type PlanetType } from '../../kernel/state';
import { defineSystem } from '../../kernel/system';
import { TICK_MS } from '../../kernel/constants';
import { defineSimModule } from '../define';
import { getPlanetTime, normalizeSolarHour, resolveTimeCycleConfig } from '../time';

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

/** Nightfall on every planet type: the night lasts `nightShare` of the 24 h solar clock from here (W02-04, D-33). */
export const SUNSET_HOUR = 18;

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

/**
 * Ticks of one 24 h solar day: single-sourced in the planetary solar clock (`systems/time`, `time.cycle`
 * `realHoursPerDay` / `timeScale`, or the planet's own anchor), never the W02 `dayCycle.dayLengthS` row.
 */
export function dayLengthTicksFor(realHoursPerDay: number, timeScale: number): number {
  if (!(timeScale > 0) || !(realHoursPerDay > 0)) return Number.POSITIVE_INFINITY;
  return (realHoursPerDay * 3_600_000) / TICK_MS / timeScale;
}

/** Ticks of one solar day at the data's default rates (`time.cycle`). */
export function getDayLengthTicks(data?: CompiledDataLike): number {
  const cfg = resolveTimeCycleConfig(data);
  return dayLengthTicksFor(cfg.realHoursPerDay, cfg.timeScale > 0 ? cfg.timeScale : 1); // a frozen clock: one 1× day
}

/** Sunrise hour of a planet type: `SUNSET_HOUR` plus its night (temperate 45 % → 10.8 h → 04:48). */
export function getSunriseHour(planetType: PlanetType, data?: CompiledDataLike): number {
  return normalizeSolarHour(SUNSET_HOUR + 24 * getNightShare(planetType, data));
}

function formatClock(hourOfDay: number): string {
  const norm = ((hourOfDay % 24) + 24) % 24;
  const totalMinutes = Math.floor(norm * 60 + 1e-6);
  const hh = Math.floor(totalMinutes / 60) % 24;
  const mm = totalMinutes % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function weatherDaylightMultiplier(
  stormActive = false,
  rainIntensity = 0,
  rainLevel: 'none' | 'minor' | 'heavy' = 'none',
): number {
  if (stormActive) return 0.45;
  if (rainLevel === 'heavy' || rainIntensity > 0.5) return 0.55;
  if (rainLevel === 'minor' || rainIntensity > 0.01) return 0.72;
  return 1;
}

/**
 * The environment at planetary solar hour `hour` (`systems/time`, the one authoritative clock the 3D sun follows too):
 * night from `SUNSET_HOUR` (18:00) for `nightShare` of the 24 h (temperate 45 %: 18:00 → 04:48), day the rest. Daylight
 * is 1 from sunrise and falls over the last 15 % of the day (smoothstep) to 0 at sunset; weather (rain/storm) reduces it.
 * `cycleProgress` is the share of the day since sunrise (`dayShare` = sunset); `cycleTick` the same in ticks.
 */
export function computeEnvironmentAtHour(
  planetType: PlanetType,
  hour: number,
  data?: CompiledDataLike,
  stormActive?: boolean,
  dayLengthTicks?: number,
  rainIntensity?: number,
  rainLevel?: 'none' | 'minor' | 'heavy',
): EnvironmentState;
export function computeEnvironmentAtHour(
  hour: number,
  stormActive?: boolean,
  rainIntensity?: number,
  rainLevel?: 'none' | 'minor' | 'heavy',
): EnvironmentState;
export function computeEnvironmentAtHour(
  planetTypeOrHour: PlanetType | number,
  hourOrStorm?: number | boolean,
  dataOrRainIntensity?: CompiledDataLike | number,
  stormOrRainLevel?: boolean | 'none' | 'minor' | 'heavy',
  dayLengthTicksArg?: number,
  rainIntensityArg = 0,
  rainLevelArg: 'none' | 'minor' | 'heavy' = 'none',
): EnvironmentState {
  let planetType: PlanetType;
  let hour: number;
  let data: CompiledDataLike | undefined;
  let stormActive: boolean;
  let dayLengthTicks: number;
  let rainIntensity: number;
  let rainLevel: 'none' | 'minor' | 'heavy';

  if (typeof planetTypeOrHour === 'number') {
    planetType = 'temperate';
    hour = planetTypeOrHour;
    data = undefined;
    stormActive = Boolean(hourOrStorm);
    rainIntensity = typeof dataOrRainIntensity === 'number' ? dataOrRainIntensity : 0;
    rainLevel = stormOrRainLevel === 'minor' || stormOrRainLevel === 'heavy' ? stormOrRainLevel : 'none';
    dayLengthTicks = getDayLengthTicks(undefined);
  } else {
    planetType = planetTypeOrHour;
    hour = typeof hourOrStorm === 'number' ? hourOrStorm : 12;
    data = typeof dataOrRainIntensity === 'object' ? dataOrRainIntensity : undefined;
    stormActive = Boolean(stormOrRainLevel);
    dayLengthTicks = dayLengthTicksArg ?? getDayLengthTicks(data);
    rainIntensity = rainIntensityArg;
    rainLevel = rainLevelArg;
  }

  const nightShare = getNightShare(planetType, data);
  const dayShare = Math.max(0.05, 1 - nightShare);
  const h = normalizeSolarHour(hour);
  const sinceSunrise = normalizeSolarHour(h - getSunriseHour(planetType, data));
  const cycleProgress = Math.min(1, sinceSunrise / 24);
  const phase: 'day' | 'night' = cycleProgress < dayShare - 1e-9 ? 'day' : 'night';
  let baseDaylight = 0;
  if (phase === 'day') {
    const dayProgress = cycleProgress / dayShare;
    const duskT = Math.min(1, Math.max(0, (dayProgress - 0.85) / 0.15));
    baseDaylight = dayProgress < 0.85 ? 1 : Number((1 - duskT * duskT * (3 - 2 * duskT)).toFixed(4));
  }
  const stormDaylightMult = weatherDaylightMultiplier(stormActive, rainIntensity, rainLevel);
  const daylight = baseDaylight === 0 ? 0 : Number((baseDaylight * stormDaylightMult).toFixed(3));
  const finiteDay = Number.isFinite(dayLengthTicks) ? dayLengthTicks : 0;
  return {
    cycleTick: Math.round(cycleProgress * finiteDay),
    dayLengthTicks: finiteDay,
    nightShare,
    dayShare,
    cycleProgress,
    phase,
    daylight,
    hourOfDay: h,
    clockText: formatClock(h),
    stormActive,
    stormDaylightMult,
  };
}

/** The environment `cycleTick` ticks after sunrise (a position in the solar day; see {@link computeEnvironmentAtHour}). */
export function computeEnvironmentAtCycleTick(
  planetType: PlanetType,
  cycleTick: number,
  data?: CompiledDataLike,
  stormActive = false,
): EnvironmentState {
  const dayLengthTicks = getDayLengthTicks(data);
  const wrapped = ((cycleTick % dayLengthTicks) + dayLengthTicks) % dayLengthTicks;
  const hour = getSunriseHour(planetType, data) + (wrapped / dayLengthTicks) * 24;
  const env = computeEnvironmentAtHour(planetType, hour, data, false, dayLengthTicks);
  if (!stormActive) return env;
  const stormDaylightMult = 0.5;
  return {
    ...env,
    stormActive: true,
    stormDaylightMult,
    daylight: env.daylight === 0 ? 0 : Number((env.daylight * stormDaylightMult).toFixed(4)),
  };
}

/** The solar hour of `'day'` (12:00), `'morning'` (06:00), `'night'` (18:00), `'midnight'`, or `'HH:MM'`; null if unreadable. */
export function hourForTimeSpec(target: string): number | null {
  const trimmed = target.trim().toLowerCase();
  if (trimmed === 'day' || trimmed === 'midday' || trimmed === 'noon') return 12;
  if (trimmed === 'morning' || trimmed === 'sunrise' || trimmed === 'dawn') return 6;
  if (trimmed === 'night' || trimmed === 'sunset' || trimmed === 'dusk') return SUNSET_HOUR;
  if (trimmed === 'midnight') return 0;
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(trimmed);
  return m ? (Number(m[1]) % 24) + (Number(m[2] ?? '0') % 60) / 60 : null;
}

/** Converts a time spec (see {@link hourForTimeSpec}; unreadable → 12:00) into a `cycleTick` (ticks after sunrise). */
export function cycleTickForTimeSpec(target: string, planetType: PlanetType, data?: CompiledDataLike): number {
  const dayLengthTicks = getDayLengthTicks(data);
  const sinceSunrise = normalizeSolarHour((hourForTimeSpec(target) ?? 12) - getSunriseHour(planetType, data));
  return Math.round((sinceSunrise / 24) * dayLengthTicks) % dayLengthTicks;
}

/** The environment of the planet's solar clock at `tickF` (default: now), with the planet's own day length. */
export function environmentFromPlanetTime(
  state: PlanetState,
  data?: CompiledDataLike,
  stormActive?: boolean,
  tickF?: number,
): EnvironmentState {
  const pt = getPlanetTime(state, data, tickF);
  const rawWeather = state.blobs?.weather as
    | { value?: unknown; stormActive?: boolean; rainIntensity?: number; rainLevel?: 'none' | 'minor' | 'heavy' }
    | undefined;
  const weather = (
    rawWeather && typeof rawWeather === 'object' && 'value' in rawWeather && rawWeather.value
      ? rawWeather.value
      : rawWeather
  ) as { stormActive?: boolean; rainIntensity?: number; rainLevel?: 'none' | 'minor' | 'heavy' } | undefined;
  const isStorm = stormActive !== undefined ? Boolean(stormActive || weather?.stormActive) : Boolean(weather?.stormActive);
  const rainIntensity = typeof weather?.rainIntensity === 'number' && Number.isFinite(weather.rainIntensity) ? weather.rainIntensity : 0;
  const rainLevel = weather?.rainLevel === 'minor' || weather?.rainLevel === 'heavy' ? weather.rainLevel : 'none';
  return computeEnvironmentAtHour(
    state.meta.planetType,
    pt.hour,
    data,
    isStorm,
    dayLengthTicksFor(pt.realHoursPerDay, pt.timeScale),
    rainIntensity,
    rainLevel,
  );
}

export function getEnvironment(state: PlanetState, data?: CompiledDataLike): EnvironmentState {
  const existing = state.blobs.environment?.value as EnvironmentState | undefined;
  if (existing && typeof existing.daylight === 'number') return existing;
  return environmentFromPlanetTime(state, data);
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

/**
 * Slot 1: the environment follows the planetary solar clock (`getPlanetTime`) every step; it keeps no clock of its
 * own, so the HUD clock, Solar output, brownouts and the 3D sun (`dayNightSync`) read the same time.
 */
const environmentSystem = defineSystem({
  id: 'environment.dayCycle',
  slot: 1,
  wave: 'W02',
  run(state, ctx) {
    dataRow(ctx.data, 'economyT1Basic', 'dayCycle'); // the W02 row (night shares) must exist when W02 is on
    const prev = state.blobs.environment?.value as Partial<EnvironmentState> | undefined;
    applyEnvironmentState(state, environmentFromPlanetTime(state, ctx.data, prev?.stormActive === true, ctx.tick), ctx.tick);
  },
});

export default defineSimModule({
  id: 'environment',
  wave: 'W02',
  systems: [environmentSystem],
});
