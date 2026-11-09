import { MetricRow, type ResourceKey } from '@terra/contracts';
import type { PostingInput } from '@terra/ledger';
import { ENTITY_KIND } from '../../../ecs/columns';
import type { PlanetState } from '../../../kernel/state';
import { getLogisticsView, type LogisticsView } from '../../../systems/logistics';
import type { FlowWindow } from '../../flows/metric';
import { ratio, ratioToDecimal } from '../../flows/ratio';
import { resolvePlanetRegion } from '../../regions/planetRegion';
import { parseRegionSpec, sectorKey, type RegionFixtureSpec } from './spec';

const SCARCE_BELOW_BP = 5000;
const SERVICE_FLOOR_BP = 5000;
const SHORT_STATUSES = new Set(['grace', 'partial', 'unavailable']);
const MICRO = 1_000_000n;

/** Posting reasons by role (whole units): where a sector's flows come from and go to. */
const PRODUCTION = new Set(['production.tick', 'terraform.yield']);
const TRADE_IN = new Set(['trade', 'cargo.import']);
const TRADE_OUT = new Set(['trade', 'cargo.export']);

interface SectorFlow { production: bigint; imports: bigint; exports: bigint; logistics: bigint }
const zero = (): SectorFlow => ({ production: 0n, imports: 0n, exports: 0n, logistics: 0n });

/**
 * Per-sector region/logistics metrics of one run (ECONOMY §9). Pre-W11 the planet is one region, so colonies map onto the
 * fixture's sector ids (`assumptions.region.sectors`; unlisted colonies are `sector:0`). Per sector and window:
 *  - `flow.production|imports|exports|logistics` per resource (whole units, from the postings of that window);
 *  - `region.occurrence_bp` per resource (the resolved regional abundance) and the trade reasons
 *    `trade.reason.scarce_resource`, `.shortage_trade`, `.opportunistic_trade`, `.local_production`, `.export_surplus`,
 *    `.logistics_investment` (Supply Depots built) and `.reserve_mode` (units in reserve);
 *  - logistics `logistics.load|capacity|utilization|multiplier|distance_mean|bill|shortage_entities|min_service_bp` and the
 *    gate input `viability.basic_survival` (1 = no purchases, service above the floor and water in stock).
 */
export class RegionSampler {
  readonly rows: MetricRow[] = [];
  private readonly spec: RegionFixtureSpec;
  private depotsSeen = new Map<string, number>();
  private readonly occurrence = new Map<string, Map<string, number>>();

  constructor(assumptions: Readonly<Record<string, unknown>>, private readonly runId: string, private readonly resources: readonly ResourceKey[]) {
    const spec = parseRegionSpec(assumptions);
    if (!spec) throw new Error('RegionSampler needs assumptions.region');
    this.spec = spec;
    for (let i = 0; i < spec.colonies; i++) this.occurrenceOf(i);
  }

  private occurrenceOf(colony: number): Map<string, number> {
    const key = sectorKey(this.spec, colony);
    let m = this.occurrence.get(key);
    if (!m) {
      const s = this.spec.sectors[String(colony)];
      const res = resolvePlanetRegion({ regions: this.spec.regions }, { planetType: this.spec.planetType, planetId: 'pl_region', ...(s?.archetype ? { sectorArchetype: s.archetype } : {}), ...(s ? { sectorId: s.sectorId } : {}) });
      m = new Map(res.ok ? res.region.resources.map((r) => [r.resource, r.fields.occurrenceWeightBp]) : []);
      this.occurrence.set(key, m);
    }
    return m;
  }

  private row(window: FlowWindow, scope: string, metricKey: string, value: string | null, unit: string, resource?: ResourceKey, reason?: string): void {
    this.rows.push(MetricRow.parse({ runId: this.runId, window, scope, metricKey, value, unit, ...(resource ? { resource } : {}), ...(reason ? { reason } : {}) }));
  }

  private flows(since: readonly PostingInput[], sectors: ReadonlyMap<number, string>): Map<string, Map<string, SectorFlow>> {
    const out = new Map<string, Map<string, SectorFlow>>();
    for (const p of since) {
      for (const l of p.legs) {
        const m = /^colony:(\d+)$/.exec(l.account);
        const sector = m ? sectors.get(Number(m[1])) : undefined;
        if (!sector) continue;
        const per = out.get(sector) ?? new Map<string, SectorFlow>();
        const f = per.get(l.asset) ?? zero();
        const d = BigInt(l.delta);
        if (d > 0n && PRODUCTION.has(p.reason)) f.production += d;
        else if (d > 0n && TRADE_IN.has(p.reason)) f.imports += d;
        else if (d < 0n && TRADE_OUT.has(p.reason)) f.exports -= d;
        else if (p.reason === 'logistics.supply') f.logistics -= d;
        else if (p.reason === 'logistics.release') f.logistics -= d;
        per.set(l.asset, f);
        out.set(sector, per);
      }
    }
    return out;
  }

  /** One sample of every sector over `window`; `since` are the postings made in it. */
  sample(state: PlanetState, since: readonly PostingInput[], window: FlowWindow): void {
    const sectors = new Map<number, string>();
    for (let i = 0; i < this.spec.colonies; i++) sectors.set(i, sectorKey(this.spec, i));
    const flows = this.flows(since, sectors);
    for (const scope of [...new Set(sectors.values())].sort()) {
      const colonies = [...sectors].filter(([, s]) => s === scope).map(([i]) => i);
      const views = colonies.map((i) => getLogisticsView(state, i));
      this.sampleFlows(window, scope, colonies, flows.get(scope) ?? new Map(), views);
      this.sampleLogistics(state, window, scope, colonies, views, flows.get(scope) ?? new Map());
    }
  }

