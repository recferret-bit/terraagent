import { generateKeyPairSync, randomBytes } from 'node:crypto';
import type { PrismaClient } from '@terra/db';
import type { IncomingMessage } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { type AuthTokenService } from '../../src/core/auth/index.js';
import { AiAccessController } from '../../src/ai/colony-agent/ai-access.controller.js';
import { PublicEconomySimController } from '../../src/dev/economy-sim.controller.js';
import { FlagsService } from '../../src/flags/flags.service.js';
import { GuildRadarController } from '../../src/market/guild/visit/guild-radar.controller.js';
import { BountyController } from '../../src/near/bounty/bounty.controller.js';
import { NearDeedController } from '../../src/near/deed/deed.controller.js';
import { assertColonyOwnership } from '../../src/near/identity/colony-ownership.guard.js';
import { consumeNep413NoncePersistent, signNep413Message } from '../../src/near/identity/nep413-verifier.js';
import { RelayStatusService } from '../../src/near/identity/relay-status.service.js';
import { resolveNearNetworkConfig } from '../../src/near/infrastructure/network/near-network.config.js';
import { NearRpcClient } from '../../src/near/infrastructure/rpc/near-rpc.client.js';
import { encodeBase58 } from '../../src/near/keystore/base58.js';
import { AccountClaimService } from '../../src/near/staking/account-claim.service.js';
import { StakingPerformanceService } from '../../src/near/staking/performance/staking-performance.service.js';
import { NearUsdPriceService } from '../../src/near/staking/performance/near-usd-price.service.js';
import { StakingPerksService } from '../../src/near/staking/perks/staking-perks.service.js';
import { resolveDbStakerPerks } from '../../src/near/staking/staker-perks.js';
import { StakingController } from '../../src/near/staking/staking.controller.js';

function reqWithBearer(bearer: string | null, ip = '10.0.0.1'): IncomingMessage {
  return {
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
    socket: { remoteAddress: ip },
  } as unknown as IncomingMessage;
}

const mockTokens = {
  verifyAccessToken: (token: string) => {
    if (!token.startsWith('dev:')) throw new Error('unauthorized');
    const id = `pr_${token.slice(4)}`;
    return { playerId: id, sub: id, handle: token.slice(4), isGuest: false };
  },
} as unknown as AuthTokenService;

describe('Endpoint ownership IDOR & strict listing enforcement', () => {
  it('blocks cross-player IDOR on BountyController and NearDeedController settle, and suppresses unauthenticated deed dumps', async () => {
    const flags = new FlagsService({ TA_WAVES: 'all' } as never);
    const strictEnv = { NODE_ENV: 'production', NEAR_ADAPTER_ESCROW: 'testnet', NEAR_ADAPTER_DEED: 'testnet' } as never;
    const prisma = {
      colony: {
        findUnique: vi.fn(async () => ({ id: 'col_1', playerId: 'pr_owner' })),
      },
      nearColonyAccount: {
        findFirst: vi.fn(async () => null),
      },
    } as unknown as PrismaClient;

    const bountyCtrl = new BountyController(
      { post: vi.fn(), list: vi.fn() } as never,
      { claim: vi.fn() } as never,
      flags,
      prisma,
      mockTokens,
      strictEnv,
    );
    await expect(
      bountyCtrl.post(
        'pl_1',
        {
          colonyId: 'col_1',
          colonyIndex: 0,
          playerId: 'pr_owner',
          target: { kind: 'clear_nest', nestId: 'nest_1' },
          reward: { resource: 'metals.t1', amount: 50 },
          expiresAt: Date.now() + 3_600_000,
        },
        reqWithBearer('dev:attacker'),
      ),
    ).rejects.toMatchObject({ errorCode: 'NEAR_NOT_OWNER' });

    // Omitting playerId in body must STILL reject via prisma.colony.findUnique fallback
    await expect(
      bountyCtrl.post(
        'pl_1',
        {
          colonyId: 'col_1',
          colonyIndex: 0,
          target: { kind: 'clear_nest', nestId: 'nest_1' },
          reward: { resource: 'metals.t1', amount: 50 },
          expiresAt: Date.now() + 3_600_000,
        },
        reqWithBearer('dev:attacker'),
      ),
    ).rejects.toMatchObject({ errorCode: 'NEAR_NOT_OWNER' });

    const deedsRepo = {
      findByColonyId: vi.fn(async () => ({ colonyId: 'col_1', playerId: 'pr_owner' })),
      listForPlayerOrColony: vi.fn(async () => []),
      listAll: vi.fn(async () => [{ colonyId: 'col_1' }]),
    };
    const mintForColony = vi.fn();
    const deedCtrl = new NearDeedController(
      flags,
      deedsRepo as never,
      { mintForColony } as never,
      { flushReady: vi.fn() } as never,
      {} as never,
      {} as never,
      mockTokens,
      { isLoaded: () => true, loadedIds: () => ['pl_1'] } as never,
      undefined,
      undefined,
      strictEnv,
    );
    await expect(deedCtrl.settleDeed({ colonyId: 'col_1' }, reqWithBearer('dev:attacker'))).rejects.toMatchObject({
      errorCode: 'NEAR_NOT_OWNER',
    });

    // Unauthenticated POST /v1/near/deed/settle in strict mode rejects with 401 before touching DeedRepository
    deedsRepo.findByColonyId.mockClear();
    deedsRepo.listForPlayerOrColony.mockClear();
    await expect(deedCtrl.settleDeed({ colonyId: 'col_1', planetId: 'pl_wrong' }, reqWithBearer(null))).rejects.toMatchObject({
      errorCode: 'NEAR_NOT_OWNER',
      status: 401,
    });
    expect(deedsRepo.findByColonyId).not.toHaveBeenCalled();
    expect(deedsRepo.listForPlayerOrColony).not.toHaveBeenCalled();

    const listOut = await deedCtrl.getOwnDeeds(reqWithBearer(null));
    expect(listOut.deed).toBeNull();
    expect(listOut.deeds).toEqual([]);
    expect(deedsRepo.listAll).not.toHaveBeenCalled();

    // Unauthenticated GET /v1/near/deed?colonyId=col_missing in strict mode must not auto-mint a deed
    deedsRepo.findByColonyId.mockResolvedValueOnce(null as never);
    const missingOut = await deedCtrl.getOwnDeeds(reqWithBearer(null), 'col_missing', 'pl_1');
    expect(missingOut.deed).toBeNull();
    expect(missingOut.deeds).toEqual([]);
    expect(mintForColony).not.toHaveBeenCalled();
  });
});

