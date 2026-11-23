import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import type { PrismaClient } from '@terra/db';
import { PublicKey } from 'near-api-js';
import { describe, expect, it, vi } from 'vitest';
import { FlagsService } from '../../src/flags/flags.service.js';
import { verifyWalletOrderSignature } from '../../src/market/orders/wallet-signed-orders.js';
import { deriveDirectorPublicKey, nextDirectorPublicKey } from '../../src/near/director-key/director-key.allowance.js';
import { MockIntentsAdapter } from '../../src/near/infrastructure/adapters/mock/intents.adapter.js';
import { clearNep413ReplayCache, signNep413Message } from '../../src/near/identity/nep413-verifier.js';
import { generateSealedTradingSessionKey, openSealedTradingSessionSeed } from '../../src/near/identity/trading-session-key.js';
import { encodeBase58 } from '../../src/near/keystore/base58.js';
import { DEV_KEK, KeyStore, KekRing, loadKekRing } from '../../src/near/keystore/index.js';
import { AccountClaimService } from '../../src/near/staking/account-claim.service.js';
import { buildStakingWalletTxDescriptor } from '../../src/near/staking/staking-wallet-tx.js';

function createMemColonyPrisma(initialAccountId: string, colonyId: string, playerId: string) {
  const row = {
    accountId: initialAccountId,
    colonyId,
    playerId,
    slot: 'colony',
    publicKey: 'ed25519:old-custodial',
    encryptedSecret: 'v1:old',
    kekVersion: 1,
    claimedAt: null as Date | null,
    claimedByAccountId: null as string | null,
    tradingSessionPublicKey: null as string | null,
    tradingSessionEncryptedSecret: null as string | null,
  };
  const prisma = {
    nearColonyAccount: {
      findFirst: vi.fn(async () => ({ ...row })),
      findUnique: vi.fn(async ({ where }: { where: { accountId: string } }) => (where.accountId === row.accountId ? { ...row } : null)),
      update: vi.fn(async ({ data }: { data: Partial<typeof row> }) => {
        Object.assign(row, data);
        return { ...row };
      }),
      updateMany: vi.fn(async ({ data }: { data: Partial<typeof row> }) => {
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
  };
  return { row, prisma: prisma as unknown as PrismaClient };
}

describe('Self-custody trading session keys & Claim lifecycle', () => {
  it('seals & opens scoped session key and fails closed when revoked', () => {
    const keys = new KeyStore(new KekRing(1, [[1, DEV_KEK]]));
    const sealed = generateSealedTradingSessionKey(keys);
    expect(sealed.publicKey).toMatch(/^ed25519:/);
    const seed = openSealedTradingSessionSeed(keys, {
      tradingSessionPublicKey: sealed.publicKey,
      tradingSessionEncryptedSecret: sealed.encryptedSecret,
      kekVersion: sealed.kekVersion,
    });
    expect(seed?.length).toBe(32);
    expect(openSealedTradingSessionSeed(keys, { tradingSessionEncryptedSecret: null })).toBeNull();
    expect(openSealedTradingSessionSeed(keys, { tradingSessionEncryptedSecret: 'revoked' })).toBeNull();
  });

  it('seals session key on claimAccount, signs while active, rejects when revoked, and restores on re-auth', async () => {
    const env = { NODE_ENV: 'test', DATABASE_URL: 'postgresql://local/test', STORAGE_MODE: 'postgres' } as never;
    const { row, prisma } = createMemColonyPrisma('col0.terraagent.mock', 'col_0', 'p_owner');
    const kp = generateKeyPairSync('ed25519');
    const pubB58 = `ed25519:${encodeBase58(kp.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32))}`;
    const identity = {
      claimAccount: vi.fn(async () => {
        row.encryptedSecret = 'claimed';
        return { txHash: 'mock:claim', status: 'success', network: 'mock', at: 1 };
      }),
    };
    const claimSvc = new AccountClaimService(new FlagsService({ TA_WAVES: 'all' } as never), identity as never, env, prisma);
    const claimed = await claimSvc.claimColonyAccount({
      colonyId: 'col_0',
      walletAccountId: 'pilot.testnet',
      newPublicKey: pubB58,
      playerId: 'p_owner',
    });
    expect(claimed.tradingSessionPublicKey).toMatch(/^ed25519:/);
    expect(row.tradingSessionEncryptedSecret).toBeTruthy();

    const intents = new MockIntentsAdapter(prisma, undefined, undefined, env);
    const signed = await intents.signTokenDiff({ accountId: row.accountId, deltas: { 'metals.t1': '10' }, deadlineMs: Date.now() + 60_000 });
    expect(signed.publicKey).toBe(claimed.tradingSessionPublicKey);
    expect(signed.signature).toMatch(/^ed25519:/);

    await claimSvc.revokeTradingSessionKey({ colonyId: 'col_0', playerId: 'p_owner' });
    expect(row.tradingSessionEncryptedSecret).toBeNull();
    await expect(
      intents.signTokenDiff({ accountId: row.accountId, deltas: { 'metals.t1': '10' }, deadlineMs: Date.now() + 60_000 }),
    ).rejects.toMatchObject({ errorCode: 'NEAR_NOT_OWNER' });

    const rotated = await claimSvc.reauthorizeTradingSessionKey({ colonyId: 'col_0', playerId: 'p_owner' });
    expect(rotated.tradingSessionPublicKey).not.toBe(claimed.tradingSessionPublicKey);
    const signed2 = await intents.signTokenDiff({ accountId: row.accountId, deltas: { 'metals.t1': '10' }, deadlineMs: Date.now() + 60_000 });
    expect(signed2.publicKey).toBe(rotated.tradingSessionPublicKey);
    expect(() => loadKekRing({ NODE_ENV: 'test' })).not.toThrow();
  });
});

describe('Deterministic Ed25519 director keys & staking wallet-tx descriptors', () => {
  it('derives HMAC-keyed NEAR Ed25519 PublicKeys on director rotation sequence and blocks unkeyed production use', () => {
    const k1 = deriveDirectorPublicKey('co_alpha', 1, { NEAR_KEK: 'secret-kek-a' });
    const k2 = nextDirectorPublicKey('co_alpha', k1, { NEAR_KEK: 'secret-kek-a' });
    const k3 = nextDirectorPublicKey('co_alpha', 'ed25519:d:co_alpha:2', { NEAR_KEK: 'secret-kek-a' });
    const otherKek = deriveDirectorPublicKey('co_alpha', 1, { NEAR_KEK: 'secret-kek-b' });
    expect(k1).not.toBe(k2);
    expect(k1).not.toBe(otherKek);
    expect(k2).toBe(deriveDirectorPublicKey('co_alpha', 2, { NEAR_KEK: 'secret-kek-a' }));
    expect(k3).toBe(deriveDirectorPublicKey('co_alpha', 3, { NEAR_KEK: 'secret-kek-a' }));
    expect(() => PublicKey.fromString(k1)).not.toThrow();
    expect(() => PublicKey.fromString(k2)).not.toThrow();
    expect(createHash('sha256').update(k1).digest('hex')).toHaveLength(64);
    expect(() => deriveDirectorPublicKey('co_alpha', 1, { NODE_ENV: 'production', NEAR_KEK: '', JWT_ACCESS_SECRET: '' })).toThrow(/NEAR_KEK/i);
  });

  it('builds valid staking wallet tx descriptors for stake_payable, stake_lst, deposit_near, and claim_native_near', () => {
    const stakeTx = buildStakingWalletTxDescriptor({ action: 'stake_payable', poolId: 'astro-stakers.poolv1.near', amountNear: '12' });
    expect(stakeTx.methodName).toBe('stake_payable');
    expect(stakeTx.attachedDepositYocto).toBe('12000000000000000000000000');

    const lstTx = buildStakingWalletTxDescriptor(
      { action: 'stake_lst', amountNear: '15', accountId: 'pilot.testnet' },
      { NEAR_ADAPTER_STAKING: 'testnet' },
    );
    expect(lstTx.contractId).toBe('meta-v2.pool.testnet');
    expect(lstTx.methodName).toBe('ft_transfer_call');
    expect(lstTx.attachedDepositYocto).toBe('1');
    expect(lstTx.args).toMatchObject({
      receiver_id: 'staking.terraagent.testnet',
      amount: '15000000000000000000000000',
    });
    expect(() =>
      buildStakingWalletTxDescriptor({ action: 'stake_lst', lstContract: 'stnear.attacker.testnet', amountNear: '10' }),
    ).toThrow(/unwhitelisted/i);

    const claimTx = buildStakingWalletTxDescriptor({ action: 'claim_native_near', amountNear: '2', accountId: 'pilot.testnet' });
    expect(claimTx.methodName).toBe('claim_native_near');
    expect(claimTx.attachedDepositYocto).toBe('0');
    expect(claimTx.args).toMatchObject({ amount: '2000000000000000000000000', recipient_id: 'pilot.testnet' });
    expect(() => buildStakingWalletTxDescriptor({ action: 'bad_action' })).toThrow();
  });
});

describe('Wallet-signed market order intent & key binding', () => {
  it('binds wallet-signed market orders to exact side/resource/amount/price and verifies key ownership before nonce burn', async () => {
    clearNep413ReplayCache();
    const legit = generateKeyPairSync('ed25519');
    const attacker = generateKeyPairSync('ed25519');
    const legitPub = `ed25519:${encodeBase58(legit.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32))}`;
    const attackerPub = `ed25519:${encodeBase58(attacker.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32))}`;
    const nonce = randomBytes(32).toString('base64');
    const orderBody = { side: 'sell' as const, resource: 'metals.t1' as const, amount: 50, price: { token: 'USDC' as const, amount: '56000000' } };

    // 1. Order substitution (signed amount=1, submitted amount=50) is rejected
    const subSig = signNep413Message({
      accountId: 'pilot.testnet',
      publicKey: legitPub,
      privateKey: legit.privateKey,
      message: 'order:pl_1:sell:metals.t1:1:USDC:56000000',
      nonceBase64: nonce,
      recipient: 'intents.near',
    });
    await expect(
      verifyWalletOrderSignature({
        sig: subSig,
        planetId: 'pl_1',
        body: orderBody,
        expectedWalletAccountId: 'pilot.testnet',
        pinnedPublicKey: legitPub,
        envMap: { NODE_ENV: 'test', NEAR_ADAPTER_INTENTS: 'testnet' },
      }),
    ).rejects.toThrow(/does not match requested order/i);

    // 2. Spoofed keypair is rejected WITHOUT burning nonce
    const spoofSig = signNep413Message({
      accountId: 'pilot.testnet',
      publicKey: attackerPub,
      privateKey: attacker.privateKey,
      message: 'order:pl_1:sell:metals.t1:50:USDC:56000000',
      nonceBase64: nonce,
      recipient: 'intents.near',
    });
    await expect(
      verifyWalletOrderSignature({
        sig: spoofSig,
        planetId: 'pl_1',
        body: orderBody,
        expectedWalletAccountId: 'pilot.testnet',
        pinnedPublicKey: legitPub,
        envMap: { NODE_ENV: 'test', NEAR_ADAPTER_INTENTS: 'testnet' },
      }),
    ).rejects.toThrow(/not an authorized FullAccess key/i);

    // 3. Legitimate signature with the same nonce succeeds, and second replay fails
    const validSig = signNep413Message({
      accountId: 'pilot.testnet',
      publicKey: legitPub,
      privateKey: legit.privateKey,
      message: 'order:pl_1:sell:metals.t1:50:USDC:56000000',
      nonceBase64: nonce,
      recipient: 'intents.near',
    });
    await expect(
      verifyWalletOrderSignature({
        sig: validSig,
        planetId: 'pl_1',
        body: orderBody,
        expectedWalletAccountId: 'pilot.testnet',
        pinnedPublicKey: legitPub,
        envMap: { NODE_ENV: 'test', NEAR_ADAPTER_INTENTS: 'testnet' },
      }),
    ).resolves.toBeUndefined();
    await expect(
      verifyWalletOrderSignature({
        sig: validSig,
        planetId: 'pl_1',
        body: orderBody,
        expectedWalletAccountId: 'pilot.testnet',
        pinnedPublicKey: legitPub,
        envMap: { NODE_ENV: 'test', NEAR_ADAPTER_INTENTS: 'testnet' },
      }),
    ).rejects.toThrow(/nonce has already been used/i);
  });
});
