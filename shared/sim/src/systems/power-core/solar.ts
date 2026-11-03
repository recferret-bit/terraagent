import type { CompiledDataLike } from '../../kernel/config';
import type { PlanetState, PlanetType } from '../../kernel/state';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { getEnvironment } from '../environment';
import { resolvePowerRow } from './index';

export interface SolarOutputBreakdown {
  gross: number;
  internalDrain: number;
  net: number;
  daylight: number;
  desertMultiplier: number;
}

/**
 * Computes Solar Collector Array T1 output (E/s) for a single array (`colony-economy-and-buildings-spec.md` §3.4):
 * - `gross = +21 × daylight × (desert ? 1.35 : 1.0)`
 * - `internalDrain = 1`
 * - `net = gross - internalDrain` (`+20` at midday on temperate/ocean, `+27.35` at midday on desert, `−1` at night)
 */
export function evaluateSolarArrayOutput(
  daylight: number,
  planetType: PlanetType,
  data?: CompiledDataLike,
): SolarOutputBreakdown {
  const solarRow = resolvePowerRow(data, 'economyT1Basic', 'solar');
  const baseGross = Number(solarRow.grossOutputPerS ?? 21);
  const internalDrain = Number(solarRow.internalDrainPerS ?? 1);
  const desertMultiplier = planetType === 'desert' ? Number(solarRow.desertBonusMult ?? 1.35) : 1.0;
  const clampedDaylight = Math.max(0, Math.min(1, daylight));
  const gross = Number((baseGross * clampedDaylight * desertMultiplier).toFixed(4));
  const net = Number((gross - internalDrain).toFixed(4));
  return {
    gross,
    internalDrain,
    net,
    daylight: clampedDaylight,
    desertMultiplier,
  };
}

/**
 * Evaluates total Solar T1 output across all online Solar arrays owned by `colonyIndex` on `state`.
 */
export function evaluateColonySolar(
  state: PlanetState,
  colonyIndex = 0,
  data?: CompiledDataLike,
): { count: number; grossPerS: number; internalDrainPerS: number; netPerS: number; perArray: SolarOutputBreakdown } {
  const env = getEnvironment(state, data);
  const perArray = evaluateSolarArrayOutput(env.daylight, state.meta.planetType, data);
  const e = state.entities, cols = e.cols;
  let count = 0;

  for (let row = 0; row < e.count; row++) {
    if (cols.owner[row] !== colonyIndex || cols.hp[row] <= 0) continue;
    if (cols.kind[row] !== ENTITY_KIND.solar) continue;
    const st = cols.state[row];
    if (st === ENTITY_STATE.constructing || st === ENTITY_STATE.offlineUnpowered) continue;
    count++;
  }

  return {
    count,
    grossPerS: Number((perArray.gross * count).toFixed(4)),
    internalDrainPerS: Number((perArray.internalDrain * count).toFixed(4)),
    netPerS: Number((perArray.net * count).toFixed(4)),
    perArray,
  };
}
