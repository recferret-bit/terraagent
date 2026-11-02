import { parseWaves } from '@terra/contracts';
import { createPlanet, SimHost, type CompiledDataLike, type SimCommand } from '../../src';

/**
 * The one W01 test host (XC-12): a `SimHost` with the `..01` wave flags on a generated planet (flat by default). Specs
 * import this instead of writing their own factory.
 */
export function w01Host(opts: { seed?: string; radius?: number; type?: 'flat' | 'temperate'; data?: CompiledDataLike } = {}): SimHost {
  const host = new SimHost({ flags: parseWaves('..01'), ...(opts.data ? { data: opts.data } : {}) });
  host.load(createPlanet({ type: opts.type ?? 'flat', seed: opts.seed ?? 'w01-test', radius: opts.radius ?? 12 }));
  return host;
}

let seq = 0;

/** A player command of colony `colonyIndex` (default 0) with a fresh command id. */
export function playerCmd(kind: string, args: unknown, colonyIndex: number | null = 0, prefix = 'cmd'): SimCommand {
  return { colonyIndex, source: 'player', commandId: `${prefix}_${++seq}`, kind, args };
}
