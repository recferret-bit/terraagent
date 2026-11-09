// `npm run bench -- market-match` (W13-34): matcher throughput & latency benchmark.
// Asserts that matching against 1,000 resting orders + 100 incoming orders on one planet stays <= 5 ms p99 per match.
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { OrderBook } from '@terra/sim/systems/trade/market-book';
import { matchIncoming, type MatchableOrder } from '@terra/sim/systems/trade/market-matcher';

export interface MarketMatchBenchResult {
  readonly benchmark: 'market-match';
  readonly restingOrders: number;
  readonly incomingOrders: number;
  readonly totalFills: number;
  readonly p50Ms: number;
  readonly p99Ms: number;
  readonly maxMs: number;
  readonly targetP99Ms: number;
  readonly ok: boolean;
}

function makeOrder(seq: number, side: 'buy' | 'sell', colonyIdx: number, amount: bigint, unitPriceAtomic: bigint): MatchableOrder {
  return {
    orderId: `mo_bench_${seq}`,
    seq: BigInt(seq),
    side,
    colonyId: `col_${colonyIdx}`,
    amount,
    filled: 0n,
    priceAmount: amount * unitPriceAtomic,
    fillPolicy: 'partial',
    policyVersion: 'bootstrap-1',
    platformFeeBp: 100,
    stallFeeBp: 50,
    maxStallFeeBp: side === 'buy' ? 100 : null,
  };
}

export function runMarketMatchBenchmark(restingCount = 1_000, incomingCount = 100, targetP99Ms = 5): MarketMatchBenchResult {
  const book = new OrderBook<MatchableOrder>('bio.water/USDC');
  for (let i = 1; i <= restingCount; i++) {
    const side = i % 2 === 0 ? 'buy' : 'sell';
    const level = BigInt(i % 50);
    const unitPrice = side === 'buy' ? 950_000n - level * 1_000n : 1_000_000n + level * 1_000n;
    book.add(makeOrder(i, side, (i % 16) + 1, 25n, unitPrice));
  }

  const samplesMs: number[] = [];
  let totalFills = 0;
  for (let j = 1; j <= incomingCount; j++) {
    const side = j % 2 === 0 ? 'sell' : 'buy';
    const unitPrice = side === 'buy' ? 1_020_000n : 930_000n;
    const incoming = makeOrder(restingCount + j, side, (j % 16) + 17, 60n, unitPrice);
    const t0 = performance.now();
    const res = matchIncoming(book, incoming);
    for (const f of res.fills) {
      const maker = book.get(f.makerOrderId);
      if (maker) book.update(maker.orderId, maker.filled + f.qty);
    }
    if (res.restingRemainder > 0n) {
      book.add({ ...incoming, filled: incoming.amount - res.restingRemainder });
    }
    const elapsed = performance.now() - t0;
    samplesMs.push(elapsed);
    totalFills += res.fills.length;
  }

  const sorted = [...samplesMs].sort((a, b) => a - b);
  const p50Ms = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
  const p99Ms = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] ?? 0;
  const maxMs = sorted[sorted.length - 1] ?? 0;
  return {
    benchmark: 'market-match',
    restingOrders: restingCount,
    incomingOrders: incomingCount,
    totalFills,
    p50Ms: Number(p50Ms.toFixed(4)),
    p99Ms: Number(p99Ms.toFixed(4)),
    maxMs: Number(maxMs.toFixed(4)),
    targetP99Ms,
    ok: p99Ms <= targetP99Ms,
  };
}

function main(): void {
  const name = process.argv[2] ?? 'market-match';
  if (name !== 'market-match') {
    process.stderr.write(`Unknown benchmark "${name}". Supported: market-match\n`);
    process.exit(2);
  }
  // Warm up V8 JIT once before timed sample
  runMarketMatchBenchmark(200, 20, 5);
  const res = runMarketMatchBenchmark(1_000, 100, 5);
  process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
  if (!res.ok) {
    process.stderr.write(`FAIL: p99 ${res.p99Ms} ms exceeds target ${res.targetP99Ms} ms\n`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
