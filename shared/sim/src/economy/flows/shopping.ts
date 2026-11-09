import type { ResourceKey } from '@terra/contracts';

/**
 * Shopping basket and sellable surplus (ECONOMY §2.1, W13-55). Pure and exact (whole units): every resource's holdings are
 * handed to the demands in priority order (queue jobs in queue order, then the next logistics window, then the safety
 * reserve); what a demand lacks is a BUY line carrying that demand's reason, and what is left after all of them is the
 * SELL surplus. A resource is never both. A suggestion never moves stock or money: the player confirms it (§2.1).
 */
export type DemandReason = 'job' | 'logistics' | 'reserve';

export interface BasketDemand {
  readonly reason: DemandReason;
  readonly resource: ResourceKey;
  /** Whole units wanted. */
  readonly qty: number;
  /** Queue job (task id) that needs it; present for `reason: 'job'`. */
  readonly jobId?: string;
  /** Readable name of the job (`Survey Array`). */
  readonly label?: string;
}

export interface BasketInput {
  /** Whole units on hand per resource: colony stock plus units in orbit, before open-order reservations. */
  readonly holdings: Readonly<Partial<Record<ResourceKey, number>>>;
  /** Units locked by the colony's open sell orders (not available to anything else). */
  readonly reservedByOrders: Readonly<Partial<Record<ResourceKey, number>>>;
  /** Demands in priority order. */
  readonly demands: readonly BasketDemand[];
  /** Safety stock to keep per resource (units); becomes a lowest-priority `reserve` demand. */
  readonly safety: Readonly<Partial<Record<ResourceKey, number>>>;
}

export interface BuyLine {
  readonly resource: ResourceKey;
  readonly qty: number;
  readonly reason: DemandReason;
  readonly jobId?: string;
  readonly label?: string;
}
export interface SellLine { readonly resource: ResourceKey; readonly qty: number; readonly reason: 'surplus' }
export interface ShoppingBasket { readonly buy: BuyLine[]; readonly sell: SellLine[] }

const whole = (n: number | undefined): number => (n !== undefined && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

export function shoppingBasket(input: BasketInput): ShoppingBasket {
  const left = new Map<ResourceKey, number>();
  const keys = new Set<ResourceKey>([...(Object.keys(input.holdings) as ResourceKey[]), ...input.demands.map((d) => d.resource), ...(Object.keys(input.safety) as ResourceKey[])]);
  for (const k of keys) left.set(k, Math.max(0, whole(input.holdings[k]) - whole(input.reservedByOrders[k])));
  const demands: BasketDemand[] = [...input.demands];
  for (const [k, qty] of Object.entries(input.safety) as [ResourceKey, number][]) if (whole(qty) > 0) demands.push({ reason: 'reserve', resource: k, qty: whole(qty) });
  const buy: BuyLine[] = [];
  for (const d of demands) {
    const want = whole(d.qty);
    if (want === 0) continue;
    const have = left.get(d.resource) ?? 0;
    const take = Math.min(have, want);
    left.set(d.resource, have - take);
    if (want > take) buy.push({ resource: d.resource, qty: want - take, reason: d.reason, ...(d.jobId ? { jobId: d.jobId } : {}), ...(d.label ? { label: d.label } : {}) });
  }
  const sell: SellLine[] = [...left].filter(([, q]) => q > 0).map(([resource, qty]) => ({ resource, qty, reason: 'surplus' as const })).sort((a, b) => (a.resource < b.resource ? -1 : 1));
  return { buy, sell };
}
