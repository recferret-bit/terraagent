import { RESOURCE_KEYS, type ResourceKey, type Stock } from '@terra/contracts';
import { ensureColonyRecord } from '../kernel/colonies';
import type { PlanetState } from '../kernel/state';

/** An all-zero stock over every resource key. */
export function emptyStock(): Stock {
  const out = {} as Stock;
  for (const key of RESOURCE_KEYS) out[key as ResourceKey] = 0;
  return out;
}

/**
 * A colony's stock of every resource key (zero-filled, whole units). `col.stock` is the balance the sim keeps and
 * syncs to clients; the journal of how it got there lives with the host (see `LedgerPosting`). The one stock reader.
 */
export function getColonyStock(state: PlanetState, colonyIndex: number): Stock {
  const raw = state.colonies[colonyIndex]?.stock as Partial<Stock> | undefined;
  const out = emptyStock();
  if (raw && typeof raw === 'object') for (const key of RESOURCE_KEYS) out[key] = raw[key] ?? 0;
  return out;
}

/**
 * Writes a colony's stock and its `resources` family summary, and stamps the colony record. Only the treasury calls
 * this, right after it validated the change and recorded the posting.
 */
export function writeColonyStock(state: PlanetState, colonyIndex: number, stock: Stock, tick: number): void {
  const col = ensureColonyRecord(state, colonyIndex, tick);
  col.stock = { ...stock };
  col.resources = {
    metals: stock['metals.t1'] + stock['metals.t2'] + stock['metals.t3'],
    minerals: stock['minerals.t1'] + stock['minerals.t2'] + stock['minerals.t3'],
    biomass: stock['bio.biomass'],
    water: stock['bio.water'],
  };
  col.changedAt = tick;
}
