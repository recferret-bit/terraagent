// @vitest-environment jsdom
import { AiBudgetView } from '@terra/contracts';
import { describe, expect, it, vi } from 'vitest';
import { DirectorPanel } from './DirectorPanel';
import { fetchAiAccess } from './parts/aiAccessApi';
import { aiAccessState } from './parts/aiAccessBadge';

const budget = (over: Partial<AiBudgetView> = {}): AiBudgetView => ({
  model: 'deterministic-policy', mode: 'script', dailyBudgetUsd: 0, dailyBudgetUsedUsd: 0, dailyCallLimit: 0, dailyCallsUsed: 0,
  tradeBonusCalls: 0, freeTrialTurnsRemaining: 5, freeTrialTurnsTotal: 5, trialEligible: true, colonySlotsUsed: 0, colonySlotsMax: 0, ...over,
});
const q = (host: HTMLElement, id: string): HTMLElement | null => host.querySelector(`[data-testid="${id}"]`);
const panelWith = (b: AiBudgetView | null): HTMLElement => {
  const host = document.createElement('div');
  new DirectorPanel(host).syncAiAccess(b);
  return host;
};

describe('Director AI access card: provider fallback', () => {
  it('maps provider_* reasons; other reasons leave the old states unchanged', () => {
    expect(aiAccessState(budget({ downshiftReason: 'provider_unavailable' }))).toMatchObject({ kind: 'script', provider: 'unavailable' });
    expect(aiAccessState(budget({ mode: 'byok', downshiftReason: 'provider_unfunded' }))).toEqual({ kind: 'byok', provider: 'unfunded' });
    expect(aiAccessState(budget({ downshiftReason: 'slot_cap' }))).not.toHaveProperty('provider');
    expect(aiAccessState(budget({ mode: 'byok' }))).toEqual({ kind: 'byok' });
  });

  it('managed colony with the provider down: "Autopilot: rules (AI provider unavailable)", no stake CTA', () => {
    for (const reason of ['provider_unfunded', 'provider_unavailable', 'provider_unauthorized'] as const) {
      const host = panelWith(budget({ downshiftReason: reason, freeTrialTurnsRemaining: 0 }));
      expect(q(host, 'director-ai-badge')?.textContent).toBe('AUTOPILOT: RULES (AI PROVIDER UNAVAILABLE)');
      expect(q(host, 'director-ai-cta')).toBeNull();
      expect((q(host, 'director-ai-access') as HTMLElement).dataset.provider).toBeDefined();
    }
  });

  it('a drained BYOK key tells the player, and recovers when the key works again', () => {
    const host = document.createElement('div');
    const panel = new DirectorPanel(host);
    panel.syncAiAccess(budget({ mode: 'byok', model: 'byok', downshiftReason: 'provider_unfunded' }));
    expect(q(host, 'director-ai-badge')?.textContent).toBe('BYOK · AUTOPILOT: RULES');
    expect(q(host, 'director-ai-provider-hint')?.textContent).toBe('Your NEAR.AI key has no balance. Autopilot runs on rules until you top it up.');
    panel.syncAiAccess(budget({ mode: 'byok', model: 'byok', downshiftReason: 'provider_unauthorized' }));
    expect(q(host, 'director-ai-provider-hint')?.textContent).toContain('was rejected');
    panel.syncAiAccess(budget({ mode: 'byok', model: 'byok' }));
    expect(q(host, 'director-ai-badge')?.textContent).toBe('BYOK');
    expect(q(host, 'director-ai-provider-hint')).toBeNull();
    expect((q(host, 'director-ai-access') as HTMLElement).dataset.provider).toBeUndefined();
  });

  it('fetchAiAccess accepts the new downshiftReason and still rejects an unknown one', async () => {
    const ok = vi.fn().mockResolvedValue(new Response(JSON.stringify({ colonyId: 'c', aiBudget: budget({ downshiftReason: 'provider_unfunded' }) })));
    expect((await fetchAiAccess('c', ok))?.downshiftReason).toBe('provider_unfunded');
    const bad = vi.fn().mockResolvedValue(new Response(JSON.stringify({ colonyId: 'c', aiBudget: { ...budget(), downshiftReason: 'nope' } })));
    expect(await fetchAiAccess('c', bad)).toBeNull();
  });
});
