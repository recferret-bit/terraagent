/** One tick of game time (SIM-D-03). Every rate in the data tables is per second; `compileData` converts. */
export const TICK_MS = 200;
export const TICKS_PER_SECOND = 1000 / TICK_MS;
/** Coarse stepping of empty planets: one step per second advancing `COARSE_DT` ticks (D-24). */
export const COARSE_DT = 5;
/**
 * Engine version stored in snapshots and sent in `welcome` (SIM-D-07, SIM-X-08). Bump on any state layout change.
 * Version 1 (pre-W01) has no migration on purpose: no non-dev planet was ever saved at v1, so pre-W01 saves are
 * discarded (dev planets regenerate, a browser local save is dropped, any other v1 snapshot fails to restore).
 * From the first real (non-dev) planet on, every bump registers a migration in `codec/migrations` (WE-01).
 */
export const SIM_VERSION = 2; // 2: colony stock is `col.stock` in whole units, the ledger journal is host-side (no `ledger`/`colonyStock` blobs)
/** Number of pipeline slots (SIMULATION §3): 0 commands … 14 finalize. */
export const PIPELINE_SLOTS = 15;
