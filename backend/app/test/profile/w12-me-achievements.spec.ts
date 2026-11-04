import 'reflect-metadata';
import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS,
  MeAchievementsResponseSchema,
  type PlayerAchievementEntry,
} from '@terra/contracts';
import { AuthTokenService } from '../../src/core/auth/auth-token.service.js';
import { CoreException, CoreUnauthorized } from '../../src/core/errors/index.js';
import { FlagsService } from '../../src/flags/flags.service.js';
import {
  MeAchievementsController,
  MeAchievementsService,
  nextAchievements,
  resolveMePlayer,
} from '../../src/profile/index.js';
import { AchievementUnlockStore } from '../../src/progression/achievement-unlock.store.js';
import { FactsStore } from '../../src/progression/facts.store.js';
import { FamilyAvailabilityService } from '../../src/progression/family-availability.js';

const JWT_SECRET = 'terra-test-jwt-secret-minimum-32-characters-long';

function makeReq(headers: Record<string, string> = {}, url = '/v1/me/achievements'): IncomingMessage {
  return { headers, url } as unknown as IncomingMessage;
}

function createService(waves = '..12'): {
  service: MeAchievementsService;
  facts: FactsStore;
  unlocks: AchievementUnlockStore;
} {
  const flags = new FlagsService({ TA_WAVES: waves } as never);
  const availability = new FamilyAvailabilityService(flags);
  const facts = new FactsStore();
  const unlocks = new AchievementUnlockStore();
  const service = new MeAchievementsService(facts, unlocks, availability, flags);
  return { service, facts, unlocks };
}

describe('resolveMePlayer authentication helper', () => {
  const flags = new FlagsService({ TA_WAVES: '..12' } as never);
  const tokens = new AuthTokenService(JWT_SECRET);

  it('authenticates a valid JWT bearer token as registered player', () => {
    const token = tokens.signAccessToken({ sub: 'pr_pilot_1', handle: 'topgun' });
    const req = makeReq({ authorization: `Bearer ${token}` });
    const resolved = resolveMePlayer(req, tokens, flags, false);
    expect(resolved).toEqual({ id: 'pr_pilot_1', handle: 'topgun', isGuest: false });
  });

  it('resolves dev:<name> bearer token in non-production as guest', () => {
    const req = makeReq({ authorization: 'Bearer dev:Alice' });
    const resolved = resolveMePlayer(req, tokens, flags, false);
    expect(resolved).toEqual({ id: 'pr_dev_alice', handle: 'alice', isGuest: true });
  });

  it('resolves ?as=<name> query parameter when bearer is missing in non-production', () => {
    const req = makeReq({}, '/v1/me/achievements?as=Bob_1');
    const resolved = resolveMePlayer(req, tokens, flags, false);
    expect(resolved).toEqual({ id: 'pr_dev_bob_1', handle: 'bob_1', isGuest: true });
  });

  it('refuses dev bearer tokens in production mode with CoreUnauthorized', () => {
    const req = makeReq({ authorization: 'Bearer dev:alice' });
    expect(() => resolveMePlayer(req, tokens, flags, true)).toThrow(CoreUnauthorized);
  });

  it('throws CoreUnauthorized when no authorization or as param is provided', () => {
    const req = makeReq({});
    expect(() => resolveMePlayer(req, tokens, flags, false)).toThrow(CoreUnauthorized);
  });

  it('throws wave_disabled CoreException when TA_WAVES excludes W12', () => {
    const offFlags = new FlagsService({ TA_WAVES: '..11' } as never);
    const req = makeReq({ authorization: 'Bearer dev:alice' });
    try {
      resolveMePlayer(req, tokens, offFlags, false);
      expect.unreachable('expected wave_disabled exception');
    } catch (e) {
      expect(e).toBeInstanceOf(CoreException);
      expect((e as CoreException).errorCode).toBe('wave_disabled');
      expect((e as CoreException).status).toBe(403);
    }
  });
});

