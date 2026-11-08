import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { rowOf, setField } from '../../ecs/store';
import { hexIndex } from '../../grid/hex';
import { PREP, TERRAIN } from '../../grid/layers';
import { bumpPathEpoch } from '../../grid/tileModel';
import { defineCommandHandler } from '../../kernel/commands';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import { nextFloat } from '../../kernel/rng';
import { touchTile, type PlanetState } from '../../kernel/state';
import { isUnitKind } from '../../units/mobility';
import { cancelMove } from '../../units/movement/orchestrator';
import { recomputeAllColonyPower } from '../power-core';
import {
  destroyHazardEntity,
  footprintTilesOfEntity,
  getColonyWindFactor,
  getWeatherState,
  inBounds,
  resolveDefaultHazardTile,
  saveWeatherState,
  TWISTER_DURATION_TICKS,
  TWISTER_FALL_DELAY_TICKS,
  TWISTER_MIN_WIND_FACTOR,
  TWISTER_RISE_TICKS,
  TWISTER_SPEED_HEX_PER_TICK,
  type ActiveTwisterState,
} from './types';

export interface TwisterCommandArgs {
  q?: number;
  r?: number;
  dirDeg?: number;
  colonyIndex?: number;
}

export type TwisterSpawnResult =
  | {
      ok: true;
      twister: ActiveTwisterState;
    }
  | {
      ok: false;
      code: 'weather_conditions_not_met' | 'out_of_bounds' | 'invalid_args';
      detail: string;
    };

const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI / 2;

/** Deterministic `sin(rad)` using only IEEE-754 `+ - * /` (SIM-D-06 compliant). */
export function sinDet(rad: number): number {
  let x = rad - Math.floor((rad + Math.PI) / TWO_PI) * TWO_PI;
  if (x > HALF_PI) x = Math.PI - x;
  else if (x < -HALF_PI) x = -Math.PI - x;
  const x2 = x * x;
  return x * (1 - x2 * (1 / 6 - x2 * (1 / 120 - x2 / 5040)));
}

/** Deterministic `cos(rad)` using only IEEE-754 `+ - * /` (SIM-D-06 compliant). */
export function cosDet(rad: number): number {
  return sinDet(rad + HALF_PI);
}

function canTwisterAffect(kind: number, state: number): boolean {
  if (kind === ENTITY_KIND.commandHub) return false;
  if (kind === ENTITY_KIND.pod && state === ENTITY_STATE.descending) return false;
  return true;
}

function isSuckableUnit(kind: number): boolean {
  if (kind === ENTITY_KIND.hq || kind === ENTITY_KIND.pod || kind === ENTITY_KIND.commandHub) return false;
  return (
    kind === ENTITY_KIND.worker ||
    kind === 17 ||
    kind === 18 ||
    kind === 19 ||
    kind === 20 ||
    isUnitKind(kind)
  );
}

/** Checks whether the planet & colony currently meet twister spawn conditions (wind >= 115..120% and minor rain). */
export function canSpawnTwister(
  state: PlanetState,
  colonyIndex = 0,
  tick = state.meta.tick,
  data?: CompiledDataLike,
): { ok: true } | { ok: false; code: 'weather_conditions_not_met'; detail: string } {
  const weather = getWeatherState(state);
  const windFactor = getColonyWindFactor(state, colonyIndex, tick, data);
  const hasHighWind = windFactor + 1e-6 >= Math.min(1.15, TWISTER_MIN_WIND_FACTOR);
  const hasMinorRain =
    weather.rainLevel === 'minor' ||
    (weather.rainLevel !== 'heavy' && weather.rainIntensity > 0.005 && weather.rainIntensity <= 0.55);

  if (!hasHighWind || !hasMinorRain) {
    return {
      ok: false,
      code: 'weather_conditions_not_met',
      detail: 'Twister requires high wind (>=120%) and minor rain',
    };
  }
  return { ok: true };
}

