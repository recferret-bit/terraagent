import { ENTITY_STATE } from '../../ecs/columns';
import { rowOf, setField } from '../../ecs/store';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { defineSystem } from '../../kernel/system';
import { defineSimModule } from '../define';
import { recomputeAllColonyPower } from '../power-core';
import { devLightningHandler } from './lightning';
import { devMeteorHandler } from './meteor';
import { devRainHandler, devStormHandler } from './stormRain';
import { applyTwisterVortexAt, cosDet, devTwisterHandler, resolveTwisterFallingUnits, sinDet } from './twister';
import {
  getWeatherState,
  inBounds,
  saveWeatherState,
  TWISTER_SPEED_HEX_PER_TICK,
  WEATHER_BLOB_KEY,
  type ActiveTwisterState,
} from './types';

export * from './types';
export * from './meteor';
export * from './lightning';
export * from './stormRain';
export * from './twister';

/**
 * Steps active console-spawned twisters and cleans up expired building lightning-overload timers.
 * Weather hazards are strictly console-driven (`dev.meteor`, `dev.lightning`, `dev.twister`, `dev.storm`, `dev.rain`),
 * so idle planets without an active weather blob do nothing.
 */
export function stepWeather(state: PlanetState, ctx: StepContext): void {
  if (!state.blobs[WEATHER_BLOB_KEY]) return;

  const weather = getWeatherState(state);
  let changed = false;
  let recomputePower = false;

  for (const [idStr, untilTick] of Object.entries(weather.overloadUntilByEntity)) {
    const entityId = Number(idStr);
    if (ctx.tick >= untilTick) {
      delete weather.overloadUntilByEntity[entityId];
      const row = rowOf(state.entities, entityId);
      if (row >= 0 && state.entities.cols.state[row] === ENTITY_STATE.offlineOverload) {
        setField(state.entities, row, 'state', ENTITY_STATE.active, ctx.tick);
      }
      changed = true;
      recomputePower = true;
    }
  }

  if (weather.activeTwisters.length > 0) {
    const remaining: ActiveTwisterState[] = [];
    for (const twister of weather.activeTwisters) {
      const age = ctx.tick - twister.startTick;
      if (age >= 4 && age <= twister.durationTicks) {
        const turn =
          sinDet(age * 0.24 + twister.id * 1.7) * 0.12 +
          cosDet(age * 0.11 + twister.id * 0.9) * 0.08;
        twister.dirRad = Number((twister.dirRad + turn).toFixed(4));
        twister.dx = Number((cosDet(twister.dirRad) * TWISTER_SPEED_HEX_PER_TICK).toFixed(4));
        twister.dy = Number((sinDet(twister.dirRad) * TWISTER_SPEED_HEX_PER_TICK).toFixed(4));
        const nextX = twister.x + twister.dx;
        const nextY = twister.y + twister.dy;
        const rq = Math.round(nextX);
        const rr = Math.round(nextY);
        if (inBounds(state.grid.radius, rq, rr)) {
          twister.x = Number(nextX.toFixed(4));
          twister.y = Number(nextY.toFixed(4));
        } else {
          twister.dirRad = Number((twister.dirRad + Math.PI).toFixed(4));
          twister.dx = -twister.dx;
          twister.dy = -twister.dy;
        }
        applyTwisterVortexAt(
          state,
          twister,
          Math.round(twister.x),
          Math.round(twister.y),
          ctx.tick,
          ctx.data,
        );
      }

      resolveTwisterFallingUnits(state, twister, ctx.tick, age >= twister.durationTicks);

      if (age <= twister.durationTicks + 10) {
        remaining.push(twister);
      }
      changed = true;
    }
    weather.activeTwisters = remaining;
  }

  if (changed) {
    saveWeatherState(state, weather, ctx.tick);
  }
  if (recomputePower) {
    recomputeAllColonyPower(state, ctx.data, ctx.tick);
  }
}

export const weatherSystem = defineSystem({
  id: 'weather',
  slot: 5,
  wave: 'W05',
  run(state, ctx) {
    stepWeather(state, ctx);
  },
});

export const weather = defineSimModule({
  id: 'weather',
  wave: 'W05',
  systems: [weatherSystem],
  handlers: [
    devMeteorHandler,
    devLightningHandler,
    devTwisterHandler,
    devRainHandler,
    devStormHandler,
  ],
});

export default weather;
