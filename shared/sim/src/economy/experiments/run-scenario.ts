import { parseWaves, RESOURCE_KEYS, type ExperimentManifest, type MetricRow, type ResourceKey } from '@terra/contracts';
import { compileData } from '../../data';
import { seedStream } from '../../kernel/rng';
import type { LedgerPosting } from '../../kernel/context';
import type { SimHost } from '../../host/SimHost';
import type { CompiledProfile } from '../compile-profile';
import { inventoryNext } from '../flows/inventory';
import { createBehavior } from './behaviors';
import { ExperimentInputError } from './errors';
import { scenarioHashOf, stateHashOf } from './hashes';
import { MarketBridge } from './market-bridge';
import { MarketHarness, type HarnessConfig } from './market-harness';
import { Sampler } from './sampling';
import type { BehaviorContext, BehaviorProfile, BehaviorStats, ExperimentScenarioDef, FlowsReconciliation, RunResult, RunSummary } from './types';

const DEFAULT_RESOURCES: readonly ResourceKey[] = ['bio.water', 'bio.biomass', 'metals.t1', 'minerals.t1'];

/** Resources a scenario trades: `assumptions.tradeResources` (validated) or the default set. */
export function tradeResourcesOf(assumptions: Readonly<Record<string, unknown>>): ResourceKey[] {
  const raw = assumptions.tradeResources;
  if (!Array.isArray(raw)) return [...DEFAULT_RESOURCES];
  return raw.filter((k): k is ResourceKey => (RESOURCE_KEYS as readonly string[]).includes(k as string));
}

const sameFlags = (a: readonly string[], b: readonly string[]): boolean => [...a].sort().join() === [...b].sort().join();

function harnessConfig(manifest: ExperimentManifest, compiled: CompiledProfile, prefix: string, flags: readonly string[]): HarnessConfig {
  const m = compiled.marketConfig;
  if (!m) throw new ExperimentInputError('wave_disabled', 'the market harness needs wave W13 (manifest waves must include it)');
  return {
    policyVersion: m.policyVersion, platformFeeBp: m.platformFeeBp, stallFeeMaxBp: m.stallFeeMaxBp, openOrderLimit: m.openOrderLimit,
    treasury: { enabled: flags.includes('W22'), shareBp: m.treasuryShareBp, accountId: 'acct:treasury' },
    ticksPerSecond: manifest.ticksPerSecond, tradeIdPrefix: prefix,
  };
}

interface Loop {
  readonly host: SimHost;
  readonly bridge: MarketBridge;
  readonly harness: MarketHarness;
  readonly behavior: BehaviorProfile;
  readonly ctx: BehaviorContext;
  readonly postings: LedgerPosting[];
  readonly stats: BehaviorStats;
  readonly negative: Set<string>;
}

function stepOnce(l: Loop, dt: number): void {
  l.behavior.act(l.ctx);
  const res = l.host.step(dt);
  for (const o of res.outcomes) if (o.code) l.stats.rejected[`${o.kind}:${o.code}`] = (l.stats.rejected[`${o.kind}:${o.code}`] ?? 0) + 1;
  l.bridge.process(res);
  for (const c of l.host.state.colonies) {
    if (!c) continue;
    for (const k of RESOURCE_KEYS) if (((c.stock as Record<string, number>)[k] ?? 0) < 0) l.negative.add(k);
  }
}

const sumStock = (host: SimHost, key: ResourceKey): bigint => host.state.colonies.reduce((a, c) => a + BigInt((c?.stock as Record<string, number> | undefined)?.[key] ?? 0), 0n);

function reconcile(l: Loop, sampler: Sampler, opening: Record<string, bigint>, window: { startTick: number; endTick: number }): FlowsReconciliation {
  const resources: Record<string, FlowsReconciliation['resources'][string]> = {};
  for (const k of RESOURCE_KEYS) {
    const f = sampler.measureFlows[k];
    const sum = (r: Record<string, bigint>): bigint => Object.values(r).reduce((a, b) => a + b, 0n);
    const expected = inventoryNext(opening[k]!, f);
    const closing = sumStock(l.host, k);
    resources[k] = {
      opening: opening[k]!.toString(), production: sum(f.production).toString(), imports: f.imports.toString(), exports: f.exports.toString(),
      consumption: sum(f.consumption).toString(), recovered: f.recovered.toString(), capped: sum(f.capped).toString(),
      expectedClosing: expected.toString(), closing: closing.toString(), drift: (closing - expected).toString(),
    };
  }
  const held = l.harness.totalOf('USDC');
  const funded = l.harness.funded.get('USDC') ?? 0n;
  return { window, basis: 'stock', resources, usdc: { funded: funded.toString(), held: held.toString(), drift: (held - funded).toString() }, negativeStock: [...l.negative].sort() };
}

function summarize(l: Loop, ticks: number): RunSummary {
  const vol: Record<string, bigint> = {};
  let notional = 0n, platform = 0n, stall = 0n;
  for (const t of l.harness.trades) {
    vol[t.batch.base] = (vol[t.batch.base] ?? 0n) + t.batch.qty;
    notional += t.batch.notional; platform += t.batch.platformFee; stall += t.batch.stallFee;
  }
  return {
    ticks, trades: l.harness.trades.length, placedOrders: l.harness.placed, rejectedOrders: l.harness.rejected, expiredOrders: l.harness.expired,
    volumeByResource: Object.fromEntries(Object.keys(vol).sort().map((k) => [k, vol[k]!.toString()])),
    notionalUsdc: notional.toString(), platformFeeUsdc: platform.toString(), stallFeeUsdc: stall.toString(), behavior: l.stats,
  };
}