export const checkTwisterAllowed = canSpawnTwister;

export const MAX_TWISTER_UPROOTED_TREES = 64;

/** Applies a twister's vortex effects (uprooting trees, sucking units, damaging buildings) around `(centerQ, centerR)`. */
export function applyTwisterVortexAt(
  state: PlanetState,
  twister: ActiveTwisterState,
  centerQ: number,
  centerR: number,
  tick: number,
  data?: CompiledDataLike,
): void {
  const radius = state.grid.radius;
  const hx = hexIndex(radius);
  const L = state.grid.layers;
  const vortexTiles: Array<{ q: number; r: number }> = [];

  for (let dq = -2; dq <= 2; dq++) {
    for (let dr = Math.max(-2, -dq - 2); dr <= Math.min(2, -dq + 2); dr++) {
      const tq = centerQ + dq;
      const tr = centerR + dr;
      if (hx.indexOf(tq, tr) >= 0) vortexTiles.push({ q: tq, r: tr });
    }
  }

  let uprootedAny = false;
  for (const t of vortexTiles) {
    const idx = hx.indexOf(t.q, t.r);
    if (idx >= 0 && L.terrain[idx] === TERRAIN.forest) {
      L.terrain[idx] = TERRAIN.flat;
      L.prep[idx] = PREP.wild;
      touchTile(state, idx, tick);
      if (twister.uprootedTrees.length >= MAX_TWISTER_UPROOTED_TREES) {
        twister.uprootedTrees.shift();
      }
      twister.uprootedTrees.push({ q: t.q, r: t.r, suckedAtTick: tick });
      uprootedAny = true;
    }
  }
  if (uprootedAny) bumpPathEpoch(state.meta);

  const vortexKeys = new Set(vortexTiles.map((t) => `${t.q},${t.r}`));
  const e = state.entities, cols = e.cols;
  const toDestroyBuildings: number[] = [];

  for (let row = 0; row < e.count; row++) {
    if (cols.hp[row] <= 0) continue;
    const id = cols.id[row];
    const kind = cols.kind[row];
    if (!canTwisterAffect(kind, cols.state[row])) continue;

    const fp = footprintTilesOfEntity(state, row);
    if (!fp.some((t) => vortexKeys.has(`${t.q},${t.r}`))) continue;

    if (isSuckableUnit(kind)) {
      if (!twister.suckedUnits.some((u) => u.id === id)) {
        cancelMove(state, id, tick);
        setField(e, row, 'state', ENTITY_STATE.waiting, tick);
        twister.suckedUnits.push({
          id,
          kind,
          owner: cols.owner[row],
          tier: cols.tier[row] || 1,
          q: cols.q[row],
          r: cols.r[row],
          suckedAtTick: tick,
          fallTick: tick + TWISTER_FALL_DELAY_TICKS,
          dead: false,
        });
      }
      continue;
    }

    if (kind === ENTITY_KIND.hq || kind === ENTITY_KIND.pod) {
      if (!twister.damagedEntityIds.includes(id)) twister.damagedEntityIds.push(id);
      toDestroyBuildings.push(id);
      continue;
    }

    const nextHp = Math.max(0, cols.hp[row] - 25);
    setField(e, row, 'hp', nextHp, tick);
    if (!twister.damagedEntityIds.includes(id)) twister.damagedEntityIds.push(id);
    if (nextHp <= 0) {
      toDestroyBuildings.push(id);
    }
  }

  if (toDestroyBuildings.length > 0) {
    for (const id of toDestroyBuildings) {
      destroyHazardEntity(state, id, tick, data);
    }
    recomputeAllColonyPower(state, data, tick);
  }
}

