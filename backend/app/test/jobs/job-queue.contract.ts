import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JobContext, JobQueuePort } from '../../src/jobs/job-queue.port';

export interface ContractRig {
  readonly port: JobQueuePort;
  close(): Promise<void>;
}

export interface ContractOptions {
  /** Worker poll interval (pg-boss needs >= 500 ms). */
  readonly pollMs: number;
  /** The adapter's `stats()` is exact right away (memory); pg-boss reads a cache refreshed by its monitor. */
  readonly exactStats: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function eventually(check: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('condition not met in time');
    await sleep(25);
  }
}

interface ContractCtx {
  port(): JobQueuePort;
  q(label: string): string;
  readonly work: { readonly pollMs: number };
}

/** The `JobQueuePort` contract (3.7), run against every adapter so they cannot drift apart. */
export function jobQueueContract(label: string, make: () => Promise<ContractRig>, opts: ContractOptions): void {
  describe(`JobQueuePort contract: ${label}`, () => {
    let rig: ContractRig;
    let n = 0;
    const ctx: ContractCtx = {
      port: () => rig.port,
      q: (s) => `contract.${s}.${Date.now().toString(36)}${++n}`,
      work: { pollMs: opts.pollMs },
    };
    beforeEach(async () => {
      rig = await make();
      await rig.port.start();
    });
    afterEach(async () => {
      await rig.port.stop();
      await rig.close();
    });
    deliveryCases(ctx, opts);
    failureAndScheduleCases(ctx, opts);
  });
}

function deliveryCases(ctx: ContractCtx, opts: ContractOptions): void {
  it('runs an enqueued job once with its data', async () => {
    const name = ctx.q('run');
    const seen: JobContext<{ v: number }>[] = [];
    await ctx.port().createQueue({ name });
    await ctx.port().work<{ v: number }>(name, ctx.work, async (job) => { seen.push(job); });
    expect(await ctx.port().enqueue(name, { v: 7 })).toEqual(expect.any(String));
    await eventually(() => seen.length === 1);
    await sleep(opts.pollMs * 2);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ queue: name, data: { v: 7 }, retryCount: 0 });
  });
  it('runs at most `concurrency` jobs of a queue at once in a process', async () => {
    const name = ctx.q('conc');
    let running = 0;
    let peak = 0;
    let done = 0;
    await ctx.port().createQueue({ name });
    await ctx.port().work(name, { ...ctx.work, concurrency: 2 }, async () => {
      peak = Math.max(peak, ++running);
      await sleep(150);
      running--;
      done++;
    });
    for (let i = 0; i < 5; i++) await ctx.port().enqueue(name, { i });
    await eventually(() => done === 5, 15_000);
    expect(peak).toBe(2);
  });
  it('stately: a second job for a key that is still waiting is coalesced (null)', async () => {
    const name = ctx.q('stately');
    await ctx.port().createQueue({ name, policy: 'stately' });
    expect(await ctx.port().enqueue(name, { planetId: 'a' }, { singletonKey: 'a' })).toEqual(expect.any(String));
    expect(await ctx.port().enqueue(name, { planetId: 'a' }, { singletonKey: 'a' })).toBeNull();
    expect(await ctx.port().enqueue(name, { planetId: 'b' }, { singletonKey: 'b' })).toEqual(expect.any(String));
  });
  it('exclusive: no new job for a key while one runs; one job per key runs at a time', async () => {
    const name = ctx.q('exclusive');
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let started = 0;
    await ctx.port().createQueue({ name, policy: 'exclusive' });
    await ctx.port().work(name, { ...ctx.work, concurrency: 3 }, async () => { started++; await gate; });
    await ctx.port().enqueue(name, {}, { singletonKey: 'k' });
    await eventually(() => started === 1);
    expect(await ctx.port().enqueue(name, {}, { singletonKey: 'k' })).toBeNull();
    release();
    await sleep(opts.pollMs * 2);
    expect(started).toBe(1);
  });
  it('throttle: one job per key per slot, whoever enqueues', async () => {
    const name = ctx.q('throttle');
    await ctx.port().createQueue({ name });
    const slotMs = 60_000;
    const ids = await Promise.all([1, 2, 3].map(() => ctx.port().enqueue(name, {}, { singletonKey: 'tick', throttleMs: slotMs })));
    expect(ids.filter(Boolean)).toHaveLength(1);
    expect(await ctx.port().enqueue(name, {}, { singletonKey: 'other', throttleMs: slotMs })).toEqual(expect.any(String));
  });
}

function failureAndScheduleCases(ctx: ContractCtx, opts: ContractOptions): void {
  it('retries a failed job and passes the retry count', async () => {
    const name = ctx.q('retry');
    const counts: number[] = [];
    await ctx.port().createQueue({ name, retryLimit: 2, retryDelayMs: 0 });
    await ctx.port().work(name, ctx.work, async (job) => {
      counts.push(job.retryCount);
      if (counts.length < 3) throw new Error('flaky');
    });
    await ctx.port().enqueue(name, {});
    await eventually(() => counts.length === 3, 20_000);
    expect(counts).toEqual([0, 1, 2]);
  });
  it('dead-letters a job that failed for good', async () => {
    const name = ctx.q('dlq');
    const dead = `${name}.dead`;
    const letters: object[] = [];
    await ctx.port().createQueue({ name, retryLimit: 0, deadLetter: dead });
    await ctx.port().work(name, ctx.work, async () => { throw new Error('poison'); });
    await ctx.port().work(dead, ctx.work, async (job) => { letters.push(job.data); });
    await ctx.port().enqueue(name, { order: 'mo_1' });
    await eventually(() => letters.length === 1, 20_000);
    expect(letters[0]).toEqual({ order: 'mo_1' });
    if (opts.exactStats) expect((await ctx.port().stats()).find((s) => s.queue === name)?.failed).toBe(1);
  });
  it('an interval schedule runs once per slot', async () => {
    const name = ctx.q('every');
    const at: number[] = [];
    await ctx.port().createQueue({ name, policy: 'exclusive' });
    await ctx.port().work(name, ctx.work, async () => { at.push(Date.now()); });
    await ctx.port().schedule(name, { everyMs: 1_000 });
    await sleep(3_600);
    await ctx.port().unschedule(name);
    expect(at.length).toBeGreaterThanOrEqual(2);
    expect(at.length).toBeLessThanOrEqual(4);
    const slots = at.map((t) => Math.floor((t - 500) / 1_000));
    expect(new Set(slots).size).toBe(slots.length);
  });
  it('stop() on a work handle waits for the running job and takes no new ones', async () => {
    const name = ctx.q('stop');
    let finished = 0;
    let started = 0;
    await ctx.port().createQueue({ name });
    const handle = await ctx.port().work(name, ctx.work, async () => { started++; await sleep(200); finished++; });
    await ctx.port().enqueue(name, {});
    await eventually(() => started === 1);
    await handle.stop();
    expect(finished).toBe(1);
    await ctx.port().enqueue(name, {});
    await sleep(opts.pollMs * 2);
    expect(started).toBe(1);
  });
  it('reports queue depth', async () => {
    const name = ctx.q('depth');
    await ctx.port().createQueue({ name });
    for (let i = 0; i < 3; i++) await ctx.port().enqueue(name, { i });
    if (!opts.exactStats) return;
    expect((await ctx.port().stats()).find((s) => s.queue === name)).toMatchObject({ queued: 3, active: 0, failed: 0 });
  });
}