describe('MeAchievementsService seeded player acceptance', () => {
  it('returns 60 entries in catalogue order with earnedAt and clamped progress', async () => {
    const { service, facts, unlocks } = createService('..12');
    const playerId = 'pr_seeded_pilot';

    await facts.setAll(playerId, {
      'first-landfall': 1,
      groundbreaker: 50,
      'stone-mason': 10000,
    });
    const earnedAt = new Date('2026-11-01T12:00:00Z');
    await unlocks.seedEarned(playerId, [
      {
        achievementId: 'first-landfall',
        earnedAt,
        nftStatus: 'minted',
        nftTokenId: 'token_123',
        nftTxHash: '0xabc123',
      },
    ]);

    const res = await service.getForPlayer(playerId);
    const validated = MeAchievementsResponseSchema.parse(res);

    expect(validated.totalCount).toBe(60);
    expect(validated.earnedCount).toBe(1);
    expect(validated.achievements).toHaveLength(60);
    expect(validated.achievements.map((a) => a.id)).toEqual(ACHIEVEMENTS.map((a) => a.id));

    const earned = validated.achievements.find((a) => a.id === 'first-landfall')!;
    expect(earned.status).toBe('earned');
    expect(earned.earnedAt).toBe(earnedAt.toISOString());
    expect(earned.progress).toEqual({ value: 1, target: 1 });
    expect(earned.nft).toEqual({ status: 'minted', tokenId: 'token_123', txHash: '0xabc123' });

    const partial = validated.achievements.find((a) => a.id === 'groundbreaker')!;
    expect(partial.status).toBe('locked');
    expect(partial.earnedAt).toBeNull();
    expect(partial.progress).toEqual({ value: 50, target: 100 });
    expect(partial.nft).toEqual({ status: 'none' });

    const clamped = validated.achievements.find((a) => a.id === 'stone-mason-3')!;
    expect(clamped.status).toBe('locked');
    expect(clamped.progress).toEqual({ value: 5000, target: 5000 });
  });
});

describe('MeAchievementsService wave flags and coming_soon status', () => {
  it('marks warlord, diplomat, merchant, and settler coming_soon with TA_WAVES=..12', async () => {
    const { service } = createService('..12');
    const res = await service.getForPlayer('pr_new_player');

    for (const familyId of ['warlord', 'diplomat', 'merchant', 'settler'] as const) {
      const familyTiers = res.achievements.filter((a) => a.familyId === familyId);
      expect(familyTiers).toHaveLength(3);
      for (const tier of familyTiers) {
        expect(tier.status).toBe('coming_soon');
        expect(tier.progress.value).toBe(0);
        expect(tier.progress.target).toBe(tier.threshold);
        expect(tier.earnedAt).toBeNull();
      }
    }
  });

  it('throws wave_disabled CoreException when TA_WAVES is ..11', async () => {
    const { service } = createService('..11');
    await expect(service.getForPlayer('pr_any')).rejects.toMatchObject({
      errorCode: 'wave_disabled',
      status: 403,
    });
  });
});

describe('nextAchievements selector helper', () => {
  function makeEntry(
    id: string,
    familyId: string,
    tier: 1 | 2 | 3,
    status: 'locked' | 'earned' | 'coming_soon',
    value: number,
    target: number,
  ): PlayerAchievementEntry {
    const base = ACHIEVEMENTS.find((a) => a.id === id)!;
    return {
      ...base,
      tier,
      status,
      progress: { value, target },
      earnedAt: status === 'earned' ? new Date().toISOString() : null,
      nft: { status: 'none' },
    };
  }

  it('selects lowest unearned tier per family sorted by ratio descending', () => {
    const entries: PlayerAchievementEntry[] = [
      makeEntry('first-landfall', 'first-landfall', 1, 'earned', 1, 1),
      makeEntry('first-landfall-2', 'first-landfall', 2, 'locked', 2, 3), // 0.667
      makeEntry('first-landfall-3', 'first-landfall', 3, 'locked', 2, 10), // skipped (higher tier)
      makeEntry('groundbreaker', 'groundbreaker', 1, 'locked', 80, 100), // 0.800
      makeEntry('stone-mason', 'stone-mason', 1, 'locked', 10, 100), // 0.100
      makeEntry('warlord', 'warlord', 1, 'coming_soon', 0, 10), // skipped (coming_soon)
    ];

    const top = nextAchievements(entries, 3);
    expect(top.map((e) => e.id)).toEqual(['groundbreaker', 'first-landfall-2', 'stone-mason']);
  });

  it('tie-breaks equal completion ratios by original catalogue order', () => {
    const entries: PlayerAchievementEntry[] = [
      makeEntry('first-landfall', 'first-landfall', 1, 'locked', 0, 1),
      makeEntry('groundbreaker', 'groundbreaker', 1, 'locked', 0, 100),
      makeEntry('stone-mason', 'stone-mason', 1, 'locked', 0, 50),
    ];
    const top = nextAchievements(entries, 2);
    expect(top.map((e) => e.id)).toEqual(['first-landfall', 'groundbreaker']);
  });
});

describe('MeAchievementsController endpoint invocation', () => {
  it('resolves request player and delegates to MeAchievementsService', async () => {
    const { service } = createService('..12');
    const flags = new FlagsService({ TA_WAVES: '..12' } as never);
    const tokens = new AuthTokenService(JWT_SECRET);
    const controller = new MeAchievementsController(service, tokens, flags);

    const req = makeReq({ authorization: 'Bearer dev:explorer' });
    const response = await controller.achievements(req);

    expect(response.totalCount).toBe(60);
    expect(response.achievements).toHaveLength(60);
  });
});