  private sampleFlows(window: FlowWindow, scope: string, colonies: number[], per: Map<string, SectorFlow>, views: LogisticsView[]): void {
    const shortOf = (k: string): boolean => views.some((v) => Object.values(v.entities).some((e) => (e.need[k] ?? 0) > 0 && SHORT_STATUSES.has(e.status)));
    const occ = this.occurrenceOf(colonies[0]!);
    for (const k of this.resources) {
      const f = per.get(k) ?? zero();
      const scarce = (occ.get(k) ?? 10000) < SCARCE_BELOW_BP;
      this.row(window, scope, 'flow.production', f.production.toString(), 'units', k);
      this.row(window, scope, 'flow.imports', f.imports.toString(), 'units', k);
      this.row(window, scope, 'flow.exports', f.exports.toString(), 'units', k);
      this.row(window, scope, 'flow.logistics', f.logistics.toString(), 'units', k);
      this.row(window, scope, 'region.occurrence_bp', String(occ.get(k) ?? 10000), 'bp', k);
      this.row(window, scope, 'trade.reason.scarce_resource', scarce ? '1' : '0', 'flag', k);
      const short = shortOf(k);
      this.row(window, scope, 'trade.reason.shortage_trade', (short ? f.imports : 0n).toString(), 'units', k);
      this.row(window, scope, 'trade.reason.opportunistic_trade', (short ? 0n : f.imports).toString(), 'units', k);
      this.row(window, scope, 'trade.reason.local_production', f.production.toString(), 'units', k);
      this.row(window, scope, 'trade.reason.export_surplus', f.exports.toString(), 'units', k);
    }
  }

  private sampleLogistics(state: PlanetState, window: FlowWindow, scope: string, colonies: number[], views: LogisticsView[], per: Map<string, SectorFlow>): void {
    let L = ratio(0n), K = 0, M = ratio(1n), routeSum = 0n, routed = 0n, short = 0, minBp = 10000, units = 0;
    const bill: Record<string, bigint> = {};
    for (const v of views) {
      const s = v.summary;
      if (s) {
        const [n, d] = s.L.split('/').map(BigInt) as [bigint, bigint];
        L = ratio(L.num * d + n * L.den, L.den * d);
        K += s.K;
        if (s.M) { const [mn, md] = s.M.split('/').map(BigInt) as [bigint, bigint]; if (mn * M.den > M.num * md) M = ratio(mn, md); }
      }
      for (const e of Object.values(v.entities)) {
        if (SHORT_STATUSES.has(e.status)) short++;
        minBp = Math.min(minBp, e.ratioBp);
        if (e.routeTiles !== null) { routeSum += BigInt(e.routeTiles); routed++; }
        for (const [k, micro] of Object.entries(e.need)) bill[k] = (bill[k] ?? 0n) + BigInt(micro);
      }
    }
    this.row(window, scope, 'logistics.load', ratioToDecimal(L, 6), 'load');
    this.row(window, scope, 'logistics.capacity', String(K), 'load');
    if (K > 0) this.row(window, scope, 'logistics.utilization', ratioToDecimal(ratio(L.num, L.den * BigInt(K)), 6), 'ratio');
    else this.row(window, scope, 'logistics.utilization', null, 'ratio', undefined, 'no_capacity');
    this.row(window, scope, 'logistics.multiplier', ratioToDecimal(M, 6), 'ratio');
    if (routed > 0n) this.row(window, scope, 'logistics.distance_mean', ratioToDecimal(ratio(routeSum, routed), 6), 'tiles');
    else this.row(window, scope, 'logistics.distance_mean', null, 'tiles', undefined, 'no_capacity');
    for (const [k, micro] of Object.entries(bill)) this.row(window, scope, 'logistics.bill', ratioToDecimal(ratio(micro, MICRO), 6), 'units', k as ResourceKey);
    this.row(window, scope, 'logistics.shortage_entities', String(short), 'count');
    this.row(window, scope, 'logistics.min_service_bp', String(minBp), 'bp');
    const cols = state.entities.cols;
    let depots = 0;
    for (let r = 0; r < state.entities.count; r++) {
      if (cols.hp[r] <= 0 || !colonies.includes(cols.owner[r]!)) continue;
      if (cols.kind[r] === ENTITY_KIND.supplyDepot) depots++;
      if (cols.kind[r] === ENTITY_KIND.worker) units++;
    }
    const built = Math.max(0, depots - (this.depotsSeen.get(scope) ?? depots));
    this.depotsSeen.set(scope, depots);
    const reserved = colonies.reduce((n, i) => n + reservedCount(state, i), 0);
    this.row(window, scope, 'trade.reason.logistics_investment', String(built), 'count');
    this.row(window, scope, 'trade.reason.reserve_mode', String(reserved), 'count');
    const imports = [...per.values()].reduce((a, f) => a + f.imports, 0n);
    const water = colonies.reduce((a, i) => a + Number(state.colonies[i]?.stock && (state.colonies[i]!.stock as Record<string, number>)['bio.water'] || 0), 0);
    const alive = depots + units >= 0 && minBp >= SERVICE_FLOOR_BP && imports === 0n && water > 0;
    this.row(window, scope, 'viability.basic_survival', alive ? '1' : '0', 'flag');
  }
}

function reservedCount(state: PlanetState, colony: number): number {
  const byId = (state.blobs.units?.value as { byId?: Record<string, { reserve?: unknown }> } | undefined)?.byId ?? {};
  const cols = state.entities.cols;
  let n = 0;
  for (let r = 0; r < state.entities.count; r++) if (cols.owner[r] === colony && cols.hp[r] > 0 && byId[String(cols.id[r])]?.reserve) n++;
  return n;
}
