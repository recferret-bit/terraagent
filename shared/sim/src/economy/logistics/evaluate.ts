import { ZERO, addRatio, mulRatio, ratio, sumRatios, type Ratio } from '../flows/ratio';
import type {
  DomainEvaluation, EntityService, EvaluateLogisticsInput, LogisticsBuilding, LogisticsCoefficients, LogisticsEvaluation, LogisticsNode,
  LogisticsUnit, RouteTilesFn, UnavailableReason,
} from './types';

const BP = 10000n;
const ONE: Ratio = ratio(1n);
const bp = (v: number): Ratio => ratio(BigInt(v), BP);
const cmp = (a: Ratio, b: Ratio): number => { const d = a.num * b.den - b.num * a.den; return d < 0n ? -1 : d > 0n ? 1 : 0; };
const minRatio = (a: Ratio, b: Ratio): Ratio => (cmp(a, b) <= 0 ? a : b);
const byId = <T extends { readonly id: string }>(a: T, b: T): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

interface Active {
  readonly kind: 'building' | 'unit';
  readonly e: LogisticsBuilding | LogisticsUnit;
  readonly activityBp: number;
}

const READINESS = { reserve: 'readinessReserveBp', ready: 'readinessReadyBp', moving: 'readinessMovingBp', combat: 'readinessCombatBp' } as const;
const clampBp = (v: number): number => Math.min(10000, Math.max(0, Math.trunc(v)));

const isAvailable = (n: LogisticsNode): boolean => n.commissioned && n.powered && n.operational && n.throughputPerWindow > 0;

/** Distinct available nodes of a domain (a node listed twice, e.g. by two sector queries, counts once; sorted by id). */
function domainNodes(nodes: readonly LogisticsNode[]): LogisticsNode[] {
  const seen = new Map<string, LogisticsNode>();
  for (const n of [...nodes].sort(byId)) {
    const prev = seen.get(n.id);
    // a duplicate keeps the weaker state so a stale copy can never add capacity
    if (!prev || (isAvailable(prev) && !isAvailable(n)) || (isAvailable(prev) === isAvailable(n) && n.throughputPerWindow < prev.throughputPerWindow)) seen.set(n.id, n);
  }
  return [...seen.values()];
}

/** One eligible reachable node per entity: shortest route, ties broken by node id. Returns the reason when none. */
function assign(
  ent: Active, avail: readonly LogisticsNode[], hadNodes: boolean, routeTiles: RouteTilesFn,
): { node: LogisticsNode; tiles: number } | UnavailableReason {
  if (!hadNodes) return 'no_supply_node';
  if (avail.length === 0) return 'no_capacity';
  let best: { node: LogisticsNode; tiles: number } | null = null;
  let anyPath = false;
  for (const node of avail) {
    const tiles = routeTiles(ent.e, node);
    if (tiles === null || !Number.isFinite(tiles) || tiles < 0) continue;
    anyPath = true;
    if (tiles > node.reachTiles) continue;
    if (!best || tiles < best.tiles || (tiles === best.tiles && node.id < best.node.id)) best = { node, tiles };
  }
  return best ?? (anyPath ? 'out_of_reach' : 'unreachable');
}

function distanceFactor(tiles: number, c: LogisticsCoefficients): Ratio {
  const ratioTiles = ratio(BigInt(tiles), BigInt(Math.max(1, c.referenceRouteTiles)));
  return addRatio(ONE, mulRatio(bp(c.betaBp), minRatio(ratioTiles, bp(c.maxDistanceRatioBp))));
}

/** `M = min(maxMultiplier, 1 + alpha * max(0, u - 1)^2)`. */
function congestion(u: Ratio, c: LogisticsCoefficients): Ratio {
  const excess = cmp(u, ONE) > 0 ? addRatio(u, ratio(-1n)) : ZERO;
  return minRatio(bp(c.maxMultiplierBp), addRatio(ONE, mulRatio(bp(c.alphaBp), mulRatio(excess, excess))));
}

const activeLoad = (a: Active): Ratio => mulRatio(ratio(BigInt(a.e.weight)), bp(a.activityBp));

