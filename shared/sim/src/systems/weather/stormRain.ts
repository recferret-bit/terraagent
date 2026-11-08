import { defineCommandHandler } from '../../kernel/commands';
import type { StepContext } from '../../kernel/context';
import { setBlob, type PlanetState } from '../../kernel/state';
import { ensureColony } from '../economy/buildingRows';
import { applyEnvironmentState, environmentFromPlanetTime } from '../environment';
import { recomputeAllColonyPower } from '../power-core';
import { triggerLightningStrike } from './lightning';
import {
  getColonyWindFactor,
  getWeatherState,
  saveWeatherState,
  type SimRainLevel,
  type WeatherBlobState,
} from './types';

export interface RainCommandArgs {
  level?: SimRainLevel;
  intensity?: number;
  colonyIndex?: number;
}

export interface StormCommandArgs {
  active?: boolean;
  rain?: SimRainLevel;
  lightning?: boolean;
  colonyIndex?: number;
}

export function intensityForRainLevel(level: SimRainLevel): number {
  if (level === 'minor') return 0.35;
  if (level === 'heavy') return 0.85;
  return 0;
}

export function rainLevelFromIntensity(intensity: number): SimRainLevel {
  if (intensity <= 0.01) return 'none';
  if (intensity <= 0.5) return 'minor';
  return 'heavy';
}

/** Updates the planet's rain level and intensity in `s.blobs.weather`. */
export function setRainState(
  state: PlanetState,
  args: RainCommandArgs = {},
  ctx?: Partial<Pick<StepContext, 'tick' | 'data' | 'emit'>>,
): WeatherBlobState {
  const tick = ctx?.tick ?? state.meta.tick;
  const weather = getWeatherState(state);

  let level: SimRainLevel;
  let intensity: number;

  if (args.level !== undefined && args.intensity !== undefined) {
    level = args.level;
    intensity = Math.max(0, Math.min(1, args.intensity));
  } else if (args.level !== undefined) {
    level = args.level;
    intensity = intensityForRainLevel(level);
  } else if (args.intensity !== undefined) {
    intensity = Math.max(0, Math.min(1, args.intensity));
    level = rainLevelFromIntensity(intensity);
  } else {
    level = weather.rainLevel === 'none' ? 'minor' : weather.rainLevel === 'minor' ? 'heavy' : 'none';
    intensity = intensityForRainLevel(level);
  }

  weather.rainLevel = level;
  weather.rainIntensity = intensity;
  saveWeatherState(state, weather, tick);

  const env = environmentFromPlanetTime(state, ctx?.data, weather.stormActive, tick);
  applyEnvironmentState(state, env, tick);
  recomputeAllColonyPower(state, ctx?.data, tick);
  return weather;
}

export const applyDevRain = setRainState;

/** Toggles or sets planetary storm state, syncing environment daylight, wind, rain, and optional lightning strike. */
export function setStormState(
  state: PlanetState,
  args: StormCommandArgs = {},
  ctx?: Partial<Pick<StepContext, 'tick' | 'data' | 'emit'>>,
): WeatherBlobState {
  const tick = ctx?.tick ?? state.meta.tick;
  const colIdx = typeof args.colonyIndex === 'number' && args.colonyIndex >= 0 ? args.colonyIndex : 0;
  const weather = getWeatherState(state);
  const nextActive = args.active !== undefined ? Boolean(args.active) : !weather.stormActive;

  weather.stormActive = nextActive;

  if (nextActive) {
    const rainLevel: SimRainLevel = args.rain ?? 'heavy';
    weather.rainLevel = rainLevel;
    weather.rainIntensity = intensityForRainLevel(rainLevel);
    saveWeatherState(state, weather, tick);

    const env = environmentFromPlanetTime(state, ctx?.data, true, tick);
    applyEnvironmentState(state, env, tick);

    const curWind = getColonyWindFactor(state, colIdx, tick, ctx?.data);
    if (curWind < 1.35) {
      const colony = ensureColony(state, colIdx, tick) as unknown as {
        windFactor?: number;
        windFactorOverride?: number;
        windFactorBp?: number;
        changedAt: number;
      };
      colony.windFactor = 1.35;
      colony.windFactorOverride = 1.35;
      colony.windFactorBp = 13500;
      colony.changedAt = tick;
      setBlob(state, 'wind', { factor: 1.35, factorBp: 13500, pct: 135, override: true }, tick);
    }

    recomputeAllColonyPower(state, ctx?.data, tick);
    ctx?.emit?.({
      kind: 'stormStarted',
      severity: 'warn',
      colonyIds: [colIdx],
      data: {
        planetId: state.meta.planetId,
        kind: 'electrical',
        durationS: 60,
      },
    });

    if (args.lightning !== false) {
      triggerLightningStrike(state, { colonyIndex: colIdx }, ctx);
    }
    return getWeatherState(state);
  }

  const rainLevel: SimRainLevel = args.rain ?? 'none';
  weather.rainLevel = rainLevel;
  weather.rainIntensity = intensityForRainLevel(rainLevel);
  saveWeatherState(state, weather, tick);

  const env = environmentFromPlanetTime(state, ctx?.data, false, tick);
  applyEnvironmentState(state, env, tick);
  recomputeAllColonyPower(state, ctx?.data, tick);

  ctx?.emit?.({
    kind: 'stormEnded',
    severity: 'info',
    colonyIds: [colIdx],
    data: {
      planetId: state.meta.planetId,
      kind: 'electrical',
    },
  });

  return weather;
}

export const applyDevStorm = setStormState;

export const devRainHandler = defineCommandHandler({
  kind: 'dev.rain',
  wave: 'W05',
  handle(state, cmd, ctx) {
    const args = (cmd.args ?? {}) as RainCommandArgs;
    if (
      args.level !== undefined &&
      args.level !== 'none' &&
      args.level !== 'minor' &&
      args.level !== 'heavy'
    ) {
      return 'invalid_args';
    }
    if (args.intensity !== undefined && (typeof args.intensity !== 'number' || args.intensity < 0 || args.intensity > 1)) {
      return 'invalid_args';
    }
    const colonyIndex = args.colonyIndex ?? (typeof cmd.colonyIndex === 'number' ? cmd.colonyIndex : 0);
    setRainState(state, { ...args, colonyIndex }, ctx);
  },
});

export const devStormHandler = defineCommandHandler({
  kind: 'dev.storm',
  wave: 'W05',
  handle(state, cmd, ctx) {
    const args = (cmd.args ?? {}) as StormCommandArgs;
    const colonyIndex = args.colonyIndex ?? (typeof cmd.colonyIndex === 'number' ? cmd.colonyIndex : 0);
    setStormState(state, { ...args, colonyIndex }, ctx);
  },
});
