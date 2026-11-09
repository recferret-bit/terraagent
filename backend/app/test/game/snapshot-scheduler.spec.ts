import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prunableIds } from '../../src/game/persistence/retention';
import { SnapshotScheduler, spreadOffset, staggerOffsetMs } from '../../src/game/persistence/snapshot-scheduler';

/** Ten ULID planet ids minted together. Raw FNV put three of them in second 29; the mixer must not. */
const TEN_PLANETS = [
  'pl_01M70FN4WTZQD2S0QP4V2S5N3B',
  'pl_01M70FN4WTH4Q7NGERBQSHBDM2',
  'pl_01M70FN4WT40CT93HSYEDKEYAW',
  'pl_01M70FN4WTQKZBCM97P4KW4YS3',
  'pl_01M70FN4WT43PXK2HFK4KKDX45',
  'pl_01M70FN4WVVX2VTAVRYJWJDBND',
  'pl_01M70FN4WVA4TW6D8WVJVQJZ6V',
  'pl_01M70FN4WVB57HZAX407S2XG1E',
  'pl_01M70FN4WV4P0M6VEX1DW1PJZP',
  'pl_01M70FN4WV6ZXRGSTHEW1XK25S',
];

function firesPerSecond(offsets: readonly number[]): number {
  const buckets = new Map<number, number>();
  for (const offset of offsets) {
    const sec = Math.floor(offset / 1_000);
    buckets.set(sec, (buckets.get(sec) ?? 0) + 1);
  }
  return Math.max(0, ...buckets.values());
}

const bytes = (n: number) => new Uint8Array([n]);

describe('stagger', () => {
  it('is deterministic, inside the period and spreads planets', () => {
    const ids = Array.from({ length: 40 }, (_, i) => `pl_${i}`);
    const offs = ids.map((id) => staggerOffsetMs(id, 60_000));
    expect(offs).toEqual(ids.map((id) => staggerOffsetMs(id, 60_000)));
    for (const o of offs) { expect(o).toBeGreaterThanOrEqual(0); expect(o).toBeLessThan(60_000); }
    expect(new Set(offs).size).toBeGreaterThan(30);
  });

  it('spreads 10 planets over 60 s with at most two fires in one second', () => {
    const period = 60_000;
    const sets = [TEN_PLANETS, Array.from({ length: 10 }, (_, i) => `pl_${i}`)];
    for (const ids of sets) {
      const offs = ids.map((id) => staggerOffsetMs(id, period));
      expect(firesPerSecond(offs)).toBeLessThanOrEqual(2);
      for (const o of offs) {
        expect(o).toBeGreaterThanOrEqual(0);
        expect(o).toBeLessThan(period);
      }
    }
  });

  it('moves a third planet off a second that already has two', () => {
    const taken = new Map<number, number>([[58, 2]]);
    const moved = spreadOffset(58_664, 60_000, taken);
    expect(Math.floor(moved / 1_000)).toBe(59);
    expect(spreadOffset(58_664, 60_000, new Map())).toBe(58_664);
  });
});