function evaluateDomain(domainId: string, ents: Active[], rawNodes: readonly LogisticsNode[], input: EvaluateLogisticsInput): DomainEvaluation {
  const c = input.coefficients;
  const nodes = domainNodes(rawNodes);
  const avail = nodes.filter(isAvailable);
  const K = avail.reduce((s, n) => s + n.throughputPerWindow, 0);
  const assigned = ents.map((ent) => ({ ent, res: assign(ent, avail, nodes.length > 0, input.routeTiles) }));
  const served = assigned.filter((a) => typeof a.res !== 'string');
  const L = sumRatios(served.map((a) => activeLoad(a.ent)));
  const u = K > 0 ? ratio(L.num, L.den * BigInt(K)) : null;
  const M = u ? congestion(u, c) : null;

  const totalCost: Record<string, Ratio> = {};
  const unavailable: Partial<Record<UnavailableReason, string[]>> = {};
  const entities: EntityService[] = assigned.map(({ ent, res }) => {
    const base = { id: ent.e.id, kind: ent.kind, domainId, ...(ent.e.groupId !== undefined ? { groupId: ent.e.groupId } : {}), activityBp: ent.activityBp };
    if (typeof res === 'string' || !M) {
      const reason = typeof res === 'string' ? res : 'no_capacity';
      (unavailable[reason] ??= []).push(ent.e.id);
      return { ...base, nodeId: null, routeTiles: null, distanceFactor: null, supplyCost: {}, unavailable: reason };
    }
    const df = distanceFactor(res.tiles, c);
    const factor = mulRatio(mulRatio(bp(ent.activityBp), df), M);
    const supplyCost: Record<string, Ratio> = {};
    for (const [resource, amount] of Object.entries(ent.e.consumption).sort(([a], [b]) => (a < b ? -1 : 1))) {
      const cost = mulRatio(ratio(BigInt(amount)), factor);
      supplyCost[resource] = cost;
      totalCost[resource] = addRatio(totalCost[resource] ?? ZERO, cost);
    }
    return { ...base, nodeId: res.node.id, routeTiles: res.tiles, distanceFactor: df, supplyCost, unavailable: null };
  });
  return { domainId, intendedLoad: sumRatios(ents.map(activeLoad)), L, K, u, M, supplyCost: totalCost, entities, unavailable };
}

/**
 * Pure logistics evaluation of one supply window (ECON-LOG-01): per service domain load `L`, capacity `K`, `u`, congestion
 * `M`, per-entity distance factor and per-resource supply cost, as exact rationals. Capacity counts distinct commissioned,
 * powered, operational nodes once per domain, so group labels / sector splits never add capacity. `K = 0`, unreachable and
 * out-of-reach entities are marked unavailable with a reason (never a division by zero, never invented capacity).
 */
export function evaluateLogistics(input: EvaluateLogisticsInput): LogisticsEvaluation {
  const c = input.coefficients;
  const active: Active[] = [
    ...input.buildings.map((e): Active => ({ kind: 'building', e, activityBp: clampBp(e.operatingBp) })),
    ...input.units.map((e): Active => ({ kind: 'unit', e, activityBp: clampBp(c[READINESS[e.readiness]]) })),
  ].filter((a) => a.activityBp > 0 && a.e.weight >= 0);
  active.sort((a, b) => byId(a.e, b.e));
  const ids = new Set([...active.map((a) => a.e.domainId), ...input.nodes.map((n) => n.domainId)]);
  const domains = [...ids].sort().map((id) => evaluateDomain(id, active.filter((a) => a.e.domainId === id), input.nodes.filter((n) => n.domainId === id), input));
  const cost: Record<string, Ratio> = {};
  for (const d of domains) for (const [r, v] of Object.entries(d.supplyCost)) cost[r] = addRatio(cost[r] ?? ZERO, v);
  return { domains, totals: { L: sumRatios(domains.map((d) => d.L)), K: domains.reduce((s, d) => s + d.K, 0), supplyCost: cost } };
}
