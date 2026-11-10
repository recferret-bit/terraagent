import type { SimCommandV1 } from '@terra/contracts';
import { TICKS_PER_SECOND } from '@terra/sim';

/** One design hour, the same window `defend.ts` uses (tick is 200 ms). */
const TICKS_PER_HOUR = TICKS_PER_SECOND * 60 * 60;

export interface SpawnOrderInput {
  readonly colonyIndex: number;
  readonly bountyId: string;
  readonly rosterId: string;
  readonly count: number;
  readonly q: number;
  readonly r: number;
  readonly radius: number;
  readonly hours: number;
  /** Planet tick when the squad should appear. `0` when the planet is not loaded. */
  readonly startTick?: number;
}

/** `endTick` is strictly after `startTick`, so a loaded planet at tick 0 still accepts the spawn. */
export function contractEndTick(startTick: number, hours: number): number {
  return startTick + Math.max(1, Math.round(hours * TICKS_PER_HOUR));
}

/** Module command `mercenary.spawn`. `source` is `system` so the handler accepts it. */
export function spawnOrder(input: SpawnOrderInput): SimCommandV1 {
  const startTick = input.startTick ?? 0;
  return {
    colonyIndex: input.colonyIndex,
    source: 'system',
    commandId: spawnCommandId(input.bountyId),
    kind: 'mercenary.spawn',
    args: {
      q: input.q,
      r: input.r,
      radius: input.radius,
      endTick: contractEndTick(startTick, input.hours),
      count: input.count,
      bountyId: input.bountyId,
      rosterId: input.rosterId,
    },
  };
}

function spawnCommandId(bountyId: string): string {
  const raw = `merc-${bountyId}`.replace(/[^A-Za-z0-9_-]/g, '');
  return (raw.length > 0 ? raw : 'merc-spawn').slice(0, 40);
}
