import { FIXTURE_LABEL, type CargoLine, type InventoryCache } from './guild-plan.js';

/** One NPC row. The cache is this object's cargo, not a per-planet bag. */
export interface NpcCargo {
  readonly inventory: InventoryCache;
}

/**
 * A fill against the guild. `side` is the NPC's side: `sell` is a player buy and decreases stock,
 * `buy` increases it. `planetId` is where the fill happened; it is not a cache key.
 */
export interface GuildCargoFill {
  readonly resource: string;
  readonly side: 'buy' | 'sell';
  readonly amount: number;
  readonly planetId: string;
}

export type CargoFillResult =
  | { readonly ok: true; readonly planetId: string; readonly inventory: InventoryCache; readonly stock: number }
  | { readonly ok: false; readonly reason: 'over_stock' | 'bad_fill'; readonly planetId: string; readonly inventory: InventoryCache };

/** Whole units of one resource on the carried cache. Non-positive or fractional lines are ignored. */
export function stockOf(cache: InventoryCache, resource: string): number {
  let n = 0;
  for (const line of cache.lines) {
    if (line.resource !== resource || !Number.isSafeInteger(line.amount) || line.amount <= 0) continue;
    n += line.amount;
  }
  return n;
}

/**
 * Apply one guild fill to the carried cache. A sell larger than the stock is refused and the cache
 * is left as it was, so stock never goes negative. The planet id is echoed and is not stored.
 */
export function applyFill(npc: NpcCargo, fill: GuildCargoFill): CargoFillResult {
  if (!Number.isSafeInteger(fill.amount) || fill.amount <= 0) return refused('bad_fill', fill, npc.inventory);
  const stock = stockOf(npc.inventory, fill.resource);
  if (fill.side === 'sell' && fill.amount > stock) return refused('over_stock', fill, npc.inventory);
  const next = fill.side === 'sell' ? stock - fill.amount : stock + fill.amount;
  return { ok: true, planetId: fill.planetId, inventory: writeStock(npc.inventory, fill.resource, next), stock: next };
}

function refused(reason: 'over_stock' | 'bad_fill', fill: GuildCargoFill, inventory: InventoryCache): CargoFillResult {
  return { ok: false, reason, planetId: fill.planetId, inventory };
}

/** One fixture line for `resource` at `amount`. Other resources stay. Zero drops the resource. */
function writeStock(cache: InventoryCache, resource: string, amount: number): InventoryCache {
  const lines = cache.lines.filter((line) => line.resource !== resource);
  if (amount > 0) lines.push(lineOf(resource, amount));
  return { label: FIXTURE_LABEL, organic: false, lines };
}

function lineOf(resource: string, amount: number): CargoLine {
  return { resource, amount, label: FIXTURE_LABEL, organic: false, source: 'mock-grant' };
}