describe('SnapshotScheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('requests periodically at the staggered offset, then every period', () => {
    const requested: string[] = [];
    const s = new SnapshotScheduler({ loadedIds: () => [], requestSnapshot: (id) => requested.push(id) }, async () => {}, 1000);
    s.track('pl_a');
    const off = staggerOffsetMs('pl_a', 1000);
    vi.advanceTimersByTime(off - 1 > 0 ? off - 1 : 0);
    if (off > 0) expect(requested).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(requested).toEqual(['pl_a']);
    s.onSnapshot('pl_a', { tick: 1, bytes: bytes(1) });
    vi.advanceTimersByTime(1000);
    expect(requested).toEqual(['pl_a', 'pl_a']);
    s.untrack('pl_a');
    vi.advanceTimersByTime(5000);
    expect(requested).toHaveLength(2);
  });

  it('one write in flight per planet; a newer snapshot replaces the queued one', async () => {
    vi.useRealTimers();
    const written: number[] = [];
    let inflight = 0, maxInflight = 0;
    const gate: (() => void)[] = [];
    const s = new SnapshotScheduler({ loadedIds: () => [], requestSnapshot: () => {} }, async (_id, snap) => {
      inflight++; maxInflight = Math.max(maxInflight, inflight);
      await new Promise<void>((r) => gate.push(r));
      written.push(snap.tick); inflight--;
    }, 1000);
    s.onSnapshot('p', { tick: 1, bytes: bytes(1) });
    s.onSnapshot('p', { tick: 2, bytes: bytes(2) });
    s.onSnapshot('p', { tick: 3, bytes: bytes(3) });
    s.onSnapshot('q', { tick: 9, bytes: bytes(9) });
    await Promise.resolve();
    gate.shift()!(); // p:1 done
    await vi.waitFor(() => expect(gate.length).toBe(2)); // p:3 and q:9 running
    while (gate.length) gate.shift()!();
    await s.idle();
    expect(written.filter((t) => t < 9)).toEqual([1, 3]); // tick 2 was replaced
    expect(maxInflight).toBeLessThanOrEqual(2); // p and q at the same time, never two for p
  });

  it('flushAll tags SHUTDOWN, resolves after writes, and times out when a thread never answers', async () => {
    vi.useRealTimers();
    const kinds: string[] = [];
    const ref: { s?: SnapshotScheduler } = {};
    const src = { loadedIds: () => ['a', 'b'], requestSnapshot: (id: string) => { if (id === 'a') queueMicrotask(() => ref.s!.onSnapshot('a', { tick: 7, bytes: bytes(7) })); } };
    const s = (ref.s = new SnapshotScheduler(src, async (_id, snap) => { kinds.push(snap.kind); }, 1000));
    const r = await s.flushAll('SHUTDOWN', 50);
    expect(kinds).toEqual(['SHUTDOWN']);
    expect(r).toEqual({ planets: 2, timedOut: true });
  });
});

