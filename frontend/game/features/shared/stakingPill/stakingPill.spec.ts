// @vitest-environment jsdom
import { STAKING_TIERS, type EvaluatedStakerPerksV2, type StakerPerksResponse } from '@terra/contracts';
import { describe, expect, it, vi } from 'vitest';
import stakingHud from '../../staking-hud';
import { feePillView, type PillFetch, fetchPerks, formatCountdown, pillView } from './model';
import { FeePill, StakingPill } from './pill';

function perks(tier: number, over: Partial<EvaluatedStakerPerksV2> = {}): EvaluatedStakerPerksV2 {
  const t = STAKING_TIERS[tier]!;
  return {
    active: tier > 0, minStakeNear: '10', totalStakedNear: '0', grossApyBp: 900, netApyBp: 720, protocolYieldShareBp: 2000, standardPlatformFeeBp: 100,
    managedAutopilotUnlocked: tier > 0, protocolAccountId: 'protocol.terraagent.near',
    version: 2, tier: t.id, tierKey: t.key, tierName: t.name, feeTier: t.id, platformFeeBp: t.takerFeeBp, activeStakedNear: String(t.minStakeNear),
    unbondingNear: '0', aiModel: 'z-ai/glm-5.3-flash', aiMode: 'tee', maxAiColonySlots: t.aiColonySlots, activeAiColonySlots: 0, dailyAiCallLimit: 0,
    dailyAiCallsUsed: 0, dailyAiBudgetUsd: 0, freeTrialTurnsRemaining: 0, feeWarmupReadyAtMs: null, earlyExitFeeBp: 0, earlyExitFreeAtMs: null,
    stakedSinceMs: null, gasMultiplier: 1, sweepSeconds: 180, botKeys: 1, guildRadarLeadMs: 0, daoVoteWeightBp: 10_000, stallRoyaltyBonusBp: 0,
    leadPatronPlanetIds: [], nextTierMinNear: null, ...over,
  } as unknown as EvaluatedStakerPerksV2;
}
const perksBody = (p: EvaluatedStakerPerksV2): StakerPerksResponse =>
  ({ accountId: 'a.near', perks: p, aiBudget: { model: 'm', mode: 'tee', dailyBudgetUsd: 0, dailyBudgetUsedUsd: 0, dailyCallLimit: 0, dailyCallsUsed: 0, tradeBonusCalls: 0, freeTrialTurnsRemaining: 0, freeTrialTurnsTotal: 5, trialEligible: true, colonySlotsUsed: 0, colonySlotsMax: 0 } }) as StakerPerksResponse;
const apyBody = (source: 'live' | 'sim', net = 720): unknown => ({ apy: { grossApyBp: 900, netApyBp: net, protocolYieldShareBp: 2000, source } });
const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status });

type Fetch = PillFetch & { mock: { calls: unknown[][] } };
function router(p: Response | Error, apy: Response | Error = json(200, apyBody('live'))): Fetch {
  return vi.fn(async (url: string) => {
    const r = url.includes('/perks') ? p : apy;
    if (r instanceof Error) throw r;
    return r.clone();
  }) as unknown as Fetch;
}

describe('pill model', () => {
  it('tier 0 is the STAKE CTA, tier 1..4 show TIER N, numbers from data', () => {
    const apy = { grossApyBp: 900, netApyBp: 720, protocolYieldShareBp: 2000, source: 'live' as const };
    expect(pillView(perks(0), apy)).toMatchObject({ tier: 0, label: '⚡ STAKE', apyText: '7.20% APY', sim: false });
    expect(pillView(perks(3), apy)).toMatchObject({ tier: 3, label: '⚡ TIER 3' });
    expect(pillView(perks(1), { ...apy, source: 'sim' }).sim).toBe(true);
    expect(pillView(null, apy).tier).toBe(0);
  });
  it('formatCountdown rounds up and never goes negative', () => {
    expect(formatCountdown(3 * 3_600_000 + 12 * 60_000)).toBe('3h 12m');
    expect(formatCountdown(45 * 60_000)).toBe('45m');
    expect(formatCountdown(1)).toBe('1m');
    expect(formatCountdown(0)).toBe('<1m');
    expect(formatCountdown(-5)).toBe('<1m');
  });
  it('fee pill: plain fee, warmup countdown to the tier fee, expired warmup', () => {
    const now = 1_000_000_000;
    expect(feePillView(perks(0), now).text).toBe('FEE 1.00%');
    const warm = feePillView(perks(2, { platformFeeBp: STAKING_TIERS[1]!.takerFeeBp, feeTier: 1, feeWarmupReadyAtMs: now + 3 * 3_600_000 }), now);
    expect(warm).toMatchObject({ text: 'FEE 0.65% → 0.50% in 3h 0m', warmup: true });
    expect(warm.title).toContain('0.65% / 0.50% / 0.35% / 0.25%');
    expect(feePillView(perks(2, { feeWarmupReadyAtMs: now - 1 }), now)).toMatchObject({ text: 'FEE 0.50%', warmup: false });
  });
  it('fetchPerks: none without ids, off on 404, error on 500 / junk / throw, ok otherwise; prefers accountId', async () => {
    expect((await fetchPerks(vi.fn() as unknown as PillFetch, {})).status).toBe('none');
    // a session token alone asks the server for the pilot's linked wallet (no query string)
    const tokenOnly = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }));
    expect((await fetchPerks(tokenOnly as unknown as PillFetch, { token: 'dev:w28' })).status).toBe('off');
    expect((tokenOnly.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe('/v1/near/staking/perks');
    expect((await fetchPerks(router(json(404, {})), { colonyId: 'c' })).status).toBe('off');
    expect((await fetchPerks(router(json(500, {})), { colonyId: 'c' })).status).toBe('error');
    expect((await fetchPerks(router(json(200, { nope: 1 })), { colonyId: 'c' })).status).toBe('error');
    expect((await fetchPerks(router(new Error('x')), { colonyId: 'c' })).status).toBe('error');
    const f = router(json(200, perksBody(perks(1))));
    expect((await fetchPerks(f, { accountId: 'a.near', colonyId: 'c' })).status).toBe('ok');
    expect(f.mock.calls[0]![0]).toBe('/v1/near/staking/perks?accountId=a.near');
  });
});

