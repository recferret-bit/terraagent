import type { StepContext } from './context';
import type { PlanetState } from './state';

/** The step a colony-ledger helper (`systems/economy/ledger.ts`) is running inside: its state and ctx. */
export interface LedgerSink {
  readonly state: PlanetState;
  readonly ctx: StepContext;
}

let active: LedgerSink | null = null;

/**
 * Runs `fn` with `ctx` as the sink of the colony-ledger helpers (`creditResource`, `debitCost`, `refundCost`,
 * `payProgressiveSlice`, `consumeResource`): inside it their whole-unit stock changes go through `ColonyTreasury` and
 * reach the host's journal, without every system threading its ctx into them (LED-16). `step` wraps commands and
 * systems in it. The step is synchronous and a host never steps two planets at once, so the slot is scoped to the call
 * (restored on exit, also on a throw). Outside a step (tests, scenario seeding) the helpers still change `col.stock`,
 * only nothing is recorded.
 */
export function withLedgerSink<T>(state: PlanetState, ctx: StepContext, fn: () => T): T {
  const prev = active;
  active = { state, ctx };
  try {
    return fn();
  } finally {
    active = prev;
  }
}

/** The step the caller runs in, or `null` outside a step. */
export function activeLedgerSink(): LedgerSink | null {
  return active;
}
