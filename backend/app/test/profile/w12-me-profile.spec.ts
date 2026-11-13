import { describe, expect, it } from 'vitest';
import { MeProfileResponseSchema } from '@terra/contracts';
import { AuthTokenService, DEV_JWT_SECRET } from '../../src/core/auth/auth-token.service.js';
import { FlagsService } from '../../src/flags/flags.service.js';
import { ColonyHistoryStore } from '../../src/profile/colony-history.store.js';
import { MeAchievementsService } from '../../src/profile/me-achievements.service.js';
import { MeProfileController } from '../../src/profile/me-profile.controller.js';
import { MeProfileService } from '../../src/profile/me-profile.service.js';
import { openPlayerApiKey, sealPlayerApiKey } from '../../src/profile/player-ai-settings.store.js';
import { AchievementUnlockStore } from '../../src/progression/achievement-unlock.store.js';
import { FactsStore } from '../../src/progression/facts.store.js';
import { FamilyAvailabilityService } from '../../src/progression/family-availability.js';
import { W12SeedService } from '../../src/progression/w12-seed.service.js';
import { XpStore } from '../../src/progression/xp.store.js';

function createProfileStack(waves = 'all') {
  const flags = new FlagsService({ TA_WAVES: waves } as never);
  const facts = new FactsStore();
  const unlocks = new AchievementUnlockStore();
  const xp = new XpStore();
  const colonies = new ColonyHistoryStore();
  const availability = new FamilyAvailabilityService(flags);
  const seed = new W12SeedService(facts, unlocks, xp);
  const achievements = new MeAchievementsService(facts, unlocks, availability, flags);
  const profile = new MeProfileService(facts, xp, achievements, colonies, flags, seed);
  const tokens = new AuthTokenService(DEV_JWT_SECRET);
  const controller = new MeProfileController(profile, tokens, flags, { NODE_ENV: 'development' } as never, seed);
  return { flags, facts, unlocks, xp, colonies, seed, achievements, profile, controller };
}

describe('W12-09 MeProfileService seeded scenario pilot acceptance', () => {
  it('populates identity, Level 4 Surveyor (1120/1500), unlockStage 4, 16 stats, colonies and 3 closest achievements within 150ms', async () => {
    const { seed, profile } = createProfileStack('all');
    await seed.seedPilot('pr_dev_w12');

    const t0 = performance.now();
    const res = await profile.getForPlayer({ id: 'pr_dev_w12', handle: 'w12', isGuest: true });
    const elapsedMs = performance.now() - t0;

    expect(elapsedMs).toBeLessThan(150);
    expect(MeProfileResponseSchema.parse(res)).toEqual(res);

    expect(res.identity.playerId).toBe('pr_dev_w12');
    expect(res.identity.accountId).toBe('w12.terraagent.mock');
    expect(res.progression.level).toBe(4);
    expect(res.progression.xp).toBe(1120);
    expect(res.progression.currentLevelXp).toBe(1000);
    expect(res.progression.nextLevelXp).toBe(1500);
    expect(res.progression.title).toBe('Surveyor');
    expect(res.progression.unlockStage).toBe(4);

    expect(res.earnedAchievementsCount).toBe(9);
    expect(res.totalAchievementsCount).toBe(60);
    expect(res.nextAchievements).toHaveLength(3);
    expect(res.nextAchievements[0]?.id).toBe('groundbreaker-2');
    expect(res.currentColonies).toHaveLength(1);
    expect(res.pastColonies).toHaveLength(2);
    expect(Object.keys(res.stats)).toHaveLength(16);
    expect(res.stats.tilesGraded).toBe(800);
  });
});

describe('W12-09 MeProfileController and wave gating', () => {
  it('hides settled past colonies when W21 is off and throws wave_disabled when W12 is off', async () => {
    const stack12 = createProfileStack('..12');
    const res12 = await stack12.controller.profile({
      url: '/v1/me/profile?as=w12',
      headers: {},
    } as never);
    expect(res12.pastColonies).toHaveLength(1);
    expect(res12.pastColonies[0]?.outcome).toBe('eliminated');

    const stack11 = createProfileStack('..11');
    await expect(
      stack11.controller.profile({ url: '/v1/me/profile?as=w12', headers: {} } as never),
    ).rejects.toMatchObject({ errorCode: 'wave_disabled', status: 403 });
  });

  it('persists player NEAR.AI API key and selected model via /v1/me/ai-settings and masks key in profile', async () => {
    const stack = createProfileStack('all');
    const req = { url: '/v1/me/ai-settings?as=w12', headers: {} } as never;

    const initial = await stack.controller.getAiSettings(req);
    expect(initial.hasApiKey).toBe(false);
    expect(initial.apiKeyPreview).toBeNull();
    expect(initial.model).toBe('z-ai/glm-5.3-flash');
    expect(initial.availableModels).toContain('z-ai/glm-5.3-flash');
    expect(initial.availableModels).toContain('z-ai/glm-5.3');

    const saved = await stack.controller.putAiSettings(req, {
      apiKey: 'sk-nearai-secret-key-9876',
      model: 'glm-5',
    });
    expect(saved.hasApiKey).toBe(true);
    expect(saved.apiKeyPreview).toBe('sk-n••••9876');
    expect(saved.model).toBe('z-ai/glm-5.3');

    // Changing model without re-sending apiKey preserves the stored key
    const modelUpdated = await stack.controller.putAiSettings(req, {
      model: 'deepseek/deepseek-v3.2',
    });
    expect(modelUpdated.hasApiKey).toBe(true);
    expect(modelUpdated.apiKeyPreview).toBe('sk-n••••9876');
    expect(modelUpdated.model).toBe('deepseek/deepseek-v3.2');

    // Profile GET includes masked aiSettings and never leaks raw key
    const prof = await stack.controller.profile({ url: '/v1/me/profile?as=w12', headers: {} } as never);
    expect(prof.aiSettings?.hasApiKey).toBe(true);
    expect(prof.aiSettings?.apiKeyPreview).toBe('sk-n••••9876');
    expect(JSON.stringify(prof)).not.toContain('sk-nearai-secret-key-9876');

    // Envelope encryption seals the key under AES-256-GCM and round-trips cleanly
    const sealed = sealPlayerApiKey('sk-nearai-secret-key-9876');
    expect(sealed?.startsWith('enc:v1:1:')).toBe(true);
    expect(sealed).not.toContain('sk-nearai-secret-key-9876');
    expect(openPlayerApiKey(sealed)).toBe('sk-nearai-secret-key-9876');

    // Internal store credentials return the decrypted key for ColonyAgentLoopService
    const creds = await stack.profile.getAiSettingsStore().getCredentials('pr_dev_w12');
    expect(creds).toEqual({
      apiKey: 'sk-nearai-secret-key-9876',
      model: 'deepseek/deepseek-v3.2',
    });

    // Clearing key via DELETE /v1/me/ai-settings sets hasApiKey=false while preserving model
    const deleted = await stack.controller.deleteAiSettings(req);
    expect(deleted.hasApiKey).toBe(false);
    expect(deleted.apiKeyPreview).toBeNull();
    expect(deleted.model).toBe('deepseek/deepseek-v3.2');

    // Clearing key via PUT null also sets hasApiKey=false
    const cleared = await stack.controller.putAiSettings(req, {
      apiKey: null,
      model: 'z-ai/glm-5.3',
    });
    expect(cleared.hasApiKey).toBe(false);
    expect(cleared.apiKeyPreview).toBeNull();
  });
});
