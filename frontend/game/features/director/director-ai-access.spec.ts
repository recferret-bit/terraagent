// @vitest-environment jsdom
import { STAKING_RULES, STAKING_TIERS, type AiBudgetView } from '@terra/contracts';
import { describe, expect, it, vi } from 'vitest';
import { DirectorPanel } from './DirectorPanel';
import { fetchAiAccess } from './parts/aiAccessApi';
import { aiAccessState, modelLabel, stakeCtaHref } from './parts/aiAccessBadge';

const budget = (over: Partial<AiBudgetView> = {}): AiBudgetView => ({
  model: 'z-ai/glm-5.3-flash', mode: 'trial', dailyBudgetUsd: 0, dailyBudgetUsedUsd: 0, dailyCallLimit: 0, dailyCallsUsed: 0,
  tradeBonusCalls: 0, freeTrialTurnsRemaining: 5, freeTrialTurnsTotal: 5, trialEligible: true, colonySlotsUsed: 0, colonySlotsMax: 0, ...over,
});
const q = (host: HTMLElement, id: string): HTMLElement | null => host.querySelector(`[data-testid="${id}"]`);
const panelWith = (b: AiBudgetView | null): HTMLElement => {
  const host = document.createElement('div');
  new DirectorPanel(host).syncAiAccess(b);
  return host;
};

describe('aiAccessState', () => {
  it('maps the four modes and the legacy null', () => {
    expect(aiAccessState(null)).toEqual({ kind: 'legacy' });
    expect(aiAccessState(budget()).kind).toBe('trial');
    expect(aiAccessState(budget({ mode: 'byok' })).kind).toBe('byok');
    expect(aiAccessState(budget({ mode: 'tee', colonySlotsMax: STAKING_TIERS[3]!.aiColonySlots })))
      .toMatchObject({ kind: 'tee', tier: 3 });
  });
  it('script: trial complete only for an eligible wallet whose turns hit 0; guest never', () => {
    expect(aiAccessState(budget({ mode: 'script', freeTrialTurnsRemaining: 0 }))).toEqual({ kind: 'script', trialComplete: true, guest: false });
    expect(aiAccessState(budget({ mode: 'script', trialEligible: false, freeTrialTurnsRemaining: 0 }))).toEqual({ kind: 'script', trialComplete: false, guest: true });
    expect(aiAccessState(budget({ mode: 'script', freeTrialTurnsRemaining: 2 }))).toMatchObject({ trialComplete: false });
    expect(aiAccessState(budget({ mode: 'script', freeTrialTurnsTotal: 0, freeTrialTurnsRemaining: 0 }))).toMatchObject({ trialComplete: false });
  });
  it('formats the model and the CTA link from data rows', () => {
    expect(modelLabel('z-ai/glm-5.3-flash')).toBe('GLM-5.3-Flash');
    expect(stakeCtaHref()).toBe(`/me.html#staking?amount=${STAKING_TIERS[1]!.minStakeNear}`);
  });
});

