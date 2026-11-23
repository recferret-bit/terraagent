import { describe, expect, it } from 'vitest';
import type { StakingPrestigeResponse } from '@terra/contracts/staking/performance';
import type { OrbitalLeadPatron, OrbitalStage } from '@terra/render/orbit/types';
import { MenuPrestige, OrbitPrestige, ownDescentPrestige } from './OrbitPrestige';
import { PrestigeStore } from './PrestigeStore';

const resp = (planetId: string, patron: string | null, colonies: StakingPrestigeResponse['colonies'] = []): StakingPrestigeResponse => ({
  planetId, colonies,
  leadPatron: patron ? { planetId, accountId: `${patron}.near`, carrierName: `ISS ${patron}.near`, activeStakedNear: '550', sinceMs: 1, protocolFeeShareBp: 1500 } : null,
});
function fakeStage() {
  const calls: Array<OrbitalLeadPatron | null> = [];
  return { stage: { setLeadPatron: (p: OrbitalLeadPatron | null) => calls.push(p) } as unknown as OrbitalStage, calls };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('W28-12 OrbitPrestige (unit)', () => {
  it('clears, loads once, then parks the named flagship; re-stepping the same planet does nothing', async () => {
    let loads = 0;
    const store = new PrestigeStore(async (id) => { loads++; return resp(id, 'alice'); });
    const { stage, calls } = fakeStage();
    const o = new OrbitPrestige(() => true, store);
    o.step(stage, 'p1');
    o.step(stage, 'p1');
    await flush();
    expect(loads).toBe(1);
    expect(calls).toEqual([null, { carrierName: 'ISS alice.near' }]);
    o.step(stage, 'p1');
    expect(calls).toHaveLength(2);
  });

  it('a planet change re-applies (and shows nothing for a planet without a patron)', async () => {
    const store = new PrestigeStore(async (id) => resp(id, id === 'p1' ? 'alice' : null));
    const { stage, calls } = fakeStage();
    const o = new OrbitPrestige(() => true, store);
    o.step(stage, 'p1'); await flush();
    o.step(stage, 'p2'); await flush();
    expect(calls.at(-1)).toBeNull();
    expect(calls.filter((c) => c).length).toBe(1);
  });

  it('a late answer for a planet that is no longer selected is ignored', async () => {
    const resolvers: Record<string, (v: StakingPrestigeResponse) => void> = {};
    const store = new PrestigeStore((id) => new Promise((r) => { resolvers[id] = r; }));
    const { stage, calls } = fakeStage();
    const o = new OrbitPrestige(() => true, store);
    o.step(stage, 'p1');
    o.step(stage, 'p2');
    resolvers.p1(resp('p1', 'stale'));
    await flush();
    expect(calls.some((c) => c?.carrierName === 'ISS stale.near')).toBe(false);
  });

  it('disabled (W28 off / ?host=local): never fetches and removes a shown flagship', async () => {
    let loads = 0;
    let on = true;
    const store = new PrestigeStore(async (id) => { loads++; return resp(id, 'alice'); });
    const { stage, calls } = fakeStage();
    const o = new OrbitPrestige(() => on, store);
    o.step(stage, 'p1'); await flush();
    on = false;
    o.step(stage, 'p1');
    expect(calls.at(-1)).toBeNull();
    const o2 = new OrbitPrestige(() => false, store);
    o2.step(stage, 'p9');
    expect(loads).toBe(1);
  });

  it('null stage or planet id is a no-op', () => {
    const store = new PrestigeStore(async (id) => resp(id, 'a'));
    const o = new OrbitPrestige(() => true, store);
    expect(() => { o.step(null, 'p1'); o.step(fakeStage().stage, null); }).not.toThrow();
  });
});

describe('W28-12 own descent prestige (unit)', () => {
  it('Tier 2+ own colony gets the plasma trail; tier 1, no colony, or disabled gets none', async () => {
    const store = new PrestigeStore(async (id) => resp(id, null, [{ colonyId: 'c1', tier: 1 }, { colonyId: 'c2', tier: 2 }]));
    await store.ensureLoaded('p1');
    let own: { planetId: string; colonyId: string } | null = { planetId: 'p1', colonyId: 'c2' };
    let on = true;
    const get = ownDescentPrestige(() => own, () => on, store);
    expect(get()).toEqual({ plasmaTrail: true });
    own = { planetId: 'p1', colonyId: 'c1' };
    expect(get()).toBeUndefined();
    own = null;
    expect(get()).toBeUndefined();
    own = { planetId: 'p1', colonyId: 'c2' }; on = false;
    expect(get()).toBeUndefined();
  });

  it('MenuPrestige is off on ?host=local and when the W28 flag is off, and includes target planet flagshipCarrierName', async () => {
    const store = new PrestigeStore(async (id) => resp(id, 'alice', [{ colonyId: 'c', tier: 4 }]));
    await store.ensureLoaded('p1');
    const own = () => ({ planetId: 'p1', colonyId: 'c' });
    expect(new MenuPrestige({ isLocalHost: () => false, flagOn: () => true, activeColony: own }, store).descent()).toEqual({
      plasmaTrail: true,
      flagshipCarrierName: 'ISS alice.near',
    });
    expect(new MenuPrestige({ isLocalHost: () => true, flagOn: () => true, activeColony: own }, store).descent()).toBeUndefined();
    expect(new MenuPrestige({ isLocalHost: () => false, flagOn: () => false, activeColony: own }, store).descent()).toBeUndefined();
  });
});

describe('W28-12 dev tier override (unit)', () => {
  it('only in dev builds, only 0..4', async () => {
    const { devStakeTier } = await import('./OrbitPrestige');
    expect(devStakeTier('?stakeTier=2', true)).toBe(2);
    expect(devStakeTier('?stakeTier=2', false)).toBeNull();
    for (const q of ['', '?stakeTier=', '?stakeTier=9', '?stakeTier=-1', '?stakeTier=abc', '?stakeTier=1.5']) expect(devStakeTier(q, true)).toBeNull();
  });

  it('the override drives the own-tier trail regardless of colony (and still needs W28 on)', () => {
    const store = new PrestigeStore(async () => null);
    const mk = (flag: boolean, search: string) => new MenuPrestige({ isLocalHost: () => false, flagOn: () => flag, activeColony: () => null }, store, search, true).descent();
    expect(mk(true, '?stakeTier=3')).toEqual({ plasmaTrail: true });
    expect(mk(true, '?stakeTier=1')).toBeUndefined();
    expect(mk(false, '?stakeTier=3')).toBeUndefined();
  });

  it('a wallet-first Tier 2+ staker gets the plasma trail on their very first descent before founding a colony', async () => {
    const store = new PrestigeStore(async () => null);
    let acct: string | null = 'whale.near';
    let tier = 2;
    const mp = new MenuPrestige(
      {
        isLocalHost: () => false,
        flagOn: () => true,
        activeColony: () => null,
        pilotAccount: () => acct,
        fetchWalletTier: async () => tier,
      },
      store,
      '',
      false,
    );
    expect(mp.descent()).toBeUndefined(); // first frame kicks off async load
    await flush();
    expect(mp.descent()).toEqual({ plasmaTrail: true });
    // Tier 1 / guest account gets no plasma trail
    acct = 'scout.near';
    tier = 1;
    expect(mp.descent()).toBeUndefined();
    await flush();
    expect(mp.descent()).toBeUndefined();
    acct = null;
    expect(mp.descent()).toBeUndefined();
  });

  it('preserves walletTierFallback plasma trail even while activeColony is non-null and planet prestige is still 0', async () => {
    const store = new PrestigeStore(async (id) => resp(id, 'patron', [{ colonyId: 'fresh_col', tier: 0 }]));
    await store.ensureLoaded('p2');
    const mp = new MenuPrestige(
      {
        isLocalHost: () => false,
        flagOn: () => true,
        activeColony: () => ({ planetId: 'p2', colonyId: 'fresh_col' }),
        pilotAccount: () => 'linked.near',
        fetchWalletTier: async () => 2,
      },
      store,
      '',
      false,
    );
    mp.descent();
    await flush();
    expect(mp.descent()).toEqual({ plasmaTrail: true, flagshipCarrierName: 'ISS patron.near' });
  });
});