describe('SnapshotScheduler cadence', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('asks each of 10 planets once inside the period, and a crowded second is bumped', () => {
    vi.setSystemTime(0);
    const fires: { id: string; at: number }[] = [];
    const ids = [...TEN_PLANETS, 'pl_c0', 'pl_c13', 'pl_c59'];
    const ref: { s?: SnapshotScheduler } = {};
    const s = (ref.s = new SnapshotScheduler({
      loadedIds: () => ids,
      requestSnapshot: (id) => {
        fires.push({ id, at: Date.now() });
        queueMicrotask(() => ref.s!.onSnapshot(id, { tick: 1, bytes: bytes(1) }));
      },
    }, async () => {}, 60_000));
    for (const id of ids) s.track(id);
    vi.advanceTimersByTime(59_999);
    expect(fires).toHaveLength(ids.length);
    expect(new Set(fires.map((f) => f.id)).size).toBe(ids.length);
    expect(firesPerSecond(fires.map((f) => f.at))).toBeLessThanOrEqual(2);
    for (const f of fires) {
      expect(f.at).toBeGreaterThanOrEqual(0);
      expect(f.at).toBeLessThan(60_000);
    }
    s.untrack(ids[0]!);
    vi.advanceTimersByTime(60_000);
    expect(fires.filter((f) => f.id === ids[0])).toHaveLength(1);
  });

  it('does not fire twice across the period boundary', () => {
    vi.setSystemTime(0);
    let id = '';
    for (let i = 0; i < 5_000 && !id; i++) if (staggerOffsetMs(`boundary_${i}`, 1_000) === 0) id = `boundary_${i}`;
    expect(id).not.toBe('');
    const fires: number[] = [];
    const s = new SnapshotScheduler({ loadedIds: () => [id], requestSnapshot: () => fires.push(Date.now()) }, async () => {}, 1_000);
    s.track(id);
    vi.advanceTimersByTime(1);
    expect(fires).toHaveLength(1);
    s.onSnapshot(id, { tick: 1, bytes: bytes(1) }); // an unanswered periodic ask swallows the next one
    vi.advanceTimersByTime(999);
    vi.advanceTimersByTime(1);
    expect(fires).toHaveLength(2);
    expect(fires[1]! - fires[0]!).toBeGreaterThanOrEqual(1_000);
    expect(fires[1]! - fires[0]!).toBeLessThanOrEqual(1_001);
  });

  it('coalesces two periodic requests in the same second, and an empty planet list flushes nothing', async () => {
    const requested: string[] = [];
    const s = new SnapshotScheduler({ loadedIds: () => [], requestSnapshot: (id) => requested.push(id) }, async () => {}, 60_000);
    s.request('p', 'PERIODIC');
    s.request('p', 'PERIODIC');
    expect(requested).toEqual(['p']);
    vi.useRealTimers();
    const empty = new SnapshotScheduler({ loadedIds: () => [], requestSnapshot: () => { throw new Error('no planets'); } }, async () => {}, 1_000);
    await expect(empty.flushAll('SHUTDOWN', 20)).resolves.toEqual({ planets: 0, timedOut: false });
  });

  it('a failed write clears inflight, and a snapshot queued during it is still written', async () => {
    vi.useRealTimers();
    const written: number[] = [];
    const errors: unknown[] = [];
    let release: (() => void) | undefined;
    let inflight = 0;
    let maxForP = 0;
    const s = new SnapshotScheduler({ loadedIds: () => [], requestSnapshot: () => {} }, async (_id, snap) => {
      inflight++;
      maxForP = Math.max(maxForP, inflight);
      if (snap.tick === 1) {
        await new Promise<void>((r) => { release = r; });
        inflight--;
        throw new Error('db down');
      }
      written.push(snap.tick);
      inflight--;
    }, 1_000, (_id, e) => errors.push(e));
    s.onSnapshot('p', { tick: 1, bytes: bytes(1) });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    s.onSnapshot('p', { tick: 2, bytes: bytes(2) });
    s.onSnapshot('p', { tick: 3, bytes: bytes(3) });
    release!();
    await s.idle();
    expect(errors).toHaveLength(1);
    expect(written).toEqual([3]);
    expect(maxForP).toBe(1);
    s.onSnapshot('p', { tick: 4, bytes: bytes(4) });
    await s.idle();
    expect(written).toEqual([3, 4]);
  });
});

describe('prunableIds', () => {
  const H = 3600_000;
  const now = new Date('2026-01-10T12:30:00Z');
  const row = (n: number, minutesAgo: number, kind = 'PERIODIC') => ({ id: BigInt(n), tick: BigInt(n), kind, savedAt: new Date(now.getTime() - minutesAgo * 60_000) });

  it('keeps last 10, first of each hour within 48 h, END and last SEAL', () => {
    const rows = [];
    for (let i = 1; i <= 100; i++) rows.push(row(i, (100 - i) * 2)); // every 2 minutes, last = now
    rows.push({ ...row(0, 60 * 60, 'END'), id: 200n }); // old END
    const del = new Set(prunableIds(rows, now));
    for (let i = 91; i <= 100; i++) expect(del.has(BigInt(i))).toBe(false);
    expect(del.has(200n)).toBe(false);
    // one kept per wall-clock hour older than the last 10
    const kept = rows.filter((r) => !del.has(r.id) && r.tick <= 90n && r.kind !== 'END');
    const hours = new Set(kept.map((r) => Math.floor(r.savedAt.getTime() / H)));
    expect(kept.length).toBe(hours.size);
    expect(del.size).toBeGreaterThan(50);
  });

  it('drops hourly keepers older than 48 h but never END/SEAL', () => {
    const rows = [row(1, 60 * 60, 'SEAL'), row(2, 60 * 50), row(3, 60 * 49), ...Array.from({ length: 10 }, (_, i) => row(10 + i, i))];
    const del = prunableIds(rows, now);
    expect(del.sort()).toEqual([2n, 3n]);
  });
});
