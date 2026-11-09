import { parseWaves, RESOURCE_FAMILY_OF, RESOURCE_KEYS, type ResourceKey } from '@terra/contracts';
import { getRegionPin } from '../economy/regions/pin';
import { shoppingBasket, type BasketDemand, type ShoppingBasket } from '../economy/flows/shopping';
import type { ColonyState, PlanetState } from '../kernel/state';
import { getLogisticsView, readLogistics, type LogisticsView } from '../systems/logistics/state';
import { getColonyQueue } from '../systems/queue';
import { compileData, dataRow } from '../data';
import type { CompiledDataLike } from '../kernel/config';

export type AbundanceLevel = 'abundant' | 'scarce' | 'normal';

/** What the Supply & trade panel shows for one colony; plain JSON, built from synced state only (W13-55). */
export interface SupplyTradeView {
  badges: { resource: ResourceKey; level: AbundanceLevel; weightBp: number }[];
  mainResource: ResourceKey | null;
  basket: ShoppingBasket;
  logistics: LogisticsBillView | null;
  remedy: RemedyContext;
}

/** Numbers the remedy comparison needs besides the market quote (data rows, never client literals). */
export interface RemedyContext {
  /** Cheapest supply-depot row: build cost, minutes, and the throughput one more node adds per window. */
  depot: { cost: Partial<Record<ResourceKey, number>>; buildMinutes: number; throughputAdd: number } | null;
  /** Local production minutes per unit as an exact fraction of strings, for resources a T1 extractor row outputs. */
  produce: Partial<Record<ResourceKey, { num: string; den: string }>>;
}

export interface LogisticsBillView {
  windowKey: string | null;
  K: number;
  /** Exact decimals (`L`, `u`, congestion `M`); `u`/`M` are null when no capacity exists. */
  L: string;
  u: string | null;
  M: string | null;
  /** Next-window bill per resource, units as decimal text (already includes distance and congestion). */
  bill: { resource: ResourceKey; units: string }[];
  /** Whole windows the local reserves cover at the current bill (min over resources); null when nothing is billed. */
  reserveWindows: number | null;
  graceLeftTicks: number;
  maxRouteTiles: number | null;
  /** Node that serves the most entities (where congestion bites first) and how many. */
  bottleneck: { nodeId: string; entities: number } | null;
  status: { supplied: number; reserve: number; grace: number; partial: number; unavailable: number };
  unavailable: string[];
  windowTicks: number;
}

let w13Data: CompiledDataLike | null = null;
/** Default compiled rows with W13 on (cached): the view has no step context, so live `tune` overrides of these rows are not seen here. */
const marketRow = (id: string): ReturnType<typeof dataRow> => dataRow((w13Data ??= compileData(parseWaves('..13'))), 'market', id);

const prettify = (s: string): string => s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const MICRO = 1_000_000;
const micro = (n: number): string => { const w = Math.floor(n / MICRO), f = String(n % MICRO).padStart(6, '0').replace(/0+$/, ''); return f ? `${w}.${f}` : String(w); };

const demandCache = new WeakMap<object, Map<number, BasketDemand[]>>();

/** Unpaid cost of the colony's queued jobs, in queue order. Memoized per queue blob (the view runs every tick). */
export function jobDemands(state: PlanetState, colony: number): BasketDemand[] {
  const blob = state.blobs.queue?.value as object | undefined;
  const byColony = blob ? (demandCache.get(blob) ?? demandCache.set(blob, new Map()).get(blob)!) : null;
  const hit = byColony?.get(colony);
  if (hit) return hit.slice();
  const out = computeJobDemands(state, colony);
  byColony?.set(colony, out);
  return out.slice();
}

function computeJobDemands(state: PlanetState, colony: number): BasketDemand[] {
  const out: BasketDemand[] = [];
  for (const e of getColonyQueue(state, colony)) {
    if (e.state === 'in_progress' && e.paid) continue;
    // the job's whole unpaid cost: the basket subtracts holdings itself, so `missingResources` (already net of stock) would double count
    const need = e.paid ? {} : e.cost;
    const t = e.task as { building?: string; unit?: string; project?: string; op?: string; goal?: string; kind: string };
    const label = prettify(t.building ?? t.unit ?? t.project ?? t.op ?? t.goal ?? t.kind);
    for (const [resource, qty] of Object.entries(need) as [ResourceKey, number][]) if (qty > 0) out.push({ reason: 'job', resource, qty, jobId: e.taskId, label });
  }
  return out;
}

