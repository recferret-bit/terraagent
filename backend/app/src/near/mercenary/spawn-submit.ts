import type { SimCommandV1 } from '@terra/contracts';
import { spawnOrder, type SpawnOrderInput } from './spawn-order.js';

/** The bit of `GamePlanets` a hire needs. Absent in tests that do not boot a planet thread. */
export interface MercenaryPlanetHost {
  isLoaded(planetId: string): boolean;
  fullState(planetId: string): Promise<{ tick: number }>;
  submit(planetId: string, cmd: SimCommandV1): Promise<{ ok: boolean; code?: string }>;
}

/**
 * Builds `mercenary.spawn` and, when the planet is loaded, submits it on the host.
 * A reject is logged by the caller. The escrow is already open, so a miss does not unwind the hire.
 */
export async function submitSpawn(
  planets: MercenaryPlanetHost | undefined,
  planetId: string,
  input: SpawnOrderInput,
  warn: (message: string) => void,
): Promise<SimCommandV1> {
  const cmd = spawnOrder({ ...input, startTick: await liveTick(planets, planetId) });
  if (!planets?.isLoaded(planetId)) return cmd;
  try {
    const out = await planets.submit(planetId, cmd);
    if (!out.ok) warn(`mercenary.spawn rejected: ${out.code ?? 'reject'}`);
  } catch (err) {
    warn(`mercenary.spawn was not submitted: ${err instanceof Error ? err.message : String(err)}`);
  }
  return cmd;
}

async function liveTick(planets: MercenaryPlanetHost | undefined, planetId: string): Promise<number> {
  if (!planets?.isLoaded(planetId)) return 0;
  try {
    const full = await planets.fullState(planetId);
    return Number.isInteger(full.tick) && full.tick >= 0 ? full.tick : 0;
  } catch {
    return 0;
  }
}