describe('StakingController IDOR & offline real-PrismaClient guard', () => {
  it('blocks cross-player IDOR on StakingController and skips DB calls on un-migrated offline PrismaClient across Staking, Perks, Performance, AiAccess, and AccountClaim', async () => {
    const flags = new FlagsService({ TA_WAVES: 'all' } as never);
    const stakingCtrl = new StakingController(
      {
        resolveColonyOwnerPlayerId: vi.fn(async () => 'pr_owner'),
        stake: vi.fn(),
        unstake: vi.fn(),
        withdraw: vi.fn(),
        getStatus: vi.fn(async () => ({ ok: true })),
      } as never,
      flags,
      mockTokens,
      { NODE_ENV: 'test' } as never,
    );
    await expect(
      stakingCtrl.unstake(
        { colonyId: 'col_1', pool: 'astro-stakers.poolv1.near', amount: '5' },
        undefined,
        'Bearer dev:attacker',
        undefined,
        reqWithBearer('dev:attacker'),
      ),
    ).rejects.toMatchObject({ errorCode: 'NEAR_NOT_OWNER' });

    const realShapePrisma = {
      $connect: vi.fn(),
      nearColonyAccount: { findFirst: vi.fn(async () => { throw new Error('DB unreachable'); }) },
      colony: {
        findUnique: vi.fn(async () => { throw new Error('DB unreachable'); }),
        findFirst: vi.fn(async () => { throw new Error('DB unreachable'); }),
        findMany: vi.fn(async () => { throw new Error('DB unreachable'); }),
      },
      player: { findUnique: vi.fn(async () => { throw new Error('DB unreachable'); }) },
      socialIdentity: { findFirst: vi.fn(async () => { throw new Error('DB unreachable'); }) },
    } as unknown as PrismaClient;
    await expect(
      assertColonyOwnership({
        req: reqWithBearer('dev:owner'),
        tokens: mockTokens,
        env: { NODE_ENV: 'test' } as never,
        prisma: realShapePrisma,
        port: 'Escrow',
        colonyId: 'col_offline',
      }),
    ).resolves.toMatch(/^pr_/);

    // AiAccessController, StakingPerksService, and StakingPerformanceService skip real PrismaClient under NODE_ENV=test without DATABASE_URL
    const aiCtrl = new AiAccessController(flags, realShapePrisma, { NODE_ENV: 'test' } as never);
    const aiOut = await aiCtrl.aiAccess('col_0', 'pl_1', '0');
    expect(aiOut.colonyId).toBe('col_0');
    expect(realShapePrisma.colony.findUnique).not.toHaveBeenCalled();

    const perksSvc = new StakingPerksService(flags, realShapePrisma, { NODE_ENV: 'test' } as never);
    const perksOut = await perksSvc.perksFor({ accountId: 'pilot.testnet', playerId: 'pr_1' });
    expect(perksOut.perks.tier).toBe(0);
    const prestigeOut = await perksSvc.prestigeFor('pl_1');
    expect(prestigeOut.colonies).toEqual([]);

    const perfSvc = new StakingPerformanceService(
      flags,
      new NearUsdPriceService({ NODE_ENV: 'test', NEAR_MODE: 'mock' } as never),
      realShapePrisma,
      { NODE_ENV: 'test', NEAR_MODE: 'mock' } as never,
    );
    const ov = await perfSvc.overview('100');
    expect(ov.network).toBe('mock');
    const perf = await perfSvc.performance('pilot.testnet', '30d');
    expect(perf.accountId).toBe('pilot.testnet');

    const radarCtrl = new GuildRadarController(
      { upcoming: () => ({ nowMs: 1_000, windows: [] }) } as never,
      flags,
      realShapePrisma,
      { NODE_ENV: 'test' } as never,
    );
    const radarOut = await radarCtrl.radar('pl_1', 'col_0', '0');
    expect(radarOut.leadMs).toBe(0);
    expect(realShapePrisma.colony.findUnique).not.toHaveBeenCalled();
    const dbPerks = await resolveDbStakerPerks(realShapePrisma, {
      colonyId: 'col_0',
      env: { NODE_ENV: 'test' },
      w28: true,
    });
    expect(dbPerks.tier).toBe(0);
  });
});

