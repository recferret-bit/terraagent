import { describe, expect, it } from 'vitest';
import { retryDelayMs, throttleSlot } from '../../src/jobs/job-queue.port';
import { memoryJobs } from '../../src/jobs/jobs.service';
import { MemoryJobQueue } from '../../src/jobs/memory/memory-job-queue';
import { instanceKeyOf } from '../../src/jobs/recurring';
import { nextCronMs, parseCron } from '../../src/jobs/schedule/cron';
import { slotNext } from '../../src/jobs/schedule/slot-trigger';
import { eventually, jobQueueContract } from './job-queue.contract';

jobQueueContract('memory', async () => ({ port: new MemoryJobQueue(), close: async () => undefined }), { pollMs: 50, exactStats: true });

describe('memory adapter: cron schedules', () => {
  it('a per-second cron creates one job per occurrence', async () => {
    const port = new MemoryJobQueue();
    const at: number[] = [];
    await port.start();
    await port.work('cron.tick', {}, async () => { at.push(Date.now()); });
    await port.schedule('cron.tick', { cron: '* * * * * *' });
    await new Promise((r) => setTimeout(r, 2_300));
    await port.stop();
    expect(at.length).toBeGreaterThanOrEqual(2);
    expect(at.length).toBeLessThanOrEqual(3);
  });
});

describe('schedule arithmetic', () => {
  it('cron: next occurrence for 5- and 6-field expressions (UTC)', () => {
    const t0 = Date.UTC(2026, 10, 23, 10, 7, 30);
    expect(nextCronMs('*/15 * * * *', t0)).toBe(Date.UTC(2026, 10, 23, 10, 15, 0));
    expect(nextCronMs('0 3 * * *', t0)).toBe(Date.UTC(2026, 10, 24, 3, 0, 0));
    expect(nextCronMs('*/10 * * * * *', t0)).toBe(Date.UTC(2026, 10, 23, 10, 7, 40));
    expect(nextCronMs('0 9 * * 1', t0)).toBe(Date.UTC(2026, 10, 30, 9, 0, 0)); // the next Monday
    expect(() => parseCron('61 * * * *')).toThrow(/bad cron field/);
    expect(() => parseCron('* * *')).toThrow(/5 or 6 fields/);
  });

  it('interval: every instance fires mid-slot, into the same throttle slot', () => {
    const next = slotNext(30_000);
    const slotStart = 999_990_000; // a multiple of 30 s
    const a = next(slotStart + 1_000);
    const b = next(slotStart + 14_999);
    expect(a).toBe(b);
    expect(next(slotStart + 15_000)).toBe(a + 30_000); // past mid-slot: the next slot's middle
    expect(throttleSlot(a, 30_000)).toBe(throttleSlot(b, 30_000));
    expect(a % 30_000).toBe(15_000);
  });

  it('retry backoff doubles from the base delay and respects the cap', () => {
    expect(retryDelayMs({ retryDelayMs: 2_000 }, 3)).toBe(2_000);
    expect(retryDelayMs({ retryDelayMs: 2_000, retryBackoff: true }, 0)).toBe(2_000);
    expect(retryDelayMs({ retryDelayMs: 2_000, retryBackoff: true }, 3)).toBe(16_000);
    expect(retryDelayMs({ retryDelayMs: 2_000, retryBackoff: true, retryDelayMaxMs: 10_000 }, 3)).toBe(10_000);
  });

  it('instance keys are queue-name safe and stable', () => {
    expect(instanceKeyOf('host:123:ab cd', 4001)).toBe('host-123-ab-cd');
    expect(instanceKeyOf(undefined, 4001)).toMatch(/^[\w.-]+-4001$/);
  });
});

describe('JobsService registrations', () => {
  it('applies registrations made before bootstrap, runs the loop once per slot and stops it', async () => {
    const jobs = memoryJobs();
    let runs = 0;
    const reg = jobs.recurring({ name: 'test.loop', schedule: { everyMs: 300 }, run: async () => { runs++; } });
    jobs.onApplicationBootstrap();
    await jobs.whenStarted();
    await eventually(() => runs >= 2, 3_000);
    await reg.stop();
    const after = runs;
    await new Promise((r) => setTimeout(r, 700));
    expect(runs).toBe(after);
    await jobs.onModuleDestroy();
  });

  it('a failing loop is not retried or dead-lettered: the next interval is its retry', async () => {
    const jobs = memoryJobs();
    let tries = 0;
    // a day-long slot: the schedule itself does not fire during the test, the one job below is the only run
    jobs.recurring({ name: 'test.poison', schedule: { everyMs: 86_400_000 }, run: async () => { tries++; throw new Error('boom'); } });
    jobs.onApplicationBootstrap();
    await jobs.whenStarted();
    await jobs.port.enqueue('test.poison', {});
    await eventually(() => tries >= 1);
    await new Promise((r) => setTimeout(r, 400));
    expect(tries).toBe(1);
    expect((await jobs.port.stats()).map((s) => s.queue)).toEqual(['test.poison']);
    await jobs.onModuleDestroy();
  });

  it('a registration that fails once is applied on the retry instead of staying off', async () => {
    const jobs = memoryJobs();
    const define = jobs.define.bind(jobs);
    let failures = 1;
    jobs.define = (def) => (failures-- > 0 ? Promise.reject(new Error('P1001: database blip')) : define(def));
    let runs = 0;
    jobs.recurring({ name: 'test.flaky-boot', schedule: { everyMs: 200 }, run: async () => { runs++; } });
    jobs.onApplicationBootstrap();
    await jobs.whenStarted();
    expect(runs).toBe(0);
    await eventually(() => runs >= 1, 9_000); // first retry after 5 s
    await jobs.onModuleDestroy();
  }, 15_000);

  it('a registration made while bootstrap is still applying is applied once, and a stop in flight leaves no worker', async () => {
    const jobs = memoryJobs();
    let applies = 0;
    let release!: () => void;
    const define = jobs.define.bind(jobs);
    jobs.define = async (def) => { applies++; await new Promise<void>((r) => (release = r)); return define(def); };
    let runs = 0;
    const reg = jobs.recurring({ name: 'test.race', schedule: { everyMs: 100 }, run: async () => { runs++; } });
    jobs.onApplicationBootstrap();
    await eventually(() => applies === 1);
    const stopped = reg.stop(); // stop while its apply is in flight
    release();
    await stopped;
    await jobs.whenStarted();
    await new Promise((r) => setTimeout(r, 400));
    expect(applies).toBe(1);
    expect(runs).toBe(0);
    await jobs.onModuleDestroy();
  });

  it('sim-host and instance jobs are not registered on an api replica', async () => {
    const jobs = memoryJobs({ simRole: 'api' });
    jobs.recurring({ name: 'test.host', scope: 'sim-host', schedule: { everyMs: 1_000 }, run: async () => undefined });
    jobs.recurring({ name: 'test.inst', scope: 'instance', schedule: { everyMs: 1_000 }, run: async () => undefined });
    jobs.recurring({ name: 'test.any', schedule: { everyMs: 1_000 }, run: async () => undefined });
    jobs.onApplicationBootstrap();
    await jobs.whenStarted();
    expect((await jobs.port.stats()).map((s) => s.queue).sort()).toEqual(['test.any']);
    await jobs.onModuleDestroy();
  });

  it('instance jobs use a queue of their own per instance', () => {
    const jobs = memoryJobs({ instanceKey: 'node-a' });
    expect(jobs.queueFor('market.director', 'instance')).toBe('market.director/node-a');
    expect(jobs.queueFor('market.director', 'cluster')).toBe('market.director');
  });
});
