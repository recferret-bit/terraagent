import { generateKeyPairSync, randomBytes } from 'node:crypto';
import type { PrismaClient } from '@terra/db';
import type { IncomingMessage } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { type AuthTokenService } from '../../src/core/auth/index.js';
import { PublicEconomySimController } from '../../src/dev/economy-sim.controller.js';
import { FlagsService } from '../../src/flags/flags.service.js';
import { BountyController } from '../../src/near/bounty/bounty.controller.js';
import { NearDeedController } from '../../src/near/deed/deed.controller.js';
import { consumeNep413NoncePersistent, signNep413Message } from '../../src/near/identity/nep413-verifier.js';
import { RelayStatusService } from '../../src/near/identity/relay-status.service.js';
import { resolveNearNetworkConfig } from '../../src/near/infrastructure/network/near-network.config.js';
import { NearRpcClient } from '../../src/near/infrastructure/rpc/near-rpc.client.js';
import { encodeBase58 } from '../../src/near/keystore/base58.js';

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

    const deedsRepo = {
      findByColonyId: vi.fn(async () => ({ colonyId: 'col_1', playerId: 'pr_owner' })),
      listForPlayerOrColony: vi.fn(async () => []),
      listAll: vi.fn(async () => [{ colonyId: 'col_1' }]),
    };
    const deedCtrl = new NearDeedController(
      flags,
      deedsRepo as never,
      {} as never,
      { flushReady: vi.fn() } as never,
      {} as never,
      {} as never,
      mockTokens,
      undefined,
      undefined,
      undefined,
      strictEnv,
    );
    await expect(deedCtrl.settleDeed({ colonyId: 'col_1' }, reqWithBearer('dev:attacker'))).rejects.toMatchObject({
      errorCode: 'NEAR_NOT_OWNER',
    });
    const listOut = await deedCtrl.getOwnDeeds(reqWithBearer(null));
    expect(listOut.deed).toBeNull();
    expect(listOut.deeds).toEqual([]);
    expect(deedsRepo.listAll).not.toHaveBeenCalled();
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
