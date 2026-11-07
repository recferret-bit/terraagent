import { formatAtomic, formatUnitPrice, type MarketSnapshotResponse, type ResourceKey } from '@terra/contracts';
import { compareRemedies, ratio, ratioToDecimal, TICK_MS, type BuyLine, type DepthLevel, type Ratio, type Remedy, type RemedyInput, type SellLine, type SupplyTradeView } from '@terra/sim';
import { resourceLabel } from '../tab/pairs';

const UNREASONS: Readonly<Record<string, string>> = {
  no_supply_node: 'no Command Hub or Supply Depot to supply it',
  no_capacity: 'no powered supply capacity',
  unreachable: 'no route to a supply node',
  out_of_reach: 'out of reach of every supply node',
};

/** One sentence per buy line: names the goal and the missing quantity (ECONOMY 2.1). */
export function buyText(l: BuyLine): string {
  const what = `${l.qty} ${resourceLabel(l.resource)}`;
  if (l.reason === 'job') return `Needed by ${l.label ?? 'a queued'} job: ${what}`;
  if (l.reason === 'logistics') return `Next supply window needs ${what}`;
  return `Keep ${what} as safety reserve`;
}

export const sellText = (l: SellLine): string => `Surplus ${l.qty} ${resourceLabel(l.resource)} above jobs, orders and reserve`;

export interface LogisticsLines { load: string; congestion: string; distance: string; reserve: string; bottleneck: string; bill: string[]; remedies: string[] }

/** The sim sends exact ratios as `"num/den"` (a plain decimal is accepted too); `asNumber` is for comparisons, `asText` for display. */
const asNumber = (v: string): number => {
  const [n, d] = v.split('/');
  return d === undefined ? Number(n) : Number(n) / Number(d);
};
const asText = (v: string, digits = 2): string => {
  const [n, d] = v.split('/');
  return d === undefined || !/^-?\d+$/.test(n!) || !/^\d+$/.test(d) || BigInt(d) === 0n ? v : ratioToDecimal(ratio(BigInt(n!), BigInt(d)), digits);
};

const secs = (windows: number, windowTicks: number): number => Math.round((windows * windowTicks * TICK_MS) / 1000);

/** The next-window bill, reserve duration, congestion and distance, bottleneck and remediation (ECONOMY 2.3 last paragraph). */
export function logisticsLines(sv: SupplyTradeView): LogisticsLines | null {
  const g = sv.logistics;
  if (!g) return null;
  const over = g.M !== null && asNumber(g.M) > 1;
  const remedies: string[] = [];
  if (over) remedies.push(`Over capacity (load ${asText(g.L)} on ${g.K}): build a Supply Depot${sv.remedy.depot ? ` (+${sv.remedy.depot.throughputAdd} per window)` : ''}, put units in reserve, or buy from a closer source.`);
  for (const r of g.unavailable) remedies.push(`Unsupplied: ${UNREASONS[r] ?? r}. Build a Supply Depot near it or shorten the route.`);
  if (g.status.partial + g.status.grace > 0) remedies.push(`${g.status.grace} in grace, ${g.status.partial} partly supplied: buy the missing basket below.`);
  return {
    load: `Load ${asText(g.L)} / capacity ${g.K}${g.u !== null ? ` (${Math.round(asNumber(g.u) * 100)}%)` : ''}`,
    congestion: g.M !== null ? `Congestion x${asText(g.M)}` : 'Congestion n/a (no capacity)',
    distance: g.maxRouteTiles !== null ? `Farthest route ${g.maxRouteTiles} tiles` : 'No routes',
    reserve: g.reserveWindows === null ? 'Reserve: nothing billed' : `Reserve lasts ${g.reserveWindows} windows (${secs(g.reserveWindows, g.windowTicks)} s)`,
    bottleneck: g.bottleneck ? `Bottleneck node #${g.bottleneck.nodeId} serves ${g.bottleneck.entities}` : 'No supply node',
    bill: g.bill.map((b) => `${b.units} ${resourceLabel(b.resource)}`),
    remedies,
  };
}

/**
 * The visible ask book of `resource/USDC` (best first) with the buyer's fees (the policy platform fee plus the default stall
 * fee), from a market snapshot. `num/den` is the best ask; `levels` carries every shown level so the buy cost walks the depth.
 */
