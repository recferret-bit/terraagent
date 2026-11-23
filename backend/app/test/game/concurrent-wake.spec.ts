import 'reflect-metadata';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { MetricsRegistry } from '../../src/core/metrics.registry';
import type { AppEnv } from '../../src/core/tokens';
import { GamePlanets } from '../../src/game/game-planets.service';
import { SnapshotService } from '../../src/game/persistence/snapshot.service';
import type { SnapshotStore } from '../../src/game/persistence/snapshot-store';
import { SimThreadPool } from '../../src/game/sim-thread-pool';
import type { FromThread } from '../../src/game/thread/protocol';

let games: GamePlanets | undefined;
afterEach(async () => { await games?.shutdown(); games = undefined; });

/** Real `GamePlanets`, `SimThreadPool` and `SnapshotService`; a fake store and lease. The planet is saved, then unloaded. */
async function dormantPlanet(id: string) {
  const pool = new SimThreadPool({ threads: 1, flags: ['W00'], autoStep: false, rebalance: false });
  await pool.start();
  const g = (games = new GamePlanets(pool));
  await g.load(id);
  const snap = await new Promise<Uint8Array>((resolve) => {
    const off = g.pool.listen((_t, m: FromThread) => { if (m.t === 'snapshot' && m.planetId === id) { off(); resolve(m.bytes.slice()); } });
    g.requestSnapshot(id);
  });
  await g.unload(id);
  const lease: string[] = [];
  let reads = 0;
  let gate: Promise<void> | undefined;
  const store = {
    hasSnapshots: async () => true,
    latest: async () => { if (++reads === 2) await gate; return { raw: snap.slice(), savedAt: new Date(), tick: 0 }; },
    livePlanetIds: async () => [id],
  } as unknown as SnapshotStore;
  const simLease = {
    tryAcquire: async (p: string) => { lease.push(`acquire:${p}`); return true; },
    releasePlanet: async (p: string) => { lease.push(`release:${p}`); },
  };
  const env = { SNAPSHOTS: 'on', SNAPSHOT_EVERY_S: 3600, NODE_ENV: 'test' } as unknown as AppEnv;
  const svc = new SnapshotService(g, store, new MetricsRegistry(), env, pino({ level: 'silent' }), undefined, undefined, undefined, undefined, undefined, undefined, simLease as never);
  return { g, svc, lease, reads: () => reads, holdSecondRead: () => { let open!: () => void; gate = new Promise<void>((r) => (open = r)); return open; } };
}

describe('two wakes of the same sleeping planet at once', () => {
  it('both callers succeed from one restore, and the lease of the running planet is never released', async () => {
    const id = 'pl_wake_twice';
    const p = await dormantPlanet(id);
    const [a, b] = await Promise.all([p.svc.restoreIfPersisted(id), p.svc.restoreIfPersisted(id)]);
    expect([a, b]).toEqual(['restored', 'loaded']);
    expect(p.g.isLoaded(id)).toBe(true);
    expect(p.reads()).toBe(1); // one snapshot read and decode, not one per caller
    expect(p.lease).toEqual([`acquire:${id}`]);
    expect(await p.svc.restoreIfPersisted(id)).toBe('loaded');
  }, 60_000);

  it('a failed restore is reported to every waiting caller and can be tried again', async () => {
    const id = 'pl_wake_fail';
    const p = await dormantPlanet(id);
    const failing = p.svc as unknown as { restore: (planetId: string) => Promise<string> };
    const real = failing.restore.bind(p.svc);
    failing.restore = async () => 'held';
    const results = await Promise.allSettled([p.svc.restoreIfPersisted(id), p.svc.restoreIfPersisted(id)]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(p.lease.filter((l) => l.startsWith('release'))).toHaveLength(1);
    failing.restore = real;
    expect(await p.svc.restoreIfPersisted(id)).toBe('restored');
  }, 60_000);
});