describe('Strict unauthenticated rejection before DB / NEAR access', () => {
  it('rejects unauthenticated AccountClaimService and assertColonyOwnership in strict mode with 401 before touching PrismaClient or IdentityPort', async () => {
    const flags = new FlagsService({ TA_WAVES: 'all' } as never);
    const realShapePrisma = {
      $connect: vi.fn(),
      nearColonyAccount: { findFirst: vi.fn(async () => { throw new Error('DB unreachable'); }) },
      colony: { findUnique: vi.fn(async () => { throw new Error('DB unreachable'); }) },
    } as unknown as PrismaClient;

    await expect(
      assertColonyOwnership({
        req: reqWithBearer(null),
        tokens: mockTokens,
        env: { NODE_ENV: 'production', DATABASE_URL: 'postgresql://localhost/test' } as never,
        prisma: realShapePrisma,
        port: 'Escrow',
        colonyId: 'col_1',
      }),
    ).rejects.toMatchObject({ errorCode: 'NEAR_NOT_OWNER', status: 401 });
    expect(realShapePrisma.nearColonyAccount.findFirst).not.toHaveBeenCalled();
    expect(realShapePrisma.colony.findUnique).not.toHaveBeenCalled();

    // AccountClaimService in production / real network mode rejects unauthenticated claim even when no DB row exists yet
    const claimAccount = vi.fn();
    const emptyPrisma = {
      nearColonyAccount: { findUnique: vi.fn(async () => null), findFirst: vi.fn(async () => null), upsert: vi.fn() },
      deed: { findUnique: vi.fn(async () => null) },
      player: { findUnique: vi.fn(async () => null), create: vi.fn() },
      mockChainAccount: { upsert: vi.fn() },
    } as unknown as PrismaClient;
    const strictClaimSvc = new AccountClaimService(
      flags,
      { claimAccount } as never,
      { NODE_ENV: 'production', DATABASE_URL: 'postgresql://localhost/test' } as never,
      emptyPrisma,
    );
    await expect(
      strictClaimSvc.claimColonyAccount({
        colonyId: 'col_new',
        walletAccountId: 'pilot.testnet',
        newPublicKey: 'ed25519:11111111111111111111111111111111',
      }),
    ).rejects.toMatchObject({ errorCode: 'NEAR_NOT_OWNER', status: 401 });
    expect(emptyPrisma.player.create).not.toHaveBeenCalled();
    expect(emptyPrisma.nearColonyAccount.upsert).not.toHaveBeenCalled();
    expect(claimAccount).not.toHaveBeenCalled();
  });
});

describe('Production dev_pilot ownership lock', () => {
  it('blocks taking over dev_pilot-owned colonies when NODE_ENV=production', async () => {
    const flags = new FlagsService({ TA_WAVES: 'all' } as never);
    const strictEnv = { NODE_ENV: 'production', NEAR_ADAPTER_ESCROW: 'testnet' } as never;
    const devPilotPrisma = {
      colony: { findUnique: vi.fn(async () => ({ id: 'col_dev', playerId: 'dev_pilot' })) },
      nearColonyAccount: { findFirst: vi.fn(async () => null) },
    } as unknown as PrismaClient;
    const prodBounty = new BountyController(
      { post: vi.fn(), list: vi.fn() } as never,
      { claim: vi.fn() } as never,
      flags,
      devPilotPrisma,
      mockTokens,
      strictEnv,
    );
    await expect(
      prodBounty.post(
        'pl_1',
        {
          colonyId: 'col_dev',
          colonyIndex: 0,
          target: { kind: 'clear_nest', nestId: 'nest_1' },
          reward: { resource: 'metals.t1', amount: 50 },
          expiresAt: Date.now() + 3_600_000,
        },
        reqWithBearer('dev:attacker'),
      ),
    ).rejects.toMatchObject({ errorCode: 'NEAR_NOT_OWNER' });
  });
});

