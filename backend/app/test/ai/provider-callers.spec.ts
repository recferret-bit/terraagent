import { describe, expect, it, vi } from 'vitest';
import { EconomySimService } from '../../src/ai/economy-sim/economy-sim.service.js';
import { GuardedLlmProvider } from '../../src/ai/provider/guarded-llm.js';
import { ProviderHealth } from '../../src/ai/provider/provider-health.js';
import { FlagsService } from '../../src/flags/flags.service.js';
import { DeterministicGuildStrategy } from '../../src/market/guild/strategy/deterministic.js';
import { LlmGuildStrategy } from '../../src/market/guild/strategy/llm.js';
import { LlmProviderError, LlmProviderUnavailableError, type LlmProviderPort } from '../../src/ports/llm-provider.port.js';
import { ColonyHistoryStore } from '../../src/profile/colony-history.store.js';
import { MeAchievementsService } from '../../src/profile/me-achievements.service.js';
import { MeProfileService } from '../../src/profile/me-profile.service.js';
import type { PlayerAiSettingsStore } from '../../src/profile/player-ai-settings.store.js';
import { AchievementUnlockStore } from '../../src/progression/achievement-unlock.store.js';
import { FactsStore } from '../../src/progression/facts.store.js';
import { FamilyAvailabilityService } from '../../src/progression/family-availability.js';
import { XpStore } from '../../src/progression/xp.store.js';

const failing = (err: Error): LlmProviderPort => ({ complete: vi.fn(async () => Promise.reject(err)) });
const unfunded = (): LlmProviderError => new LlmProviderError('unfunded', 'NEAR AI Cloud HTTP 402', 402, 'no_credits');

function profileWith(llm: LlmProviderPort, apiKey: string | null) {
  const flags = new FlagsService({ TA_WAVES: 'all' } as never);
  const facts = new FactsStore();
  const unlocks = new AchievementUnlockStore();
  const achievements = new MeAchievementsService(facts, unlocks, new FamilyAvailabilityService(flags), flags);
  const aiSettings = { getCredentials: async () => ({ apiKey, model: 'z-ai/glm-5.3-flash' }) } as unknown as PlayerAiSettingsStore;
  return new MeProfileService(facts, new XpStore(), achievements, new ColonyHistoryStore(), flags, undefined, undefined, undefined, aiSettings, llm, {
    AI_PROVIDER: 'nearai',
  } as never);
}

describe('every LLM caller handles an unavailable provider', () => {
  it('/me TEE probe with a drained BYOK key tells the player instead of failing', async () => {
    const res = await profileWith(failing(unfunded()), 'sk-drained').verifyAiEnclave('p1');
    expect(res).toMatchObject({ ok: false, usedPlayerKey: true, attestation: null, providerFailure: 'unfunded' });
    expect(res.message).toContain('Your NEAR.AI key has no balance');
    expect(JSON.stringify(res)).not.toContain('sk-drained');
  });

  it('/me TEE probe through an open circuit makes no call and reports it', async () => {
    const health = new ProviderHealth({ failuresToOpen: 5, openMs: 60_000 });
    health.settle('sk-drained', unfunded());
    const inner = { complete: vi.fn() };
    const res = await profileWith(new GuardedLlmProvider(inner as unknown as LlmProviderPort, health), 'sk-drained').verifyAiEnclave('p1');
    expect(inner.complete).not.toHaveBeenCalled();
    expect(res.providerFailure).toBe('unfunded');
  });

  it('/me TEE probe still surfaces a non-provider bug', async () => {
    await expect(profileWith(failing(new Error('boom')), 'sk-x').verifyAiEnclave('p1')).rejects.toThrow('boom');
  });

  it('guild strategy falls back to the deterministic choice and retries the LLM next time', async () => {
    const llm = failing(new LlmProviderUnavailableError('unfunded', 'protocol', 0));
    const strat = new LlmGuildStrategy(llm, true);
    const npc = { id: 'kestrel' };
    const expected = await new DeterministicGuildStrategy().choose(npc, { nowMs: 0 });
    expect(await strat.choose(npc, { nowMs: 0 })).toEqual(expected);
    expect(await strat.choose(npc, { nowMs: 1 })).toEqual(expected);
    expect(llm.complete).toHaveBeenCalledTimes(2);
  });

  it('economy sim keeps the deterministic summary and names the failure', async () => {
    const report = await new EconomySimService(failing(unfunded())).run({ seed: 's', days: 1 });
    expect(report.ai.providerModel).toBe('deterministic-policy');
    expect(report.ai.providerFailure).toBe('unfunded');
    expect(report.ai.summary.length).toBeGreaterThan(0);
  });
});
