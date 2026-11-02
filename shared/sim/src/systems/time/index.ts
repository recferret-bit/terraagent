import type { CompiledRow } from '../../data';
import { defineCommandHandler } from '../../kernel/commands';
import type { CompiledDataLike } from '../../kernel/config';
import { TICK_MS } from '../../kernel/constants';
import { setBlob, type PlanetState } from '../../kernel/state';
import { defineSystem } from '../../kernel/system';
import { defineSimModule } from '../define';
import { rowNum, w01Row } from '../rows';

export const PLANET_TIME_BLOB_KEY = 'planetTime';

export const DEFAULT_REAL_HOURS_PER_DAY = 0.25;
export const DEFAULT_TIME_SCALE = 1;
export const DEFAULT_START_HOUR = 9;
export const DEFAULT_DAWN_HOUR = 5.5;
export const DEFAULT_DUSK_HOUR = 18.5;

export interface PlanetTimeAnchor {
  /** Planetary solar hour [0, 24) at `anchorTick`. */
  readonly baseHour: number;
  /** Cumulative planetary days elapsed at `anchorTick` (integer >= 0). */
  readonly baseDay: number;
  /** Sim tick at which `baseHour` and `baseDay` were anchored. */
  readonly anchorTick: number;
  /** Configured real-world hours for 1 full planetary day (24 solar hours). */
  readonly realHoursPerDay: number;
  /** Time-scale multiplier (0 = paused solar cycle, 1 = normal, >1 = accelerated). */
  readonly timeScale: number;
  /** True when `realHoursPerDay` was explicitly set by command rather than table defaults. */
  readonly customDayHours?: boolean;
  /** True when `timeScale` was explicitly set by command rather than table defaults. */
  readonly customTimeScale?: boolean;
}

export type SolarDayPhase = 'dawn' | 'day' | 'dusk' | 'night';

export interface PlanetTimeView {
  /** Current planetary time of day in solar hours [0, 24). */
  readonly hour: number;
  /** Alias for `hour`: current planetary time of day in solar hours [0, 24). */
  readonly timeOfDay: number;
  /** Named solar phase ('dawn' | 'day' | 'dusk' | 'night'). */
  readonly phase: SolarDayPhase;
  /** Normalized solar cycle fraction [0, 1) where 0 = midnight, 0.25 = 06:00, 0.5 = 12:00 noon, 0.75 = 18:00. */
  readonly cyclePhase: number;
  /** Planetary day index (integer >= 0). */
  readonly day: number;
  /** Smooth daylight factor [0, 1] (0 at night, 1 at solar noon). */
  readonly daylight: number;
  /** True when `hour` is outside `[dawnHour, duskHour)`. */
  readonly isNight: boolean;
  /** Configured real-world hours for 1 full planetary day (24 solar hours). */
  readonly realHoursPerDay: number;
  /** Configured time-scale multiplier for planetary time progression. */
  readonly timeScale: number;
  /** Underlying anchor state for continuous fractional-tick interpolation on clients. */
  readonly anchor: PlanetTimeAnchor;
}

export interface PlanetTimePatch {
  readonly timeOfDay?: number;
  readonly realHoursPerDay?: number;
  readonly timeScale?: number;
}