function logisticsBill(state: PlanetState, colony: number, lv: LogisticsView): LogisticsBillView | null {
  if (!lv.summary) return null;
  const need: Record<string, number> = {}, held: Record<string, number> = {};
  const st = { supplied: 0, reserve: 0, grace: 0, partial: 0, unavailable: 0 };
  const nodes = new Map<string, number>();
  const why = new Set<string>();
  let grace = Infinity, maxRoute: number | null = null;
  for (const e of Object.values(lv.entities)) {
    st[e.status] += 1;
    for (const [k, v] of Object.entries(e.need)) need[k] = (need[k] ?? 0) + v;
    for (const [k, v] of Object.entries(e.reserve)) held[k] = (held[k] ?? 0) + v;
    if (e.nodeId) nodes.set(e.nodeId, (nodes.get(e.nodeId) ?? 0) + 1);
    if (e.unavailable) why.add(e.unavailable);
    if (e.routeTiles !== null) maxRoute = Math.max(maxRoute ?? 0, e.routeTiles);
    if (e.status === 'grace') grace = Math.min(grace, e.graceLeftTicks);
  }
  let windows: number | null = null;
  for (const [k, n] of Object.entries(need)) if (n > 0) { const w = Math.floor((held[k] ?? 0) / n); windows = windows === null ? w : Math.min(windows, w); }
  const top = [...nodes].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  const window = readLogistics(state).colonies[String(colony)]?.window;
  return {
    windowKey: lv.windowKey, K: lv.summary.K, L: lv.summary.L, u: lv.summary.u, M: lv.summary.M,
    bill: Object.entries(need).filter(([, v]) => v > 0).map(([resource, v]) => ({ resource: resource as ResourceKey, units: micro(v) })),
    reserveWindows: windows, graceLeftTicks: Number.isFinite(grace) ? grace : 0, maxRouteTiles: maxRoute,
    bottleneck: top ? { nodeId: top[0], entities: top[1] } : null, status: st, unavailable: [...why].sort(),
    windowTicks: window ? window.endTick - window.startTick : 0,
  };
}

function badges(state: PlanetState): { badges: SupplyTradeView['badges']; main: ResourceKey | null } {
  const pin = getRegionPin(state);
  if (!pin) return { badges: [], main: null };
  const row = marketRow('supply');
  const hi = Number(row.abundantWeightBp), lo = Number(row.scarceWeightBp);
  const w = new Map(pin.resources.map((r) => [r.resource, r.fields.occurrenceWeightBp ?? 0]));
  const list = RESOURCE_KEYS.filter((k) => w.has(k)).map((resource) => {
    const weightBp = w.get(resource)!;
    return { resource, level: (weightBp >= hi ? 'abundant' : weightBp <= lo ? 'scarce' : 'normal') as AbundanceLevel, weightBp };
  });
  return { badges: list, main: pin.mainResource };
}

/** Minutes to make one unit with one extractor: `1 / (outputPerS * 60)`, from the building rows' design output (exact thousandths). */
let remedyCache: RemedyContext | null = null;
function remedyContext(): RemedyContext {
  if (remedyCache) return remedyCache;
  const data = (w13Data ??= compileData(parseWaves('..13')));
  const produce: RemedyContext['produce'] = {};
  for (const row of Object.values((data.tables['grid'] ?? {}) as Record<string, Record<string, unknown>>)) {
    const rate = Number(row.designOutputPerS), key = row.outputResource as ResourceKey | undefined;
    if (!key || !(rate > 0) || produce[key]) continue;
    const perMin = Math.round(rate * 60 * 1000); // thousandths of a unit per minute
    produce[key] = { num: '1000', den: String(perMin) };
  }
  const depot = (data.tables['grid'] as Record<string, Record<string, unknown>> | undefined)?.['supplyDepot'];
  const node = (data.tables['logistics'] as Record<string, Record<string, unknown>> | undefined)?.['node.supplyDepot.t1'];
  return (remedyCache = {
    produce,
    depot: depot && node ? { cost: { ...(depot.cost as Partial<Record<ResourceKey, number>>) }, buildMinutes: Math.ceil(Number(depot.buildS) / 60 * 100) / 100, throughputAdd: Number(node.throughputPerWindow) } : null,
  });
}

/** Safety stock (lowest band edge) only for resources the colony actually stocks: an unused T3 is not a nag. */
function safetyStock(colony: ColonyState, holdings: Partial<Record<ResourceKey, number>>): Partial<Record<ResourceKey, number>> {
  const caps = (colony.caps ?? {}) as Record<string, number>;
  const out: Partial<Record<ResourceKey, number>> = {};
  for (const k of RESOURCE_KEYS) {
    if (!(holdings[k]! > 0)) continue;
    const lo = Number(marketRow(`resource.${k}`).targetBandLoBp ?? 0);
    const q = Math.floor(((caps[RESOURCE_FAMILY_OF[k]] ?? 0) * lo) / 10_000);
    if (q > 0) out[k] = q;
  }
  return out;
}

/** The Supply & trade panel data of `colony`. Logistics and badges are empty until the planet has a supply window / a region pin. */
export function supplyTradeView(state: PlanetState, colony: ColonyState): SupplyTradeView | null {
  const lv = getLogisticsView(state, colony.index);
  const stock = (colony.stock ?? {}) as Partial<Record<ResourceKey, number>>;
  const orbit = ((colony.cargo as { inOrbit?: Partial<Record<ResourceKey, number>> } | undefined)?.inOrbit ?? {});
  const holdings: Partial<Record<ResourceKey, number>> = {};
  for (const k of RESOURCE_KEYS) holdings[k] = (stock[k] ?? 0) + (orbit[k] ?? 0);
  const demands = jobDemands(state, colony.index);
  const bill = logisticsBill(state, colony.index, lv);
  for (const b of bill?.bill ?? []) demands.push({ reason: 'logistics', resource: b.resource, qty: Math.ceil(Number(b.units)) });
  const reserved = ((colony.market as { reservedInOrbit?: Partial<Record<ResourceKey, number>> } | undefined)?.reservedInOrbit ?? {});
  const b = badges(state);
  return { badges: b.badges, mainResource: b.main, basket: shoppingBasket({ holdings, reservedByOrders: reserved, demands, safety: safetyStock(colony, holdings) }), logistics: bill, remedy: remedyContext() };
}
