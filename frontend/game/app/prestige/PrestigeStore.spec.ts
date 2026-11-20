import { describe, expect, it, vi } from 'vitest';
import type { StakingPrestigeResponse } from '@terra/contracts/staking/performance';
import { PRESTIGE_TTL_MS, PrestigeStore } from './PrestigeStore';

const data = (planetId: string): StakingPrestigeResponse => ({
  planetId,
  leadPatron: { planetId, accountId: 'bob.near', carrierName: 'ISS bob.near', activeStakedNear: '600', sinceMs: 1, protocolFeeShareBp: 1500 },
  colonies: [{ colonyId: 'col_1', tier: 2 }, { colonyId: 'col_2', tier: 4 }],
});

describe('W28-12 PrestigeStore (unit)', () => {
  it('loads once per planet, shares one in-flight request and reads tiers / patron from the cache', async () => {
    const load = vi.fn(async (id: string) => data(id));
    const store = new PrestigeStore(load);
    expect(store.get('p1')).toBeUndefined();
    const [a, b] = await Promise.all([store.ensureLoaded('p1'), store.ensureLoaded('p1')]);
    expect(a).toBe(b);
    await store.ensureLoaded('p1');
    expect(load).toHaveBeenCalledTimes(1);
    expect(store.tierOfColony('p1', 'col_2')).toBe(4);
    expect(store.visualsOfColony('p1', 'col_2').flagshipCarrier).toBe(true);
    expect(store.leadPatron('p1')?.carrierName).toBe('ISS bob.near');
  });

  it('unknown colony, unknown planet and a none answer all read as tier 0 / no patron', async () => {
    const store = new PrestigeStore(async () => null);
    await store.ensureLoaded('p9');
    expect(store.get('p9')).toBeNull();
    expect(store.tierOfColony('p9', 'x')).toBe(0);
    expect(store.tierOfColony('never', 'x')).toBe(0);
    expect(store.leadPatron('p9')).toBeNull();
    expect(store.visualsOfColony('p9', 'x').uplinkBeam).toBe(false);
  });

  it('a failed load is cached as none for the TTL, then retried (corner: boundary of the TTL)', async () => {
    let t = 1000;
    const load = vi.fn(async () => { throw new Error('boom'); });
    const store = new PrestigeStore(load as never, () => t);
    expect(await store.ensureLoaded('p1')).toBeNull();
    t += PRESTIGE_TTL_MS - 1;
    await store.ensureLoaded('p1');
    expect(load).toHaveBeenCalledTimes(1);
    t += 1;
    await store.ensureLoaded('p1');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('notifies listeners per planet and stops after unsubscribe; clear() forgets', async () => {
    const store = new PrestigeStore(async (id) => data(id));
    const seen: string[] = [];
    const off = store.onChange((id) => seen.push(id));
    await store.ensureLoaded('p1');
    off();
    await store.ensureLoaded('p2');
    expect(seen).toEqual(['p1']);
    store.clear();
    expect(store.get('p1')).toBeUndefined();
  });
});