describe('StakingPill', () => {
  const mount = (f: PillFetch, onPerks?: (p: EvaluatedStakerPerksV2 | null) => void): StakingPill =>
    new StakingPill({ doFetch: f, query: () => ({ colonyId: 'c' }), onPerks });
  it('tier 0 shows the STAKE CTA with live APY and links to the dashboard', async () => {
    const pill = mount(router(json(200, perksBody(perks(0)))));
    await pill.refresh();
    expect(pill.el.hidden).toBe(false);
    expect(pill.el.getAttribute('href')).toBe('/me.html#staking');
    expect(pill.el.textContent).toBe('⚡ STAKE· 7.20% APY');
    expect(pill.el.querySelector('[data-testid="staking-pill-sim"]')).toBeNull();
  });
  it('tier 1-4 shows TIER N and a Sim badge when the APY is simulated', async () => {
    const pill = mount(router(json(200, perksBody(perks(4))), json(200, apyBody('sim'))));
    await pill.refresh();
    expect(pill.el.dataset.tier).toBe('4');
    expect(pill.el.textContent).toContain('⚡ TIER 4');
    expect(pill.el.querySelector('[data-testid="staking-pill-sim"]')?.textContent).toBe('Sim');
  });
  it('falls back to the simulated table APY when overview is missing', async () => {
    const pill = mount(router(json(200, perksBody(perks(1))), json(404, {})));
    await pill.refresh();
    expect(pill.el.querySelector('[data-testid="staking-pill-sim"]')).not.toBeNull();
    expect(pill.el.textContent).toContain('% APY');
  });
  it('stays hidden on 404 (W28 off), errors and without an identity, reporting null perks', async () => {
    for (const r of [json(404, {}), json(500, {}), new Error('x')]) {
      const seen = vi.fn();
      const pill = mount(router(r), seen);
      await pill.refresh();
      expect(pill.el.hidden).toBe(true);
      expect(seen).toHaveBeenLastCalledWith(null);
    }
    const none = new StakingPill({ doFetch: vi.fn() as unknown as PillFetch, query: () => ({}) });
    await none.refresh();
    expect(none.el.hidden).toBe(true);
  });
  it('re-hides after a previously visible pill gets a 404', async () => {
    let status = 200;
    const f = (async (url: string) => (url.includes('/perks') ? json(status, perksBody(perks(1))) : json(200, apyBody('live')))) as PillFetch;
    const pill = mount(f);
    await pill.refresh();
    expect(pill.el.hidden).toBe(false);
    status = 404;
    await pill.refresh();
    expect(pill.el.hidden).toBe(true);
  });
});

describe('FeePill', () => {
  it('hidden without perks, shows the fee and ticks the countdown', () => {
    let now = 0;
    const pill = new FeePill(() => now);
    pill.update(null);
    expect(pill.el.hidden).toBe(true);
    pill.update(perks(2, { platformFeeBp: 65, feeWarmupReadyAtMs: 2 * 3_600_000 }));
    expect(pill.el.textContent).toBe('FEE 0.65% → 0.50% in 2h 0m');
    now = 90 * 60_000;
    pill.update();
    expect(pill.el.textContent).toBe('FEE 0.65% → 0.50% in 30m');
    now = 3 * 3_600_000;
    pill.update();
    expect(pill.el.textContent).toBe('FEE 0.65%');
    expect(pill.el.dataset.warmup).toBe('false');
  });
});

describe('staking-hud feature fencing', () => {
  const mount = (flags: string[], host: 'server' | 'local'): HTMLElement => {
    const el = document.createElement('div');
    const inst = stakingHud.hud![0]!.mount(el, { flags: new Set(flags), host, services: { track: () => {} } });
    inst.dispose();
    return el;
  };
  it('is a server-only W28 feature; hides with W28 off or ?host=local without mounting a pill', () => {
    expect(stakingHud).toMatchObject({ id: 'staking-hud', wave: 'W28', hostOnly: 'server' });
    for (const [flags, host] of [[['W27'], 'server'], [['W28'], 'local']] as const) {
      const el = document.createElement('div');
      stakingHud.hud![0]!.mount(el, { flags: new Set(flags), host, services: { track: () => {} } });
      expect(el.hidden).toBe(true);
      expect(el.querySelector('[data-testid="staking-pill"]')).toBeNull();
    }
    expect(mount(['W28'], 'server').hidden).toBe(false);
  });
});
