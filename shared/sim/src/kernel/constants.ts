/** One tick of game time (SIM-D-03). Every rate in the data tables is per second; `compileData` converts. */
export const TICK_MS = 200;
export const TICKS_PER_SECOND = 1000 / TICK_MS;
/** Coarse stepping of empty planets: one step per second advancing `COARSE_DT` ticks (D-24). */
export const COARSE_DT = 5;
/** Engine version stored in snapshots and sent in `welcome` (SIM-D-07, SIM-X-08). Bump on any state layout change. */
export const SIM_VERSION = 1;
/** Number of pipeline slots (SIMULATION §3): 0 commands … 14 finalize. */
export const PIPELINE_SLOTS = 15;
