// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STAKING_TIERS } from '@terra/contracts';
import { DirectorPanel } from '../director/DirectorPanel';
import { GuildOffers } from '../guild-tab/GuildOffers';
import { GuildVisitModel } from '../guild-tab/model';
import stakingHud from './index';

const makeHudFetch = (state: { tier: number; w28On: boolean }) =>
  vi.fn(async (input: RequestInfo | URL) => {
    if (!state.w28On) return new Response('{}', { status: 404 });
    if (String(input).includes('/v1/near/staking/overview')) {
      return new Response(JSON.stringify({ apy: { grossApyBp: 900, netApyBp: 720, protocolYieldShareBp: 2000, source: 'live' } }), { status: 200 });
    }
    const row = STAKING_TIERS[state.tier]!;
    return new Response(
      JSON.stringify({
        accountId: state.tier === 0 ? null : 'pilot.near',
        perks: {
          active: state.tier >= 1, minStakeNear: '10', totalStakedNear: String(row.minStakeNear), grossApyBp: 900, netApyBp: 720, protocolYieldShareBp: 2000,
          platformFeeBp: row.takerFeeBp, standardPlatformFeeBp: 100, managedAutopilotUnlocked: state.tier >= 1, protocolAccountId: 'protocol.near',
          version: 2, tier: state.tier, tierKey: row.key, tierName: row.name, feeTier: state.tier, activeStakedNear: String(row.minStakeNear), unbondingNear: '0',
          aiModel: 'z-ai/glm-5.3-flash', aiMode: state.tier >= 1 ? 'tee' : 'trial', maxAiColonySlots: row.aiColonySlots, activeAiColonySlots: 0,
          dailyAiCallLimit: 90, dailyAiCallsUsed: 0, dailyAiBudgetUsd: 0.25, freeTrialTurnsRemaining: 5, feeWarmupReadyAtMs: null,
          earlyExitFeeBp: 0, earlyExitFreeAtMs: null, stakedSinceMs: null, gasMultiplier: row.gasMultiplier, sweepSeconds: row.sweepSeconds,
          botKeys: row.botKeys, guildRadarLeadMs: row.guildRadarLeadMs, daoVoteWeightBp: row.daoVoteWeightBp, stallRoyaltyBonusBp: row.stallRoyaltyBonusBp,
          leadPatronPlanetIds: [], nextTierMinNear: state.tier < 4 ? STAKING_TIERS[state.tier + 1]!.minStakeNear : null,
        },
        aiBudget: {
          model: 'z-ai/glm-5.3-flash', mode: state.tier >= 1 ? 'tee' : 'trial', dailyBudgetUsd: 0.25, dailyBudgetUsedUsd: 0,
          dailyCallLimit: 90, dailyCallsUsed: 0, tradeBonusCalls: 0, freeTrialTurnsRemaining: 5, freeTrialTurnsTotal: 5,
          trialEligible: true, colonySlotsUsed: 0, colonySlotsMax: row.aiColonySlots,
        },
      }),
      { status: 200 },
    );
  });

describe('In-game HUD staking integration (StakingPill + DirectorPanel + GuildOffers)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    document.body.innerHTML = '';
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('refreshes StakingPill on pilot change and hides on ?host=local', async () => {
    const state = { tier: 0, w28On: true };
    const listeners = new Set<() => void>();
    globalThis.fetch = makeHudFetch(state) as unknown as typeof fetch;

    const hudEl = document.createElement('div');
    const ctx = {
      host: 'server' as const,
      flags: { has: (f: string) => (f === 'W28' ? state.w28On : true) },
      services: {
        pilot: {
          view: () => ({ isGuest: false, accessToken: 'tok', accountId: state.tier > 0 ? 'pilot.near' : null }),
          subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); },
        },
      },
    };
    const instance = stakingHud.hud![0]!.mount(hudEl, ctx as never);
    await vi.waitFor(() => expect(hudEl.querySelector('[data-testid="staking-pill"]')?.textContent).toContain('STAKE'));

    state.tier = 2;
    for (const l of listeners) l();
    await vi.waitFor(() => expect(hudEl.querySelector('[data-testid="staking-pill"]')?.textContent).toContain('TIER 2'));

    const localEl = document.createElement('div');
    const localInstance = stakingHud.hud![0]!.mount(localEl, { ...ctx, host: 'local' } as never);
    expect(localEl.hidden).toBe(true);
    localInstance.dispose();
    instance.dispose();
  });

  it('updates DirectorPanel aiAccess across trial/legacy and guards unmounted GuildOffers', async () => {
    const dirEl = document.createElement('div');
    const director = new DirectorPanel(dirEl);
    director.syncAiAccess({
      model: 'z-ai/glm-5.3-flash', mode: 'trial', dailyBudgetUsd: 0, dailyBudgetUsedUsd: 0, dailyCallLimit: 0,
      dailyCallsUsed: 0, tradeBonusCalls: 0, freeTrialTurnsRemaining: 4, freeTrialTurnsTotal: 5, trialEligible: true,
      colonySlotsUsed: 0, colonySlotsMax: 0,
    });
    expect(dirEl.querySelector<HTMLElement>('[data-testid="director-ai-access"]')?.hidden).toBe(false);
    expect(dirEl.textContent).toContain('4 / 5');
    director.syncAiAccess(null);
    expect(dirEl.querySelector<HTMLElement>('[data-testid="director-ai-access"]')?.hidden).toBe(true);
    director.dispose();

    let resolveRadar!: (v: unknown) => void;
    const radarFetch = vi.fn(() => new Promise((r) => { resolveRadar = r; })) as unknown as typeof fetch;
    const guildEl = document.createElement('div');
    const offers = new GuildOffers(
      guildEl,
      { flags: new Set(['W15', 'W28']), host: 'server', services: { session: { planetId: () => 'pl_1' }, store: { latest: { colonies: [{ id: 'col_0', index: 0 }] } } } } as never,
      new GuildVisitModel(),
      () => 1_000_000,
      radarFetch,
    );
    offers.onShow();
    offers.dispose();
    resolveRadar({
      ok: true,
      json: async () => ({ nowMs: 1_000_000, visits: [{ npcId: 'kestrel', name: 'GHS Kestrel', arriveAt: 1_180_000, departAt: 1_600_000, noticeAt: 900_000, early: true }] }),
    });
    await new Promise((r) => setTimeout(r, 0));
    const earlyEl = guildEl.querySelector<HTMLElement>('[data-testid="guild-early-radar"]');
    expect(!earlyEl || earlyEl.hidden || !earlyEl.textContent?.includes('Kestrel')).toBe(true);
  });
});
