import { formatAtomic, isResourceToken, mockLabel, type MarketSnapshotResponse, type MarketTokenKey, type MyOrderView, type PriceBoardRow, type ResourceKey } from '@terra/contracts';

/** Slider step in basis points (0.05 %). */
export const FEE_STEP_BP = 5;
/** Estimates are valued in this quote only (the cash quote of the demo). */
export const VALUATION_QUOTE: MarketTokenKey = 'USDC';

/** `25` -> `0.25 %`. */
export const bpText = (bp: number): string => `${(bp / 100).toFixed(2)} %`;

/** `0.10 mock USDC` (the amount in display units with the mock label). */
export const amountText = (token: MarketTokenKey, atomic: string): string => `${formatAtomic(token, atomic)} ${mockLabel(token)}`;

/** Clamps a slider value to the policy range and the step. */
export const clampBp = (bp: number, max: number): number => Math.min(max, Math.max(0, Math.round(bp / FEE_STEP_BP) * FEE_STEP_BP));

export interface EarnedRow { readonly token: MarketTokenKey; readonly text: string }

/** Realized stall earnings per token (only tokens with a non-zero amount), from `stall.earned`. Never an estimate. */
export function earnedRows(snap: MarketSnapshotResponse | null): EarnedRow[] {
  const earned = snap?.stall?.earned ?? {};
  return (Object.entries(earned) as Array<[MarketTokenKey, string]>)
    .filter(([, a]) => BigInt(a) > 0n)
    .map(([token, a]) => ({ token, text: amountText(token, a) }));
}

export interface InventoryRow { readonly resource: ResourceKey; readonly free: bigint; readonly reserved: bigint }

/** In-orbit resources of the caller's colony (free and reserved by open orders), not cash tokens. */
export function inventoryRows(snap: MarketSnapshotResponse | null): InventoryRow[] {
  const free = snap?.balances ?? {};
  const reserved = snap?.reserved ?? {};
  const keys = new Set([...Object.keys(free), ...Object.keys(reserved)] as MarketTokenKey[]);
  return [...keys].filter(isResourceToken)
    .map((resource) => ({ resource, free: BigInt(free[resource] ?? '0'), reserved: BigInt(reserved[resource] ?? '0') }))
    .filter((r) => r.free + r.reserved > 0n)
    .sort((a, b) => a.resource.localeCompare(b.resource));
}

export interface ValuationRow {
  readonly resource: ResourceKey;
  /** `null` = no usable price (`insufficient_data` or no last trade): shown as a dash. */
  readonly value: string | null;
  readonly source: string;
}

const rowOf = (board: readonly PriceBoardRow[], resource: ResourceKey): PriceBoardRow | undefined =>
  board.find((r) => r.pair === `${resource}/${VALUATION_QUOTE}`);

const ageText = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${s} s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
};

/** Estimated value = last price x (free + reserved) amount; labelled with its source and age. Display only, never realized. */
export function valuationRows(snap: MarketSnapshotResponse | null, nowMs: number): ValuationRow[] {
  if (!snap) return [];
  return inventoryRows(snap).map(({ resource, free, reserved }) => {
    const row = rowOf(snap.board, resource);
    const source = `last ${mockLabel(VALUATION_QUOTE)} trade`;
    if (!row || row.classification === 'insufficient_data' || !row.last) return { resource, value: null, source: `${source}: insufficient data` };
    const at = snap.recentTrades.filter((t) => t.pair === row.pair).reduce((m, t) => Math.max(m, t.atMs), 0);
    const value = ((free + reserved) * BigInt(row.last.num)) / BigInt(row.last.den);
    return { resource, value: amountText(VALUATION_QUOTE, value.toString()), source: at > 0 ? `${source}, ${ageText(nowMs - at)}` : source };
  });
}

/** Distinct stall fees pinned on the caller's open orders (display; set by the server at placement, never by the slider). */
export function pinnedFees(orders: readonly MyOrderView[] | undefined): Array<{ bp: number; orders: number }> {
  const open = (orders ?? []).filter((o) => ['PENDING', 'OPEN', 'PARTIAL'].includes(o.state));
  const by = new Map<number, number>();
  for (const o of open) by.set(o.stallFeeBp, (by.get(o.stallFeeBp) ?? 0) + 1);
  return [...by].map(([bp, orders]) => ({ bp, orders })).sort((a, b) => a.bp - b.bp);
}
