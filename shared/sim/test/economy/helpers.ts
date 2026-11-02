import { RESOURCE_KEYS, type ResourceKey, type Stock } from '@terra/contracts';
import { Ledger, createLedgerState } from '@terra/ledger';
import { createState, isSystemAccount, type LedgerPosting, type PlanetState, type TreasuryCtx } from '../../src';
import { ensureColonyRecord } from '../../src/kernel/colonies';

/** A zero-filled stock with `partial` on top: what `getColonyStock` returns. */
export function fullStock(partial: Partial<Record<ResourceKey, number>> = {}): Stock {
  const out = {} as Stock;
  for (const key of RESOURCE_KEYS) out[key] = partial[key] ?? 0;
  return out;
}

/** The non-zero entries of a stock: how a ledger account's balances look (zero cells are deleted). */
export function nonZero(stock: Partial<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(stock)) if (v) out[k] = v;
  return out;
}

/** A tiny empty planet for economy unit tests. */
export function emptyPlanet(): PlanetState {
  return createState({ planetId: 'pl_econ', planetType: 'temperate', seed: 'econ', radius: 2 });
}

/** {@link emptyPlanet} with colony records 0..n-1 (the treasury only moves resources of an existing colony, GP-24). */
export function colonyPlanet(n = 1): PlanetState {
  const state = emptyPlanet();
  for (let i = 0; i < n; i++) ensureColonyRecord(state, i, 0);
  return state;
}

/** A treasury ctx that collects every posting (what a step's ctx does). */
export function collector(tick = 0): TreasuryCtx & { postings: LedgerPosting[] } {
  const postings: LedgerPosting[] = [];
  return { tick, postings, record: (p) => void postings.push(p) };
}

/** The host-side ledger: unlimited journal, only `sys:*` accounts may go negative. */
export function hostLedger(): Ledger {
  return new Ledger(createLedgerState({ journalLimit: 0 }), isSystemAccount);
}

/** Posts every posting into `ledger`, failing on the first rejected one. */
export function postAll(ledger: Ledger, postings: readonly LedgerPosting[]): void {
  for (const p of postings) {
    const res = ledger.post(p);
    if (!res.ok) throw new Error(`ledger rejected ${p.reason} at ${p.at}: ${res.code} ${JSON.stringify(res)}`);
  }
}
