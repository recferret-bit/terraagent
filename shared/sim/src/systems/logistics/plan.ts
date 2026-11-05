import type { CompiledRow } from '../../data';
import { evaluateLogistics, pathRouteTiles, RouteCache, type EntityService, type LogisticsCoefficients, type LogisticsNode } from '../../economy/logistics';
import type { Ratio } from '../../economy/flows/ratio';
import type { CompiledDataLike } from '../../kernel/config';
import type { ColonyState, PlanetState } from '../../kernel/state';
import { getColonyPriorities } from '../goals/priorities';
import { w01Row } from '../rows';
import { collectInputs, type ColonyInputs } from './inputs';
import { addMicro, cleanMap, reserveFromColony, stockMicro } from './micro';
import type { ColonyLogistics, EntityLocal, EntityWindow, MicroMap, WindowRecord } from './state';

const BP = 10000;
const MICRO = 1_000_000;
const COEFF_KEYS = ['alphaBp', 'maxMultiplierBp', 'betaBp', 'referenceRouteTiles', 'maxDistanceRatioBp', 'readinessReserveBp', 'readinessReadyBp',
  'readinessMovingBp', 'readinessCombatBp', 'minCombatServiceBp', 'graceWindows'] as const;

export function coefficientsOf(data: CompiledDataLike): LogisticsCoefficients {
  const row = w01Row(data, 'logistics', 'coefficients');
  return Object.fromEntries(COEFF_KEYS.map((k) => [k, Number(row[k])])) as unknown as LogisticsCoefficients;
}

export interface ServiceParams { windowTicks: number; localReserveBp: number; graceTicks: number }

export function serviceParams(data: CompiledDataLike, c: LogisticsCoefficients): ServiceParams {
  const row: CompiledRow = w01Row(data, 'logistics', 'service');
  const windowTicks = Math.max(1, Math.round(Number(row.windowS)));
  return { windowTicks, localReserveBp: Number(row.localReserveBp), graceTicks: c.graceWindows * windowTicks };
}

const routeCaches = new WeakMap<PlanetState, RouteCache>();
function routesFor(state: PlanetState, version: number): RouteCache {
  let c = routeCaches.get(state);
  if (!c) {
    c = new RouteCache(version, pathRouteTiles(state, { band: { minDist: 0, maxDist: 2 }, maxExpansions: 4000 }));
    routeCaches.set(state, c);
  }
  c.invalidate(version); // new window segment: terrain, power or node changes may alter routes
  return c;
}

const ratioMicro = (r: Ratio, num: number, den: number): number => Number((r.num * BigInt(MICRO) * BigInt(num)) / (r.den * BigInt(den)));

/** Required micro-units of one entity for a segment: priced (distance, congestion) when supplied, baseline when no supply. */
function needOf(svc: EntityService, consumption: Record<string, number | bigint>, len: number, windowTicks: number): MicroMap {
  const need: MicroMap = {};
  if (svc.unavailable === null) {
    for (const [k, r] of Object.entries(svc.supplyCost)) addMicro(need, k, ratioMicro(r, len, windowTicks));
  } else {
    for (const [k, v] of Object.entries(consumption)) addMicro(need, k, Math.floor((Number(v) * svc.activityBp * MICRO * len) / (BP * windowTicks)));
  }
  return cleanMap(need);
}

interface Planned { svc: EntityService; prio: number; idNum: number; w: EntityWindow }

function newLocal(p: ServiceParams): EntityLocal { return { reserve: {}, graceLeftTicks: p.graceTicks, ratioBp: BP, status: 'supplied' }; }

/** Allocates scarce stock by player priority then entity id, per resource; unavailable entities get no stock. */
function allocate(col: ColonyState, ordered: Planned[]): MicroMap {
  const avail: MicroMap = {};
  for (const p of ordered) for (const k of Object.keys(p.w.need)) if (avail[k] === undefined) avail[k] = stockMicro(col, k);
  for (const p of ordered) {
    for (const [k, n] of Object.entries(p.w.need)) {
      const got = p.svc.unavailable === null ? Math.min(n, avail[k]!) : 0;
      avail[k]! -= got;
      if (got > 0) p.w.held[k] = got;
    }
  }
  return avail;
}

/** Local reserve top-up for fully supplied entities, from what is left after every need was met. */
function topUp(ordered: Planned[], local: Record<string, EntityLocal>, left: MicroMap, params: ServiceParams, base: Map<string, Record<string, number | bigint>>): void {
  for (const p of ordered) {
    if (p.svc.unavailable !== null) continue;
    if (Object.entries(p.w.need).some(([k, n]) => (p.w.held[k] ?? 0) < n)) continue;
    const l = local[p.svc.id]!;
    for (const [k, v] of Object.entries(base.get(p.svc.id) ?? {})) {
      const cap = Math.floor((Number(v) * MICRO * params.localReserveBp) / BP);
      const add = Math.min(Math.max(0, cap - (l.reserve[k] ?? 0)), left[k] ?? 0);
      if (add <= 0) continue;
      left[k] = (left[k] ?? 0) - add;
      p.w.topup[k] = add;
    }
  }
}

