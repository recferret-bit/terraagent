import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseExperimentManifest, parseWaves, type ExperimentManifest } from '@terra/contracts';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { loadExperimentScenarios } from '../../../../tests/economy/scenarios';
import {
  compileProfile, metricsCsv, metricsJsonl, replayCommand, runExperiment, runScenario, SimHost, MarketHarness, resolveScenarios,
  type CompiledProfile, type ExperimentResult, type OrderRequest,
} from '../../src';
import { OrderBook } from '../../src/systems/trade/market-book';
import { matchIncoming, type MatchableOrder } from '../../src/systems/trade/market-matcher';
import { buildTradeBatch } from '../../src/systems/trade/market-batch';

/** W13-44: the headless integrated experiment runner (ECONOMY §6). Short tick counts keep every run around a second. */

const WAVES = '..13';
const FLAGS = [...parseWaves(WAVES).list];
const scenarios = loadExperimentScenarios();
const baseline = compileProfile({ parameters: {} }, FLAGS);
const tmp = mkdtempSync(join(tmpdir(), 'exp-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function manifestFor(compiled: CompiledProfile, id: string, over: Partial<Record<string, unknown>> = {}): ExperimentManifest {
  const parsed = parseExperimentManifest({
    schemaVersion: 1, profile: { id: 'baseline', version: 1, hash: compiled.overridesHash }, engineCommit: 'workspace', waves: WAVES,
    scenarios: [{ id, version: 1 }], seeds: [101, 202], warmupTicks: 100, measureTicks: 1200, sampleEveryTicks: 400, ticksPerSecond: 5,
    budget: { maxRuns: 8, maxWallSeconds: 120, maxWorkers: 1 }, behaviorProfile: 'specialists-v1',
    demandModel: { source: 'assumed', perPayingActorMonthlyBudgetUsdcAtomic: '30000000' }, output: { format: 'jsonl', trace: 'failures' }, ...over,
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return parsed.value;
}

const run = (m: ExperimentManifest, compiled = baseline, ports = {}, filter = {}): ExperimentResult =>
  runExperiment(m, resolveScenarios(m, scenarios), compiled, ports, filter);

describe('same pinned manifest replays', () => {
  it('gives byte-identical metrics and hashes twice, trades really happen, and every hard gate passes', () => {
    const m = manifestFor(baseline, 'baseline-two-colony', { seeds: [101] });
    const a = run(m);
    const b = run(m);
    expect(metricsJsonl(a)).toBe(metricsJsonl(b));
    expect(metricsCsv(a)).toBe(metricsCsv(b));
    expect(a.runs.map((r) => r.run.hashes)).toEqual(b.runs.map((r) => r.run.hashes));
    expect(a.runs.map((r) => r.run.rngState)).toEqual(b.runs.map((r) => r.run.rngState));
    const r = a.runs[0]!.run;
    expect(r.summary.trades).toBeGreaterThan(0);
    expect(r.hashes.dataHash).toBe(baseline.dataHash);
    expect(r.hashes.profileHash).toBe(baseline.overridesHash);
    expect(a.runs[0]!.gates.map((g) => `${g.gateId}:${g.outcome}`)).toEqual([
      'hard.flow_reconciliation:pass', 'hard.no_negative_stock:pass', 'hard.mock_ledger_conservation:pass', 'econ.position_nonnegative:pass',
    ]);
    expect(a.outcome).toBe('pass');
  });

  it('differs between seeds and runs the mature fixture too', () => {
    const m = manifestFor(baseline, 'mature-flat-population', { seeds: [101, 202] });
    const res = run(m);
    expect(res.runs).toHaveLength(2);
    expect(res.runs[0]!.run.rngState).not.toEqual(res.runs[1]!.run.rngState);
    expect(res.runs[0]!.run.hashes.stateHash).not.toBe(res.runs[1]!.run.hashes.stateHash);
    expect(res.runs.every((r) => r.run.summary.trades > 0)).toBe(true);
  });

  it('applies a candidate profile to the sim host and the market (not the bootstrap data)', () => {
    const cand = compileProfile({ parameters: { 'market.policy.platformFeeBp': 250 } }, FLAGS);
    expect(cand.dataHash).not.toBe(baseline.dataHash);
    const m = manifestFor(cand, 'baseline-two-colony', { seeds: [101] });
    const res = run(m, cand).runs[0]!.run;
    expect(res.hashes.dataHash).toBe(cand.dataHash);
    const base = run(manifestFor(baseline, 'baseline-two-colony', { seeds: [101] })).runs[0]!.run.summary;
    expect(BigInt(res.summary.platformFeeUsdc) * 10_000n).toBeGreaterThan(BigInt(base.platformFeeUsdc) * 10_000n);
    expect(() => runScenario(m, scenarios[0]!, 101, baseline)).toThrow(/profile|hash|waves/i);
  });
});

describe('a failing seed reproduces', () => {
  it('fails the strict gate, prints a replay command, and that command reproduces the same hashes', () => {
    const m = manifestFor(baseline, 'strict-gate-probe', { seeds: [101, 202] });
    const ports = { replay: { manifestPath: 'm.json', outDir: 'out' } };
    const first = run(m, baseline, ports);
    expect(first.outcome).toBe('fail');
    expect(first.failing.map((f) => f.seed)).toEqual([101, 202]);
    const f = first.failing[1]!;
    expect(f.gateId).toBe('probe.impossible_trade_count');
    expect(f.replay).toBe(replayCommand({ manifestPath: 'm.json', scenarioId: 'strict-gate-probe', seed: 202, outDir: 'out' }));
    expect(f.replay).toContain('--seed 202');
    const args = f.replay.split(' ');
    const replayed = run(m, baseline, ports, { scenarioId: args[args.indexOf('--scenario') + 1], seed: Number(args[args.indexOf('--seed') + 1]) });
    expect(replayed.runs).toHaveLength(1);
    expect(replayed.runs[0]!.run.hashes).toEqual(first.runs[1]!.run.hashes);
    expect(replayed.failing.map((x) => x.gateId)).toEqual(['probe.impossible_trade_count']);
  });

  it('CLI: exits 3 with the replay line, the printed command reproduces the failing seed, artifacts are laid out', () => {
    const m = manifestFor(baseline, 'strict-gate-probe', { seeds: [101], measureTicks: 800, sampleEveryTicks: 400 });
    const manifestPath = join(tmp, 'm.json');
    writeFileSync(manifestPath, JSON.stringify(m));
    const out = join(tmp, 'out');
    const root = resolve(import.meta.dirname, '../../../..');
    const first = spawnSync('npx', ['tsx', 'scripts/economy/run-experiment.ts', '--manifest', manifestPath, '--out', out], { cwd: root, encoding: 'utf8', timeout: 90_000 });
    expect(first.status, first.stderr).toBe(3);
    for (const f of ['manifest.json', 'summary.json', 'metrics.jsonl', 'metrics.csv', 'replay.txt']) expect(() => readFileSync(join(out, f))).not.toThrow();
    const line = readFileSync(join(out, 'replay.txt'), 'utf8').trim();
    expect(first.stderr).toContain(line);
    const argv = line.split(' ').slice(1);
    const second = spawnSync('npx', argv, { cwd: root, encoding: 'utf8', timeout: 90_000 });
    expect(second.status, second.stderr).toBe(3);
    const hashes = (dir: string): unknown => (JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8')) as { runs: { hashes: unknown }[] }).runs[0]!.hashes;
    expect(hashes(`${out}-replay-strict-gate-probe-101`)).toEqual(hashes(out));
    const bad = spawnSync('npx', ['tsx', 'scripts/economy/run-experiment.ts', '--manifest', manifestPath, '--out', out, '--profile', join(tmp, 'nope.json')], { cwd: root, encoding: 'utf8', timeout: 90_000 });
    expect(bad.status).toBe(2);
  }, 120_000);
});

describe('budget exhaustion is incomplete, never a pass', () => {
  it('maxRuns below the plan and a stop request both end incomplete', () => {
    const capped = run(manifestFor(baseline, 'baseline-two-colony', { seeds: [1, 2, 3], budget: { maxRuns: 1, maxWallSeconds: 60, maxWorkers: 1 }, measureTicks: 400, sampleEveryTicks: 400 }));
    expect(capped.status).toBe('incomplete');
    expect(capped.outcome).toBe('incomplete');
    expect(capped.runs).toHaveLength(1);
    const stopped = run(manifestFor(baseline, 'baseline-two-colony', { seeds: [1, 2], measureTicks: 400, sampleEveryTicks: 400 }), baseline, { shouldStop: () => true });
    expect(stopped.runs).toHaveLength(0);
    expect(stopped.outcome).toBe('incomplete');
  });
});

describe('runtime rules match experiment rules', () => {
  const req = (ref: string, colony: number, side: 'buy' | 'sell', amount: number, price: string): OrderRequest => ({
    ref, colonyId: `col_${colony}`, colonyIndex: colony, side, resource: 'bio.water', amount, price: { token: 'USDC', amount: price }, ttlS: 900, stallFeeBp: 100,
  });
  const cfg = { policyVersion: 'pv1', platformFeeBp: 100, stallFeeMaxBp: 100, openOrderLimit: 8, treasury: { enabled: false, shareBp: 0, accountId: 'acct:treasury' }, ticksPerSecond: 5, tradeIdPrefix: 'parity' };

  it('one match + settlement through the harness equals the shared pure functions the server calls', () => {
    const h = new MarketHarness(cfg);
    h.fund('col_1', 'USDC', 50_000_000n);
    h.handleRequested(req('r-sell', 0, 'sell', 40, '9000000'), 10);
    const out = h.handleRequested(req('r-buy', 1, 'buy', 25, '8000000'), 11);
    expect(out.trades).toHaveLength(1);

    // The same two orders through the pure functions directly (what the server's matcher + batch builder call).
    const mk = (r: OrderRequest, seq: bigint): MatchableOrder & Record<string, unknown> => ({
      orderId: `mo:${r.ref}`, seq, side: r.side, colonyId: r.colonyId, amount: BigInt(r.amount), filled: 0n, priceAmount: BigInt(r.price.amount), fillPolicy: 'partial',
      policyVersion: 'pv1', platformFeeBp: 100, stallFeeBp: 100, maxStallFeeBp: r.side === 'buy' ? 100 : null, accountId: `acct:${r.colonyId}`, stallColonyId: r.colonyId,
      stallAccountId: `acct:${r.colonyId}`, platformAccountId: 'acct:platform', feeBuckets: {}, cumNotional: 0n, reservedPrincipal: 0n, reservedFees: 0n,
    });
    const sell = { ...mk(req('r-sell', 0, 'sell', 40, '9000000'), 1n), reservedPrincipal: 40n } as never as MatchableOrder & Parameters<typeof buildTradeBatch>[0]['seller'];
    const buy = { ...mk(req('r-buy', 1, 'buy', 25, '8000000'), 2n), reservedPrincipal: 8_000_000n, reservedFees: 160_000n } as never as MatchableOrder & Parameters<typeof buildTradeBatch>[0]['buyer'];
    const book = new OrderBook<MatchableOrder>('bio.water/USDC');
    book.add(sell);
    const { fills } = matchIncoming(book, buy);
    expect(fills).toHaveLength(1);
    const batch = buildTradeBatch({ tradeId: 'parity:t1', base: 'bio.water', quote: 'USDC', fill: fills[0]!, buyer: buy, seller: sell, treasury: cfg.treasury });
    const got = out.trades[0]!.batch;
    expect(got.batchHash).toBe(batch.batchHash);
    expect(got.legs).toEqual(batch.legs);
    expect(got.qty).toBe(25n);
    expect(got.notional).toBe((25n * 9_000_000n) / 40n);
    expect(h.balanceOf('acct:col_0', 'USDC')).toBe(got.notional + got.stallFee); // the maker is its own stall
    expect(h.balanceOf('acct:platform', 'USDC')).toBe(got.platformFee);
    expect(h.totalOf('USDC')).toBe(50_000_000n);
  });

  it('steps the real SimHost on the compiled data: no second engine', () => {
    const step = vi.spyOn(SimHost.prototype, 'step');
    const m = manifestFor(baseline, 'baseline-two-colony', { seeds: [101], measureTicks: 400, sampleEveryTicks: 400 });
    const res = run(m);
    expect(step.mock.calls.length).toBeGreaterThan(5);
    expect(step.mock.calls.reduce((a, c) => a + (c[0] as number), 0)).toBeGreaterThanOrEqual(m.warmupTicks + m.measureTicks);
    step.mockRestore();
    expect(res.runs[0]!.run.hashes.dataHash).toBe(baseline.dataHash);
  });
});