function setup(manifest: ExperimentManifest, scenario: ExperimentScenarioDef, seed: number, compiled: CompiledProfile): { loop: Loop; runId: string; flags: string[] } {
  const flags = [...parseWaves(manifest.waves).list];
  if (!sameFlags(flags, compiled.flags)) throw new ExperimentInputError('waves_mismatch', `manifest waves "${manifest.waves}" differ from the compiled profile's (${compiled.flags.join(',')})`);
  if (manifest.profile.hash !== compiled.overridesHash) throw new ExperimentInputError('profile_hash_mismatch', `manifest pins profile hash ${manifest.profile.hash} but the compiled profile is ${compiled.overridesHash}`);
  const data = compileData(new Set(flags), compiled.overrides);
  if (data.hash !== compiled.dataHash) throw new ExperimentInputError('data_hash_mismatch', `compiled data hash ${data.hash} differs from the profile's ${compiled.dataHash}`);
  const host = scenario.createHost({ seed, flags, data });
  if (host.pipeline.config.data.hash !== compiled.dataHash) throw new ExperimentInputError('data_hash_mismatch', 'the scenario host does not run the compiled profile data');
  const runId = `${scenario.manifest.id}@${scenario.manifest.version}:seed${seed}`;
  const behavior = createBehavior(manifest.behaviorProfile, scenario.manifest.assumptions.behavior as Record<string, unknown> | undefined);
  if (!behavior) throw new ExperimentInputError('unknown_behavior', `unknown behaviorProfile "${manifest.behaviorProfile}"`);
  const harness = new MarketHarness(harnessConfig(manifest, compiled, runId, flags));
  const budget = manifest.demandModel.perPayingActorMonthlyBudgetUsdcAtomic;
  for (const c of host.state.colonies) if (c) harness.fund(c.id, 'USDC', BigInt(budget));
  const stats: BehaviorStats = { exports: 0, imports: 0, ordersRequested: 0, rejected: {} };
  const bridge = new MarketBridge(host, harness);
  let n = 0;
  const ctx: BehaviorContext = {
    host, harness, bridge, manifest, scenario: scenario.manifest, rng: seedStream(`experiment:${seed}`, 'experiment'), stats,
    resources: tradeResourcesOf(scenario.manifest.assumptions), nextCommandId: () => `b${++n}`,
  };
  const postings: LedgerPosting[] = [];
  host.onPostings((p) => { postings.push(...p); });
  return { loop: { host, bridge, harness, behavior, ctx, postings, stats, negative: new Set() }, runId, flags };
}

/**
 * Runs one scenario for one seed on a compiled economy profile (ECONOMY §6). Steps the real `SimHost` (the same
 * pipeline the server and the browser host run, on the compiled data), applies the scripted behaviour through the real
 * `market.placeOrder` command and the isolated in-memory market harness, and samples `MetricRow`s with the flow
 * calculators. Pure and deterministic: the same inputs give byte-identical metrics and hashes (no clock, no `Math.random`).
 */
export function runScenario(manifest: ExperimentManifest, scenario: ExperimentScenarioDef, seed: number, compiled: CompiledProfile): RunResult {
  const { loop, runId } = setup(manifest, scenario, seed, compiled);
  const { host } = loop;
  const start = host.tick;
  const measureStart = start + manifest.warmupTicks;
  const end = measureStart + manifest.measureTicks;
  const sampler = new Sampler({ runId, resources: loop.ctx.resources, ticksPerDay: BigInt(manifest.ticksPerSecond) * 86_400n });
  loop.behavior.init?.(loop.ctx);
  const advanceTo = (target: number): void => {
    while (host.tick < target) stepOnce(loop, Math.min(loop.behavior.actEveryTicks, target - host.tick));
  };
  advanceTo(measureStart);
  loop.postings.length = 0;
  const opening = Object.fromEntries(RESOURCE_KEYS.map((k) => [k, sumStock(host, k)])) as Record<string, bigint>;
  let windowStart = measureStart;
  while (windowStart < end) {
    const next = Math.min(windowStart + manifest.sampleEveryTicks, end);
    advanceTo(next);
    sampler.sample(host.state, loop.harness, loop.postings, { startTick: windowStart, endTick: next });
    loop.postings.length = 0;
    windowStart = next;
  }
  const rng = loop.ctx.rng;
  const metrics: MetricRow[] = sampler.rows;
  return {
    runId, scenarioId: scenario.manifest.id, scenarioVersion: scenario.manifest.version, seed, metrics,
    flowsReconciliation: reconcile(loop, sampler, opening, { startTick: measureStart, endTick: end }),
    hashes: { profileHash: compiled.overridesHash, dataHash: compiled.dataHash, scenarioHash: scenarioHashOf(scenario.manifest), stateHash: stateHashOf(host.snapshot(), loop.harness.digest()) },
    rngState: Array.from(rng), summary: summarize(loop, end - start),
  };
}