describe('Public economy-sim quota guard & gasless relay auth/rate defense', () => {
  it('forces useLiveLlm=false for unauthenticated PublicEconomySimController calls and rate-limits bursts', async () => {
    const seen: boolean[] = [];
    const simSvc = {
      getLatest: vi.fn(),
      run: vi.fn(async (body: { useLiveLlm?: boolean }) => {
        seen.push(Boolean(body.useLiveLlm));
        return { ok: true };
      }),
    };
    const ctrl = new PublicEconomySimController(simSvc as never, mockTokens, { NODE_ENV: 'test' } as never);
    await ctrl.run({ days: 2, useLiveLlm: true }, reqWithBearer(null, '192.0.2.50'));
    await ctrl.run({ days: 2, useLiveLlm: true }, reqWithBearer(null, '192.0.2.50'));
    await ctrl.run({ days: 2, useLiveLlm: true }, reqWithBearer(null, '192.0.2.50'));
    expect(seen).toEqual([false, false, false]);
    expect(() => ctrl.run({ days: 2 }, reqWithBearer(null, '192.0.2.50'))).toThrow(/Too many public/i);
  });

  it('enforces auth & ownership on POST /v1/near/relay', async () => {
    const relaySvc = new RelayStatusService(
      new FlagsService({ TA_WAVES: 'all' } as never),
      mockTokens,
      {} as never,
      { nearColonyAccount: { findFirst: vi.fn(async () => null) } } as unknown as PrismaClient,
      { submitMetaTx: vi.fn() } as never,
    );
    await expect(
      relaySvc.submitMetaTx(reqWithBearer(null), { signerId: 'alice.testnet', receiverId: 'res.terraagent.testnet', signedDelegate: 'AAAA' }),
    ).rejects.toThrow();
    await expect(
      relaySvc.submitMetaTx(reqWithBearer('dev:other'), {
        signerId: 'alice.testnet',
        receiverId: 'res.terraagent.testnet',
        signedDelegate: Buffer.from('0123456789').toString('base64'),
      }),
    ).rejects.toMatchObject({ errorCode: 'NEAR_NOT_OWNER' });
  });
});

describe('Persistent NEP-413 replay guard & shared relayer budget', () => {
  it('blocks NEP-413 nonce replay across fresh instances backed by Db nep413UsedNonce table', async () => {
    const used = new Set<string>();
    const fakePrisma = {
      nep413UsedNonce: {
        create: vi.fn(async ({ data }: { data: { nonceKey: string } }) => {
          if (used.has(data.nonceKey)) {
            throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
          }
          used.add(data.nonceKey);
          return data;
        }),
      },
    } as unknown as PrismaClient;

    const kp = generateKeyPairSync('ed25519');
    const pub = `ed25519:${encodeBase58(kp.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32))}`;
    const nonce = randomBytes(32).toString('base64');
    const sig = signNep413Message({
      privateKey: kp.privateKey,
      publicKey: pub,
      accountId: 'pilot.testnet',
      message: 'stake:col_0',
      nonceBase64: nonce,
      recipient: 'staking.terraagent.testnet',
    });
    await consumeNep413NoncePersistent(fakePrisma, sig, 'staking');
    await expect(consumeNep413NoncePersistent(fakePrisma, sig, 'staking')).rejects.toMatchObject({
      errorCode: 'NEAR_PROVIDER_REJECTED',
    });
  });

  it('shares daily relayer budget across separate NearRpcClient instances', () => {
    const cfg = resolveNearNetworkConfig(
      {
        NEAR_RELAYER_ACCOUNT: `relayer-${randomBytes(4).toString('hex')}.testnet`,
        NEAR_RELAYER_DAILY_CAP: '0.05',
      },
      'testnet',
    );
    const clientA = new NearRpcClient(cfg) as unknown as { chargeDailyBudget(n: number): void };
    const clientB = new NearRpcClient(cfg) as unknown as { chargeDailyBudget(n: number): void };
    clientA.chargeDailyBudget(0.03);
    expect(() => clientB.chargeDailyBudget(0.03)).toThrow();
  });
});
