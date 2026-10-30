import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prunableIds } from '../../src/game/persistence/retention';
import { SnapshotScheduler, staggerOffsetMs } from '../../src/game/persistence/snapshot-scheduler';

const bytes = (n: number) => new Uint8Array([n]);

describe('stagger', () => {
  it('is deterministic, inside the period and spreads planets', () => {
    const ids = Array.from({ length: 40 }, (_, i) => `pl_${i}`);
    const offs = ids.map((id) => staggerOffsetMs(id, 60_000));
    expect(offs).toEqual(ids.map((id) => staggerOffsetMs(id, 60_000)));
    for (const o of offs) { expect(o).toBeGreaterThanOrEqual(0); expect(o).toBeLessThan(60_000); }
    expect(new Set(offs).size).toBeGreaterThan(30);
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