export interface TimeCycleConfig {
  readonly realHoursPerDay: number;
  readonly timeScale: number;
  readonly startHour: number;
  readonly dawnHour: number;
  readonly duskHour: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function normalizeSolarHour(hour: number): number {
  if (!Number.isFinite(hour)) return DEFAULT_START_HOUR;
  const wrapped = hour - Math.floor(hour / 24) * 24;
  return wrapped >= 24 ? 0 : wrapped < 0 ? wrapped + 24 : wrapped;
}

export const wrapPlanetHour = normalizeSolarHour;

/** Reads `time.cycle` from compiled data, falling back to W00/W01 defaults. */
export function resolveTimeCycleConfig(data?: CompiledDataLike): TimeCycleConfig {
  try {
    const row: CompiledRow = w01Row(data, 'time', 'cycle');
    return {
      realHoursPerDay: clamp(rowNum(row, 'realHoursPerDay'), 0.005, 168),
      timeScale: clamp(rowNum(row, 'timeScale'), 0, 1000),
      startHour: normalizeSolarHour(rowNum(row, 'startHour')),
      dawnHour: clamp(rowNum(row, 'dawnHour'), 0, 12),
      duskHour: clamp(rowNum(row, 'duskHour'), 12, 24),
    };
  } catch {
    return {
      realHoursPerDay: DEFAULT_REAL_HOURS_PER_DAY,
      timeScale: DEFAULT_TIME_SCALE,
      startHour: DEFAULT_START_HOUR,
      dawnHour: DEFAULT_DAWN_HOUR,
      duskHour: DEFAULT_DUSK_HOUR,
    };
  }
}

function extractRawAnchor(source: PlanetState | Record<string, unknown> | undefined | null): PlanetTimeAnchor | null {
  if (!source || typeof source !== 'object') return null;
  const blobs = 'blobs' in source && source.blobs && typeof source.blobs === 'object'
    ? (source.blobs as Record<string, unknown>)
    : (source as Record<string, unknown>);
  const entry = blobs[PLANET_TIME_BLOB_KEY];
  if (!entry || typeof entry !== 'object') return null;
  const cand = ('value' in entry && entry.value && typeof entry.value === 'object'
    ? entry.value
    : entry) as Partial<PlanetTimeAnchor>;
  if (typeof cand.baseHour !== 'number' || typeof cand.anchorTick !== 'number') return null;
  return {
    baseHour: normalizeSolarHour(cand.baseHour),
    baseDay: typeof cand.baseDay === 'number' && Number.isFinite(cand.baseDay) ? Math.max(0, Math.floor(cand.baseDay)) : 0,
    anchorTick: Math.max(0, Math.floor(cand.anchorTick)),
    realHoursPerDay: typeof cand.realHoursPerDay === 'number' && Number.isFinite(cand.realHoursPerDay)
      ? clamp(cand.realHoursPerDay, 0.005, 168)
      : DEFAULT_REAL_HOURS_PER_DAY,
    timeScale: typeof cand.timeScale === 'number' && Number.isFinite(cand.timeScale)
      ? clamp(cand.timeScale, 0, 1000)
      : DEFAULT_TIME_SCALE,
    ...(cand.customDayHours ? { customDayHours: true } : {}),
    ...(cand.customTimeScale ? { customTimeScale: true } : {}),
  };
}

/** Resolves the effective planet time anchor from state/view blobs and compiled balance data. */
export function getPlanetTimeAnchor(
  stateOrBlobs?: PlanetState | Record<string, unknown> | null,
  data?: CompiledDataLike,
): PlanetTimeAnchor {
  const cfg = resolveTimeCycleConfig(data);
  const raw = extractRawAnchor(stateOrBlobs);
  if (!raw) {
    return {
      baseHour: cfg.startHour,
      baseDay: 0,
      anchorTick: 0,
      realHoursPerDay: cfg.realHoursPerDay,
      timeScale: cfg.timeScale,
    };
  }
  return {
    ...raw,
    realHoursPerDay: raw.customDayHours ? raw.realHoursPerDay : cfg.realHoursPerDay,
    timeScale: raw.customTimeScale ? raw.timeScale : cfg.timeScale,
  };
}

/** Pure deterministic daylight curve [0, 1] without trig or exponentiation (SIM-D-06). */
export function computeDeterministicDaylight(hour: number, dawnHour = DEFAULT_DAWN_HOUR, duskHour = DEFAULT_DUSK_HOUR): number {
  const h = normalizeSolarHour(hour);
  const mid = 0.5 * (dawnHour + duskHour);
  const halfDay = Math.max(1, 0.5 * (duskHour - dawnHour) * (12 / 6.5));
  const dist = Math.abs(h - mid);
  const u = clamp(1 - dist / halfDay, 0, 1);
  return u * u * (3 - 2 * u);
}

export function computeSolarPhase(hour: number, dawnHour = DEFAULT_DAWN_HOUR, duskHour = DEFAULT_DUSK_HOUR): SolarDayPhase {
  const h = normalizeSolarHour(hour);
  if (h >= dawnHour - 0.5 && h < dawnHour + 1.5) return 'dawn';
  if (h >= dawnHour + 1.5 && h < duskHour - 1.5) return 'day';
  if (h >= duskHour - 1.5 && h < duskHour + 0.5) return 'dusk';
  return 'night';
}

/** Computes the exact planetary solar time at `tickF` (integer tick on server, or fractional serverTickF on client). */
export function computePlanetTimeAtTick(
  anchorOrState: PlanetTimeAnchor | PlanetState,
  tickF: number,
  data?: CompiledDataLike,
): PlanetTimeView {
  const anchor: PlanetTimeAnchor = 'blobs' in anchorOrState
    ? getPlanetTimeAnchor(anchorOrState, data)
    : anchorOrState;
  const cfg = resolveTimeCycleConfig(data);
  const elapsedTicks = Math.max(0, (Number.isFinite(tickF) ? tickF : 0) - anchor.anchorTick);
  const elapsedRealHours = (elapsedTicks * TICK_MS) / 3_600_000;
  const deltaDays = anchor.realHoursPerDay > 0 ? (elapsedRealHours * anchor.timeScale) / anchor.realHoursPerDay : 0;
  const totalHours = anchor.baseHour + deltaDays * 24;
  const addedDays = Math.floor(totalHours / 24);
  const hour = normalizeSolarHour(totalHours - addedDays * 24);
  const day = Math.max(0, anchor.baseDay + addedDays);
  const cyclePhase = hour / 24;
  const phase = computeSolarPhase(hour, cfg.dawnHour, cfg.duskHour);
  const isNight = hour < cfg.dawnHour || hour >= cfg.duskHour;
  const daylight = computeDeterministicDaylight(hour, cfg.dawnHour, cfg.duskHour);
  return {
    hour,
    timeOfDay: hour,
    phase,
    cyclePhase,
    day,
    daylight,
    isNight,
    realHoursPerDay: anchor.realHoursPerDay,
    timeScale: anchor.timeScale,
    anchor,
  };
}

/** Reads the current planetary solar time from `state` at `tickF` (defaults to `state.meta.tick`). */
export function getPlanetTime(state: PlanetState, data?: CompiledDataLike, tickF?: number): PlanetTimeView {
  const anchor = getPlanetTimeAnchor(state, data);
  return computePlanetTimeAtTick(anchor, tickF ?? state.meta.tick, data);
}

function buildPatchedTimeAnchor(
  state: PlanetState,
  patch: PlanetTimePatch,
  tick = state.meta.tick,
  data?: CompiledDataLike,
): PlanetTimeAnchor {
  const prevRaw = extractRawAnchor(state);
  const current = getPlanetTime(state, data, tick);
  const hasDayHours = typeof patch.realHoursPerDay === 'number' && Number.isFinite(patch.realHoursPerDay);
  const hasTimeScale = typeof patch.timeScale === 'number' && Number.isFinite(patch.timeScale);
  const hasTimeOfDay = typeof patch.timeOfDay === 'number' && Number.isFinite(patch.timeOfDay);

  return {
    baseHour: hasTimeOfDay ? normalizeSolarHour(patch.timeOfDay!) : current.hour,
    baseDay: current.day,
    anchorTick: Math.max(0, Math.floor(tick)),
    realHoursPerDay: hasDayHours ? clamp(patch.realHoursPerDay!, 0.005, 168) : current.realHoursPerDay,
    timeScale: hasTimeScale ? clamp(patch.timeScale!, 0, 1000) : current.timeScale,
    ...(hasDayHours || prevRaw?.customDayHours ? { customDayHours: true } : {}),
    ...(hasTimeScale || prevRaw?.customTimeScale ? { customTimeScale: true } : {}),
  };
}

/** Pure preview of a planet's solar time after applying `patch` at `tick` without mutating `state` (D-37). */
export function previewPlanetTimePatch(
  state: PlanetState,
  patch: PlanetTimePatch,
  tick = state.meta.tick,
  data?: CompiledDataLike,
): PlanetTimeView {
  return computePlanetTimeAtTick(buildPatchedTimeAnchor(state, patch, tick, data), tick, data);
}

/** Updates a planet's authoritative time anchor at `tick` and records it in `state.blobs.planetTime`. */
export function setPlanetTime(
  state: PlanetState,
  patch: PlanetTimePatch,
  tick = state.meta.tick,
  data?: CompiledDataLike,
): PlanetTimeView {
  const nextAnchor = buildPatchedTimeAnchor(state, patch, tick, data);
  setBlob(state, PLANET_TIME_BLOB_KEY, nextAnchor, tick);
  return computePlanetTimeAtTick(nextAnchor, tick, data);
}

function handleSetPlanetTimeCommand(
  state: PlanetState,
  cmd: { args: unknown },
  ctx: { tick: number; data: CompiledDataLike },
): 'invalid_args' | void {
  const args = (cmd.args ?? {}) as Record<string, unknown>;
  const patch: { timeOfDay?: number; realHoursPerDay?: number; timeScale?: number } = {};
  if (args.timeOfDay !== undefined) {
    if (typeof args.timeOfDay !== 'number' || !Number.isFinite(args.timeOfDay) || args.timeOfDay < 0 || args.timeOfDay > 24) {
      return 'invalid_args';
    }
    patch.timeOfDay = args.timeOfDay;
  }
  if (args.realHoursPerDay !== undefined) {
    if (typeof args.realHoursPerDay !== 'number' || !Number.isFinite(args.realHoursPerDay) || args.realHoursPerDay < 0.005 || args.realHoursPerDay > 168) {
      return 'invalid_args';
    }
    patch.realHoursPerDay = args.realHoursPerDay;
  }
  if (args.timeScale !== undefined) {
    if (typeof args.timeScale !== 'number' || !Number.isFinite(args.timeScale) || args.timeScale < 0 || args.timeScale > 1000) {
      return 'invalid_args';
    }
    patch.timeScale = args.timeScale;
  }
  setPlanetTime(state, patch, ctx.tick, ctx.data);
}

/**
 * Environment slot system (slot 1): when balance overrides (`tune time.cycle.*`) change `realHoursPerDay` or
 * `timeScale` away from an existing anchor's non-custom rate, re-anchors smoothly at `ctx.tick` so solar time
 * never jumps discontinuously. Idle planets with default rates write nothing.
 */
const planetTimeSystem = defineSystem({
  id: 'time.cycle',
  slot: 1,
  wave: 'W01',
  run(state, ctx) {
    const cfg = resolveTimeCycleConfig(ctx.data);
    const raw = extractRawAnchor(state);
    if (!raw) {
      if (cfg.realHoursPerDay !== DEFAULT_REAL_HOURS_PER_DAY || cfg.timeScale !== DEFAULT_TIME_SCALE) {
        const prevTick = Math.max(0, ctx.tick - ctx.dt);
        const defView = computePlanetTimeAtTick(
          {
            baseHour: cfg.startHour,
            baseDay: 0,
            anchorTick: 0,
            realHoursPerDay: DEFAULT_REAL_HOURS_PER_DAY,
            timeScale: DEFAULT_TIME_SCALE,
          },
          prevTick,
          ctx.data,
        );
        setBlob(
          state,
          PLANET_TIME_BLOB_KEY,
          {
            baseHour: defView.hour,
            baseDay: defView.day,
            anchorTick: prevTick,
            realHoursPerDay: cfg.realHoursPerDay,
            timeScale: cfg.timeScale,
          },
          ctx.tick,
        );
      }
      return;
    }
    const nextDayHours = raw.customDayHours ? raw.realHoursPerDay : cfg.realHoursPerDay;
    const nextScale = raw.customTimeScale ? raw.timeScale : cfg.timeScale;
    if (nextDayHours !== raw.realHoursPerDay || nextScale !== raw.timeScale) {
      const prevTick = Math.max(raw.anchorTick, ctx.tick - ctx.dt);
      const prevView = computePlanetTimeAtTick(raw, prevTick, ctx.data);
      setBlob(
        state,
        PLANET_TIME_BLOB_KEY,
        {
          ...raw,
          baseHour: prevView.hour,
          baseDay: prevView.day,
          anchorTick: prevTick,
          realHoursPerDay: nextDayHours,
          timeScale: nextScale,
        },
        ctx.tick,
      );
    }
  },
});

export const time = defineSimModule({
  id: 'time',
  wave: 'W00',
  systems: [planetTimeSystem],
  handlers: [
    defineCommandHandler({
      kind: 'setPlanetTime',
      wave: 'W00',
      handle: handleSetPlanetTimeCommand,
    }),
    defineCommandHandler({
      kind: 'dev.time',
      wave: 'W00',
      handle: handleSetPlanetTimeCommand,
    }),
  ],
});

export default time;