/** Kills any sucked units whose airborne `fallTick` has been reached (SIM-M-01 compliant: no position writes). */
export function resolveTwisterFallingUnits(
  state: PlanetState,
  twister: ActiveTwisterState,
  tick: number,
  forceAll = false,
): void {
  for (const u of twister.suckedUnits) {
    if (u.dead) continue;
    if (!forceAll && tick < u.fallTick) continue;
    u.dead = true;
    const row = rowOf(state.entities, u.id);
    if (row >= 0) {
      destroyHazardEntity(state, u.id, tick);
    }
  }
}

/** Spawns a rising twister that travels in a random direction, sucking up trees/units and damaging buildings. */
export function triggerTwister(
  state: PlanetState,
  args: TwisterCommandArgs = {},
  ctx?: Partial<Pick<StepContext, 'tick' | 'data' | 'emit' | 'rng'>>,
): TwisterSpawnResult {
  const tick = ctx?.tick ?? state.meta.tick;
  const colIdx = typeof args.colonyIndex === 'number' && args.colonyIndex >= 0 ? args.colonyIndex : 0;

  const check = canSpawnTwister(state, colIdx, tick, ctx?.data);
  if (!check.ok) return check;

  let q: number;
  let r: number;
  if (args.q !== undefined || args.r !== undefined) {
    if (
      typeof args.q !== 'number' ||
      typeof args.r !== 'number' ||
      !Number.isInteger(args.q) ||
      !Number.isInteger(args.r)
    ) {
      return { ok: false, code: 'out_of_bounds', detail: 'Twister target coordinates must be in-bounds integers' };
    }
    if (!inBounds(state.grid.radius, args.q, args.r)) {
      return { ok: false, code: 'out_of_bounds', detail: `Tile (${args.q}, ${args.r}) is outside the planet` };
    }
    q = args.q;
    r = args.r;
  } else {
    const def = resolveDefaultHazardTile(state, colIdx, 2, -1);
    q = def.q;
    r = def.r;
  }

  const rngStream = ctx?.rng ? ctx.rng('weather') : state.rng.weather;
  const dirRad =
    typeof args.dirDeg === 'number' && Number.isFinite(args.dirDeg)
      ? (args.dirDeg * Math.PI) / 180
      : nextFloat(rngStream) * TWO_PI;

  const dx = Number((cosDet(dirRad) * TWISTER_SPEED_HEX_PER_TICK).toFixed(4));
  const dy = Number((sinDet(dirRad) * TWISTER_SPEED_HEX_PER_TICK).toFixed(4));

  const weather = getWeatherState(state);
  const twister: ActiveTwisterState = {
    id: weather.nextTwisterId++,
    startQ: q,
    startR: r,
    x: q,
    y: r,
    dx,
    dy,
    dirRad,
    startTick: tick,
    riseTicks: TWISTER_RISE_TICKS,
    durationTicks: TWISTER_DURATION_TICKS,
    suckedUnits: [],
    uprootedTrees: [],
    damagedEntityIds: [],
  };

  applyTwisterVortexAt(state, twister, q, r, tick, ctx?.data);
  weather.activeTwisters.push(twister);
  saveWeatherState(state, weather, tick);

  const colId = state.colonies[colIdx]?.id;
  ctx?.emit?.({
    kind: 'twisterStarted',
    severity: 'warn',
    colonyIds: [colIdx],
    data: {
      planetId: state.meta.planetId,
      ...(colId ? { colonyId: colId } : {}),
      twisterId: twister.id,
      q,
      r,
      dirRad,
      durationTicks: twister.durationTicks,
    },
  });

  return { ok: true, twister };
}

export const applyDevTwister = triggerTwister;

export const devTwisterHandler = defineCommandHandler({
  kind: 'dev.twister',
  wave: 'W05',
  handle(state, cmd, ctx) {
    const args = (cmd.args ?? {}) as TwisterCommandArgs;
    const colonyIndex = args.colonyIndex ?? (typeof cmd.colonyIndex === 'number' ? cmd.colonyIndex : 0);
    const res = triggerTwister(state, { ...args, colonyIndex }, ctx);
    if (!res.ok) return { code: res.code, detail: res.detail };
  },
});
