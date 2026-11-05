import { formatAtomic, formatUnitPrice, type MarketSnapshotResponse, type ResourceKey } from '@terra/contracts';
import { compareRemedies, ratio, ratioToDecimal, TICK_MS, type BuyLine, type Remedy, type SellLine, type SupplyTradeView } from '@terra/sim';
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

/** Best ask of `resource/USDC` with the buyer's fees (the policy platform fee plus the default stall fee), from a market snapshot. */
export function bestAsk(s: MarketSnapshotResponse | null, resource: ResourceKey): { num: bigint; den: bigint; quote: 'USDC'; platformFeeBp: number; stallFeeBp: number } | null {
  const lvl = s?.books.find((b) => b.pair === `${resource}/USDC`)?.asks[0];
  if (!s || !lvl || !s.policy) return null;
  return { num: BigInt(lvl.num), den: BigInt(lvl.den), quote: 'USDC', platformFeeBp: s.policy.platformFeeBp, stallFeeBp: s.policy.stallFeeDefaultBp };
}

export interface RemedyRow { kind: Remedy['kind']; title: string; detail: string }

const NOTES: Readonly<Record<string, string>> = {
  no_ask: 'nobody sells it right now', not_producible_here: 'no local source for it', no_depot_row: 'no depot available', nothing_to_reserve: 'no reserve-able load',
};

/** Buy / produce / depot / reserve for one missing quantity, as text rows with their costs. */
export function remedyRows(sv: SupplyTradeView, line: BuyLine, snap: MarketSnapshotResponse | null): RemedyRow[] {
  const p = sv.remedy.produce[line.resource];
  const g = sv.logistics;
  const rs = compareRemedies({
    resource: line.resource, qty: line.qty, ask: bestAsk(snap, line.resource),
    localMinutesPerUnit: p ? ratio(BigInt(p.num), BigInt(p.den)) : null, depot: sv.remedy.depot,
    ...(g && g.u !== null && g.K > 0 ? { logistics: { L: ratio(BigInt(Math.round(asNumber(g.L) * 1000)), 1000n), K: g.K } } : {}),
  });
  const title: Record<Remedy['kind'], string> = { buy: 'Buy', produce: 'Produce locally', depot: 'Build a Supply Depot', reserve: 'Put units in reserve' };
  return rs.map((r): RemedyRow => {
    if (!r.available) return { kind: r.kind, title: title[r.kind], detail: `not available: ${NOTES[r.note ?? ''] ?? r.note ?? ''}` };
    if (r.kind === 'buy' && r.quoteCost) {
      const q = r.quoteCost;
      const top = snap!.books.find((b) => b.pair === `${line.resource}/USDC`)!.asks[0]!;
      return { kind: r.kind, title: title.buy, detail: `${line.qty} at best ask ${formatUnitPrice(top.num, top.den, q.token)}: ${formatAtomic(q.token, q.notional)} + ${formatAtomic(q.token, q.fees)} fees = ${formatAtomic(q.token, q.total)} mock ${q.token}` };
    }
    if (r.kind === 'produce') return { kind: r.kind, title: title.produce, detail: `about ${ratioToDecimal(r.minutes!, 1)} min with one extractor` };
    if (r.kind === 'depot') {
      const cost = Object.entries(r.resourceCost ?? {}).filter(([, v]) => v).map(([k, v]) => `${v} ${resourceLabel(k as ResourceKey)}`).join(', ');
      return { kind: r.kind, title: title.depot, detail: `${cost}; ${ratioToDecimal(r.minutes!, 1)} min${r.utilizationAfter ? `; load ${ratioToDecimal(r.utilizationAfter, 2)} of capacity after` : ''}` };
    }
    return { kind: r.kind, title: title.reserve, detail: `stops their upkeep${r.utilizationAfter ? `; load ${ratioToDecimal(r.utilizationAfter, 2)} of capacity after` : ''}` };
  });
}
