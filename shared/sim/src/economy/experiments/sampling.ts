import type { MetricRow, ResourceKey } from '@terra/contracts';
import type { PostingInput } from '@terra/ledger';
import type { PlanetState } from '../../kernel/state';
import { accountFlows, netConsumption, totalProduction, type ResourceFlow } from '../flows/accounting';
import { daysOfInventory } from '../flows/calculators';
import { globalInventory } from '../flows/inventory';
import { metricOf, nullMetric, toMetricRow, type FlowWindow, type Metric } from '../flows/metric';
import { ratio, type Ratio } from '../flows/ratio';
import { addFlowTable, emptyFlowTable } from './flow-sum';
import type { HarnessTrade, MarketHarness } from './market-harness';

const RESIDUAL = 1_000_000n;

export interface SamplerOptions {
  readonly runId: string;
  readonly resources: readonly ResourceKey[];
  readonly ticksPerDay: bigint;
  /** Colony ids of related accounts (one owner): trades among them are reported apart and excluded from organic metrics. */
  readonly related?: ReadonlySet<string>;
}

const stockOf = (state: PlanetState, ci: number, key: ResourceKey): bigint => BigInt((state.colonies[ci]?.stock as Record<string, number> | undefined)?.[key] ?? 0);

/**
 * Samples `MetricRow`s with the shared flow calculators (ECONOMY §2, W13-42) and keeps the running measure-window flow
 * sum the reconciliation needs. Postings are given per sample (those since the last one), never kept.
 */
export class Sampler {
  readonly rows: MetricRow[] = [];
  readonly measureFlows = emptyFlowTable();
  private last: FlowWindow | null = null;
  private placedSeen = 0;

  constructor(private readonly opts: SamplerOptions) {}

  private push(m: Metric<Ratio | bigint>, key: string, extra: { resource?: ResourceKey } = {}): void {
    this.rows.push(toMetricRow(m, key, { ...extra, runId: this.opts.runId }));
  }

  /** `window` is `(prevSample, now]`; `since` are the postings of that window. */
  sample(state: PlanetState, harness: MarketHarness, since: readonly PostingInput[], window: FlowWindow): void {
    const flows = accountFlows(since, window, 'stock');
    addFlowTable(this.measureFlows, flows.global);
    for (const key of this.opts.resources) this.sampleResource(state, flows.global[key], key, window);
    this.sampleMarket(harness, window);
    this.last = window;
  }

  private sampleResource(state: PlanetState, flow: ResourceFlow, key: ResourceKey, window: FlowWindow): void {
    const scope = 'global';
    const inv = globalInventory(state.colonies, key);
    this.push(metricOf(inv.activeMicro / RESIDUAL, 'units', window, scope), 'inventory.position', { resource: key });
    this.push(metricOf(inv.stock, 'units', window, scope), 'inventory.stock', { resource: key });
    this.push(metricOf(inv.inOrbit, 'units', window, scope), 'inventory.orbit', { resource: key });
    this.push(metricOf(totalProduction(flow), 'units', window, scope), 'flow.production', { resource: key });
    this.push(metricOf(netConsumption(flow), 'units', window, scope), 'flow.consumption', { resource: key });
    this.push(metricOf(flow.exports, 'units', window, scope), 'flow.exports', { resource: key });
    this.push(metricOf(flow.imports, 'units', window, scope), 'flow.imports', { resource: key });
    for (const c of state.colonies) {
      if (!c) continue;
      const cs = `colony:${c.index}`;
      this.push(metricOf(stockOf(state, c.index, key), 'units', window, cs), 'inventory.stock', { resource: key });
    }
    this.push(daysOfInventory({ available: inv.stock, windowConsumption: netConsumption(flow), window, ticksPerDay: this.opts.ticksPerDay, scope }), 'days_of_inventory', { resource: key });
  }

  private tradesIn(harness: MarketHarness, window: FlowWindow): HarnessTrade[] {
    return harness.trades.filter((t) => t.atTick > window.startTick && t.atTick <= window.endTick);
  }

  private sampleMarket(harness: MarketHarness, window: FlowWindow): void {
    const scope = 'global';
    const trades = this.tradesIn(harness, window);
    this.push(metricOf(BigInt(trades.length), 'count', window, scope), 'market.trades');
    if (this.opts.related && this.opts.related.size > 0) {
      const rel = this.opts.related;
      const isRelated = (t: HarnessTrade): boolean => t.parties.filter((p) => p.role === 'buyer' || p.role === 'seller').every((p) => rel.has(p.colonyId));
      const related = trades.filter(isRelated).length;
      this.push(metricOf(BigInt(related), 'count', window, scope), 'market.trades.related');
      this.push(metricOf(BigInt(trades.length - related), 'count', window, scope), 'market.trades.organic');
    }
    this.push(metricOf(BigInt(harness.openOrders().length), 'count', window, scope), 'market.open_orders');
    const sum = (f: (t: HarnessTrade) => bigint): bigint => trades.reduce((a, t) => a + f(t), 0n);
    this.push(metricOf(sum((t) => t.batch.notional), 'usdc_atomic', window, scope), 'market.notional');
    this.push(metricOf(sum((t) => t.batch.platformFee), 'usdc_atomic', window, scope), 'market.fee.platform');
    this.push(metricOf(sum((t) => t.batch.stallFee), 'usdc_atomic', window, scope), 'market.fee.stall');
    const placed = harness.placed - this.placedSeen;
    this.placedSeen = harness.placed;
    this.push(placed > 0 ? metricOf(ratio(BigInt(trades.length), BigInt(placed)), 'trades_per_order', window, scope) : nullMetric('insufficient_data', 'trades_per_order', window, scope), 'market.fill_ratio');
    for (const key of this.opts.resources) {
      const mine = trades.filter((t) => t.batch.base === key);
      const volume = mine.reduce((a, t) => a + t.batch.qty, 0n);
      const notional = mine.reduce((a, t) => a + t.batch.notional, 0n);
      this.push(metricOf(volume, 'units', window, scope), 'market.volume', { resource: key });
      this.push(volume > 0n ? metricOf(ratio(notional, volume), 'usdc_atomic_per_unit', window, scope) : nullMetric('uncertain_price', 'usdc_atomic_per_unit', window, scope), 'market.price.vwap', { resource: key });
    }
  }

  get lastWindow(): FlowWindow | null {
    return this.last;
  }
}