describe('DirectorPanel AI access card', () => {
  it('trial steps 5 -> 0 turns with real TEE proof link, then Script AI + stake CTA', () => {
    for (const left of [5, 3, 1]) {
      const host = panelWith(budget({ freeTrialTurnsRemaining: left }));
      expect(q(host, 'director-ai-badge')?.textContent).toContain(`FREE TEE TRIAL (${left} / 5 TURNS LEFT · GLM-5.3-Flash)`);
      expect(q(host, 'director-ai-tee-proof')).not.toBeNull();
      expect(q(host, 'director-ai-cta')).toBeNull();
    }
    const done = panelWith(budget({ mode: 'script', freeTrialTurnsRemaining: 0, model: 'deterministic-policy' }));
    expect(q(done, 'director-ai-badge')?.textContent).toBe('SCRIPT AI (FREE)');
    const cta = q(done, 'director-ai-cta') as HTMLAnchorElement;
    expect(cta.textContent).toBe(`Trial Complete — Stake ${STAKING_TIERS[1]!.minStakeNear} NEAR → Keep NEAR.AI TEE Active`);
    expect(cta.getAttribute('href')).toBe('/me.html#staking?amount=10');
    expect(q(done, 'director-ai-tee-proof')).toBeNull();
  });
  it('tee: tier badge, budget meter, calls and slots', () => {
    const host = panelWith(budget({
      mode: 'tee', colonySlotsMax: STAKING_TIERS[1]!.aiColonySlots, colonySlotsUsed: 1, dailyBudgetUsd: 0.8, dailyBudgetUsedUsd: 0.2,
      dailyCallLimit: 18, dailyCallsUsed: 6, freeTrialTurnsRemaining: 0,
    }));
    expect(q(host, 'director-ai-badge')?.textContent).toContain('NEAR.AI TEE · TIER 1');
    expect(q(host, 'director-ai-meter')?.getAttribute('aria-valuenow')).toBe('0.2');
    expect((q(host, 'director-ai-meter')?.firstElementChild as HTMLElement).style.width).toBe('25%');
    expect(q(host, 'director-ai-stats')?.textContent).toBe('$0.2000 / $0.8000 today · 6/18 calls · slots 1/1');
    expect(q(host, 'director-ai-cta')).toBeNull();
  });
  it('tee corner: zero cap gives an empty meter, used above cap clamps to 100%', () => {
    const zero = panelWith(budget({ mode: 'tee', dailyBudgetUsd: 0, colonySlotsMax: 1 }));
    expect((q(zero, 'director-ai-meter')?.firstElementChild as HTMLElement).style.width).toBe('0%');
    const over = panelWith(budget({ mode: 'tee', dailyBudgetUsd: 1, dailyBudgetUsedUsd: 3, colonySlotsMax: 1 }));
    expect((q(over, 'director-ai-meter')?.firstElementChild as HTMLElement).style.width).toBe('100%');
  });
  it('byok and guest', () => {
    expect(q(panelWith(budget({ mode: 'byok' })), 'director-ai-badge')?.textContent).toBe('BYOK');
    const guest = panelWith(budget({ mode: 'script', trialEligible: false, freeTrialTurnsRemaining: 0 }));
    expect(q(guest, 'director-ai-badge')?.textContent).toBe('SCRIPT AI (FREE)');
    expect(q(guest, 'director-ai-guest-hint')?.textContent).toBe(`Sign in to unlock ${STAKING_RULES.freeTrialTurns} free TEE turns`);
    expect(q(guest, 'director-ai-cta')).toBeNull();
  });
  it('null (W28 off / 404) keeps the legacy plate and clears an earlier card', () => {
    const host = document.createElement('div');
    const panel = new DirectorPanel(host);
    expect((q(host, 'director-ai-access') as HTMLElement).hidden).toBe(true);
    panel.syncAiAccess(budget());
    expect((q(host, 'director-ai-access') as HTMLElement).hidden).toBe(false);
    panel.syncAiAccess(null);
    const card = q(host, 'director-ai-access') as HTMLElement;
    expect(card.hidden).toBe(true);
    expect(card.childElementCount).toBe(0);
  });
  it('the trial TEE link opens the proof modal for the active colony', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const panel = new DirectorPanel(host);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"attestations":[]}'));
    panel.syncAiAccess(budget());
    (q(host, 'director-ai-tee-proof') as HTMLButtonElement).click();
    expect(document.querySelector('[data-testid="tee-proof-modal"]')).not.toBeNull();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });
});

describe('fetchAiAccess', () => {
  const resp = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status });
  it('parses the budget and encodes the colony id', async () => {
    const f = vi.fn().mockResolvedValue(resp(200, { colonyId: 'c 1', aiBudget: budget() }));
    expect((await fetchAiAccess('c 1', f))?.mode).toBe('trial');
    expect(f.mock.calls[0]![0]).toBe('/v1/near/staking/ai-access?colonyId=c%201');
  });
  it('404, 500, malformed and network errors all resolve to null', async () => {
    expect(await fetchAiAccess('c', vi.fn().mockResolvedValue(resp(404, {})))).toBeNull();
    expect(await fetchAiAccess('c', vi.fn().mockResolvedValue(resp(500, {})))).toBeNull();
    expect(await fetchAiAccess('c', vi.fn().mockResolvedValue(resp(200, { aiBudget: { mode: 'nope' } })))).toBeNull();
    expect(await fetchAiAccess('c', vi.fn().mockRejectedValue(new Error('down')))).toBeNull();
  });
});
