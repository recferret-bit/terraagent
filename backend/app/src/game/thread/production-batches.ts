import { RESOURCE_KEYS, type ResourceKey } from '@terra/contracts';
import { TICKS_PER_SECOND, type ColonyState, type PlanetState, type SimEvent } from '@terra/sim';

/** Length of one Stockpile batch window (W02-28): 60 s of planet time, in ticks. */
export const PRODUCTION_WINDOW_TICKS = 60 * TICKS_PER_SECOND;

/** Production under this is float noise from fractional yields, not a batch. */
const EPSILON = 1e-9;

type Counters = Partial<Record<ResourceKey, number>>;

/** The colony's `production.produced` counters (the sim ledger's lifetime "produced" column); empty when absent. */
function producedOf(colony: ColonyState): Counters {
  const prod = colony.production as { produced?: Counters } | undefined;
  return prod?.produced ?? {};
}

const windowEndAfter = (tick: number) => (Math.floor(tick / PRODUCTION_WINDOW_TICKS) + 1) * PRODUCTION_WINDOW_TICKS;

/**
 * Stockpile progression batches of one planet (W02-28): every {@link PRODUCTION_WINDOW_TICKS} (windows end on tick
 * multiples of it), one whole-unit `resourceProduced {colonyId, res, amount}` event per colony and resource whose
 * `production.produced` counter grew in the window. Runs in the sim thread (the counters live in `PlanetState`, which
 * the main thread never sees, SIM-H-01); the events leave the thread with the step's own events and reach the bus
 * through the bus bridge. Checkpoint requests also close the open window. Batches sum to whole lifetime units; fractional carry remains in the saved counters.
 */
export class ProductionBatches {
  /** Counter values at the start of the open window, per colony id. */
  private readonly baseline = new Map<string, Counters>();
  private windowEnd: number;

  /** Starts observing at the planet's current tick: what was produced before the load is not reported again. */
  constructor(state: PlanetState) {
    for (const c of state.colonies ?? []) if (c) this.baseline.set(c.id, { ...producedOf(c) });
    this.windowEnd = windowEndAfter(state.meta.tick);
  }

  /** Call after every step: the `resourceProduced` events of the window that just closed (none mid-window). */
  collect(state: PlanetState, checkpoint = false): SimEvent[] {
    const tick = state.meta.tick;
    if (!checkpoint && tick < this.windowEnd) return [];
    this.windowEnd = windowEndAfter(tick);
    const out: SimEvent[] = [];
    for (const colony of state.colonies ?? []) {
      if (!colony) continue;
      const now = producedOf(colony);
      // A colony founded after the load produced everything under observation: its baseline is zero.
      const before = this.baseline.get(colony.id) ?? {};
      for (const res of RESOURCE_KEYS) {
        // Whole lifetime units preserve fractional carry across windows and checkpoint/restart.
        const amount = Math.floor((now[res] ?? 0) + EPSILON) - Math.floor((before[res] ?? 0) + EPSILON);
        if (amount > EPSILON) {
          out.push({ kind: 'resourceProduced', severity: 'info', atTick: tick, colonyIds: [colony.id], data: { colonyId: colony.id, res, amount } });
        }
      }
      this.baseline.set(colony.id, { ...now });
    }
    return out;
  }
}