/** Coverage of a bundled recipe: the minimum available/required ratio across its resources (bp), supply plus local reserve. */
function coverageBp(w: EntityWindow, l: EntityLocal): number {
  let f = BP;
  for (const [k, n] of Object.entries(w.need)) {
    const have = (w.held[k] ?? 0) + Math.min(l.reserve[k] ?? 0, n - (w.held[k] ?? 0));
    f = Math.min(f, Math.floor((have * BP) / n));
  }
  return f;
}

function applyService(p: Planned, l: EntityLocal, len: number, params: ServiceParams): void {
  const f = coverageBp(p.w, l);
  for (const [k, n] of Object.entries(p.w.need)) {
    const used = Math.floor((n * f) / BP), fromSupply = Math.min(p.w.held[k] ?? 0, used);
    if (fromSupply > 0) p.w.fromSupply[k] = fromSupply;
    if (used > fromSupply) p.w.fromReserve[k] = used - fromSupply;
    l.reserve[k] = (l.reserve[k] ?? 0) - (used - fromSupply) + (p.w.topup[k] ?? 0);
  }
  const fromReserve = Object.keys(p.w.fromReserve).length > 0;
  if (f >= BP) {
    l.ratioBp = BP;
    l.status = fromReserve ? 'reserve' : 'supplied';
    if (!fromReserve && len >= params.windowTicks) l.graceLeftTicks = params.graceTicks; // only a full supplied window refills grace
  } else if (l.graceLeftTicks > 0) {
    l.ratioBp = BP;
    l.status = 'grace';
    l.graceLeftTicks = Math.max(0, l.graceLeftTicks - len);
  } else {
    l.ratioBp = f;
    l.status = p.svc.unavailable !== null ? 'unavailable' : 'partial';
  }
  l.reserve = cleanMap(l.reserve);
  p.w.held = cleanMap(p.w.held);
}

/**
 * Plans one window segment `[tick, endTick)`: evaluates the load, allocates scarce stock by player priority and entity id,
 * reserves it from the colony (`logistics.supply`), applies local reserve then grace, and pins everything in a record.
 */
export function planWindow(
  state: PlanetState, col: ColonyState, cs: ColonyLogistics, inputs: ColonyInputs, o: { data: CompiledDataLike; tick: number; index: number; seg: number; endTick: number; params: ServiceParams },
): WindowRecord {
  const { params, tick } = o, len = Math.max(0, o.endTick - tick);
  const evalr = evaluateLogistics({ ...inputs, coefficients: coefficientsOf(o.data), routeTiles: routesFor(state, o.index * 1024 + o.seg).routeTiles });
  const dom = evalr.domains[0];
  const prio = getColonyPriorities(state, col.index);
  const consumption = new Map<string, Record<string, number | bigint>>();
  const kindOf = new Map<string, 'building' | 'unit'>();
  for (const b of inputs.buildings) { consumption.set(b.id, b.consumption); kindOf.set(b.id, 'building'); }
  for (const u of inputs.units) { consumption.set(u.id, u.consumption); kindOf.set(u.id, 'unit'); }
  const planned: Planned[] = (dom?.entities ?? []).map((svc) => ({
    svc, idNum: Number(svc.id), prio: kindOf.get(svc.id) === 'building' ? prio.economy : prio.defense,
    w: { kind: kindOf.get(svc.id)!, nodeId: svc.nodeId, routeTiles: svc.routeTiles, unavailable: svc.unavailable, need: needOf(svc, consumption.get(svc.id)!, len, params.windowTicks), held: {}, fromSupply: {}, fromReserve: {}, topup: {} },
  }));
  planned.sort((a, b) => b.prio - a.prio || a.idNum - b.idNum);
  for (const p of planned) cs.entities[p.svc.id] ??= newLocal(params);
  const left = allocate(col, planned);
  topUp(planned, cs.entities, left, params, consumption);
  const reserved: MicroMap = {};
  for (const p of planned) {
    applyService(p, cs.entities[p.svc.id]!, len, params);
    for (const [k, v] of Object.entries(p.w.held)) addMicro(reserved, k, v);
    for (const [k, v] of Object.entries(p.w.topup)) addMicro(reserved, k, v);
  }
  reserveFromColony(col, reserved, tick);
  const entities: Record<string, EntityWindow> = {};
  for (const p of planned.sort((a, b) => a.idNum - b.idNum)) entities[p.svc.id] = p.w;
  const summary = { K: dom?.K ?? 0, L: `${dom?.L.num ?? 0n}/${dom?.L.den ?? 1n}`, u: dom?.u ? `${dom.u.num}/${dom.u.den}` : null, M: dom?.M ? `${dom.M.num}/${dom.M.den}` : null };
  return { key: `${col.index}/${o.index}.${o.seg}`, index: o.index, seg: o.seg, startTick: tick, endTick: o.endTick, dataHash: o.data.hash, summary, nodeIds: inputs.nodes.filter(nodeCounts).map((n) => n.id).sort(), entities };
}

export { collectInputs };

const nodeCounts = (n: LogisticsNode): boolean => n.commissioned && n.powered && n.operational && n.throughputPerWindow > 0;
