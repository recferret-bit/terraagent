import type { BalanceOverrides } from '@terra/sim';
import type { SimThreadPool } from './sim-thread-pool';

/**
 * Sends an economy profile swap to every live sim thread and resolves when each acknowledged that it stored it
 * (`profileScheduled`); planets rebuild their pipeline at the effective tick inside the thread (`PlanetHost`). Idempotent:
 * sending the same base twice leaves the same state. Also records the base for threads respawned later.
 */
export class ProfileSwapper {
  private nextReq = 1;

  constructor(private readonly pool: SimThreadPool) {}

  async swap(overrides: BalanceOverrides, effectiveTick: number, profileHash: string, timeoutMs = 10_000): Promise<boolean> {
    this.pool.setBaseOverrides(overrides);
    const reqId = this.nextReq++;
    const want = new Set<number>();
    for (let t = 0; t < this.pool.size; t++) want.add(t);
    return new Promise<boolean>((resolve) => {
      const done = (ok: boolean) => { clearTimeout(timer); off(); resolve(ok); };
      const timer = setTimeout(() => done(false), timeoutMs);
      const off = this.pool.listen((thread, msg) => {
        if (msg.t === 'profileScheduled' && msg.reqId === reqId) { want.delete(thread); if (want.size === 0) done(true); }
      });
      for (let t = 0; t < this.pool.size; t++) {
        if (!this.pool.send(t, { t: 'profile', reqId, overrides, effectiveTick, profileHash })) want.delete(t); // a dead thread restarts on the new base
      }
      if (want.size === 0) done(true);
    });
  }
}