export function askBook(s: MarketSnapshotResponse | null, resource: ResourceKey): NonNullable<RemedyInput['ask']> | null {
  const asks = s?.books.find((b) => b.pair === `${resource}/USDC`)?.asks ?? [];
  const top = asks[0];
  if (!s || !top || !s.policy) return null;
  const levels: DepthLevel[] = asks.map((l) => ({ num: BigInt(l.num), den: BigInt(l.den), amount: BigInt(l.amount) }));
  return { num: BigInt(top.num), den: BigInt(top.den), quote: 'USDC', platformFeeBp: s.policy.platformFeeBp, stallFeeBp: s.policy.stallFeeDefaultBp, levels };
}

/** Exact rational of a ratio string from the sim (`"num/den"`, an integer or a plain decimal); null when it is none of those. */
export function parseExactRatio(v: string): Ratio | null {
  const m = /^(-?)(\d+)(?:\/(\d+)|\.(\d+))?$/.exec(v.trim());
  if (!m) return null;
  const sign = m[1] ? -1n : 1n;
  if (m[3] !== undefined) return BigInt(m[3]) === 0n ? null : ratio(sign * BigInt(m[2]!), BigInt(m[3]));
  if (m[4] !== undefined) return ratio(sign * BigInt(m[2]! + m[4]), 10n ** BigInt(m[4].length));
  return ratio(sign * BigInt(m[2]!));
}

export interface RemedyRow { kind: Remedy['kind']; title: string; detail: string }

const NOTES: Readonly<Record<string, string>> = {
  no_ask: 'nobody sells it right now', insufficient_depth: 'no units are for sale in the shown levels', not_producible_here: 'no local source for it', no_depot_row: 'no depot available', nothing_to_reserve: 'no reserve-able load',
};

function buyDetail(want: number, r: Remedy, snap: MarketSnapshotResponse | null, resource: ResourceKey): string {
  const q = r.quoteCost!, d = r.depth!;
  const top = snap!.books.find((b) => b.pair === `${resource}/USDC`)!.asks[0]!;
  const cost = `${formatAtomic(q.token, q.notional)} + ${formatAtomic(q.token, q.fees)} fees = ${formatAtomic(q.token, q.total)} mock ${q.token}`;
  const price = formatUnitPrice(top.num, top.den, q.token);
  if (d.state === 'full') return `${want} at best ask ${price} (${d.fillable} for sale in the shown levels, enough): ${cost}`;
  return `Only ${d.fillable} of ${want} are for sale in the shown levels (best ask ${price}): ${d.fillable} cost ${cost}; ${d.missing} more are not on offer`;
}

/** Buy / produce / depot / reserve for one missing quantity, as text rows with their costs. */
export function remedyRows(sv: SupplyTradeView, line: BuyLine, snap: MarketSnapshotResponse | null): RemedyRow[] {
  const p = sv.remedy.produce[line.resource];
  const g = sv.logistics;
  const load = g && g.u !== null && g.K > 0 ? parseExactRatio(g.L) : null;
  const rs = compareRemedies({
    resource: line.resource, qty: line.qty, ask: askBook(snap, line.resource),
    localMinutesPerUnit: p ? ratio(BigInt(p.num), BigInt(p.den)) : null, depot: sv.remedy.depot,
    ...(g && load ? { logistics: { L: load, K: g.K } } : {}),
  });
  const title: Record<Remedy['kind'], string> = { buy: 'Buy', produce: 'Produce locally', depot: 'Build a Supply Depot', reserve: 'Put units in reserve' };
  return rs.map((r): RemedyRow => {
    if (!r.available) return { kind: r.kind, title: title[r.kind], detail: `not available: ${NOTES[r.note ?? ''] ?? r.note ?? ''}` };
    if (r.kind === 'buy' && r.quoteCost && r.depth) return { kind: r.kind, title: title.buy, detail: buyDetail(line.qty, r, snap, line.resource) };
    if (r.kind === 'produce') return { kind: r.kind, title: title.produce, detail: `about ${ratioToDecimal(r.minutes!, 1)} min with one extractor` };
    if (r.kind === 'depot') {
      const cost = Object.entries(r.resourceCost ?? {}).filter(([, v]) => v).map(([k, v]) => `${v} ${resourceLabel(k as ResourceKey)}`).join(', ');
      return { kind: r.kind, title: title.depot, detail: `${cost}; ${ratioToDecimal(r.minutes!, 1)} min${r.utilizationAfter ? `; load ${ratioToDecimal(r.utilizationAfter, 2)} of capacity after` : ''}` };
    }
    return { kind: r.kind, title: title.reserve, detail: `stops their upkeep${r.utilizationAfter ? `; load ${ratioToDecimal(r.utilizationAfter, 2)} of capacity after` : ''}` };
  });
}
