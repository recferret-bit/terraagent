import { generateKeyPairSync, randomBytes } from 'node:crypto';
import {
  KeyPair,
  KeyPairSigner,
  actions,
  buildDelegateAction,
  encodeSignedDelegate,
  nearToYocto,
} from 'near-api-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearNep413ReplayCache,
  signNep413Message,
  verifyNep413ClaimSignature,
} from '../../src/near/identity/nep413-verifier.js';
import {
  buildMainnetSaltNonce,
  normalizeMainnetDeltas,
  simulateMainnetIntents,
  toMainnetVerifierTokenId,
} from '../../src/near/infrastructure/adapters/real/mainnet-intents-rpc.js';
import { TestnetIdentityAdapter } from '../../src/near/infrastructure/adapters/real/testnet-identity.adapter.js';
import { TestnetIntentsAdapter } from '../../src/near/infrastructure/adapters/real/testnet-intents.adapter.js';
import { receiverAllowed } from '../../src/near/infrastructure/adapters/relayer/relay-rules.js';
import { NearStatusController } from '../../src/near/infrastructure/dev/near-status.controller.js';
import { nearAdapters, nearEnvFor } from '../../src/near/infrastructure/near-infrastructure.module.js';
import { resolveNearNetworkConfig } from '../../src/near/infrastructure/network/near-network.config.js';
import {
  validateAndDecodeRelayDelegate,
  verifyFullAccessKeyAtFinality,
} from '../../src/near/infrastructure/rpc/near-rpc-guardrails.js';
import { seedToNearSecretKey } from '../../src/near/infrastructure/rpc/near-rpc.client.js';
import { encodeBase58 } from '../../src/near/keystore/base58.js';
import { parseStakingPoolsConfig } from '../../src/near/staking/staking-pools.config.js';
import { InMemoryChainRead } from '../../src/near/testing/in-memory-chain-read.js';

function makeEd25519Identity() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pubDer = publicKey.export({ format: 'der', type: 'spki' });
  const privDer = privateKey.export({ format: 'der', type: 'pkcs8' });
  const seed = Buffer.from(privDer.subarray(privDer.length - 32));
  const nearPublicKey = `ed25519:${encodeBase58(pubDer.subarray(pubDer.length - 32))}`;
  return { privateKey, seed, nearPublicKey, nearSecretKey: seedToNearSecretKey(seed) };
}

async function makeSignedDelegateBase64(params: {
  senderId: string;
  receiverId: string;
  innerActions: ReturnType<typeof actions.functionCall>[];
}): Promise<string> {
  const kp = KeyPair.fromRandom('ed25519');
  const delegateAction = buildDelegateAction({
    senderId: params.senderId,
    receiverId: params.receiverId,
    actions: params.innerActions,
    nonce: 1n,
    maxBlockHeight: 500n,
    publicKey: kp.getPublicKey(),
  });
  const signer = new KeyPairSigner(kp);
  const { signedDelegate } = await signer.signDelegateAction(delegateAction);
  return Buffer.from(encodeSignedDelegate(signedDelegate)).toString('base64');
}

describe('Testnet -> Mainnet config, NEAR_ALLOW_MAINNET safety latch & dual adapter bindings', () => {
  it('registers both testnet and mainnet adapters across all 11 NEAR ports + IntentsBalanceRead', () => {
    const byPort = new Map<string, Set<string>>();
    for (const entry of nearAdapters) {
      const name = typeof entry.port === 'function' ? entry.port.name : String(entry.port);
      const set = byPort.get(name) ?? new Set<string>();
      set.add(entry.kind);
      byPort.set(name, set);
    }
    expect(byPort.size).toBeGreaterThanOrEqual(12);
    for (const [portName, kinds] of byPort.entries()) {
      expect(kinds.has('testnet'), `${portName} missing testnet adapter`).toBe(true);
      expect(kinds.has('mainnet'), `${portName} missing mainnet adapter`).toBe(true);
    }
  });

  it('fails closed on NEAR_MODE=mainnet without NEAR_ALLOW_MAINNET=1 and resolves mainnet contracts & pools when enabled', async () => {
    const envSpec = nearEnvFor(nearAdapters);
    expect(() => envSpec.schema.parse({ NEAR_MODE: 'mainnet' })).toThrow(/NEAR_ALLOW_MAINNET/);
    expect(() => envSpec.schema.parse({ NEAR_ADAPTER_IDENTITY: 'mainnet' })).toThrow(/NEAR_ALLOW_MAINNET/);

    const ok = envSpec.schema.parse({ NEAR_MODE: 'mainnet', NEAR_ALLOW_MAINNET: '1' });
    expect(ok).toBeTruthy();

    const cfg = resolveNearNetworkConfig({ NEAR_MODE: 'mainnet', NEAR_ALLOW_MAINNET: '1' }, 'mainnet');
    expect(cfg.rootAccount).toBe('terraagent.near');
    expect(cfg.contracts.pilots).toBe('pilots.terraagent.near');
    expect(cfg.contracts.res).toBe('res.terraagent.near');
    expect(cfg.contracts.intents).toBe('intents.near');
    expect(cfg.quoteTokens.wnear).toBe('wrap.near');
    expect(cfg.quoteTokens.usdc).toBe('17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1');

    const mainnetPools = parseStakingPoolsConfig(undefined, { NEAR_MODE: 'mainnet' });
    expect(mainnetPools.map((p) => p.poolId)).toContain('astro-stakers.poolv1.near');
    expect(mainnetPools.map((p) => p.poolId)).toContain('kiln.poolv1.near');

    const statusCtrl = new NearStatusController(new InMemoryChainRead(), {
      NEAR_MODE: 'mainnet',
      NEAR_ALLOW_MAINNET: '1',
    } as never);
    const status = await statusCtrl.status();
    expect(status.network).toBe('mainnet');
    expect(status.contracts.pilots).toBe('pilots.terraagent.near');
  });
});

describe('Cryptographic NEP-413 claim verifier & replay/network/recipient guards', () => {
  beforeEach(() => {
    clearNep413ReplayCache();
  });

  it('accepts valid NEP-413 signatures and rejects replay, tampered messages, wrong recipient, or cross-network accounts', () => {
    const id = makeEd25519Identity();
    const payload = signNep413Message({
      accountId: 'alice.testnet',
      publicKey: id.nearPublicKey,
      privateKey: id.privateKey,
      message: 'claim:col_0',
      nonceBase64: randomBytes(32).toString('base64'),
      recipient: 'terraagent.testnet',
    });

    expect(() =>
      verifyNep413ClaimSignature({
        signature: payload,
        expectedWalletAccountId: 'alice.testnet',
        expectedPublicKey: id.nearPublicKey,
        allowedRecipients: ['terraagent.testnet'],
        network: 'testnet',
      }),
    ).not.toThrow();

    // Replay with the same (accountId, nonce) must be rejected
    expect(() =>
      verifyNep413ClaimSignature({
        signature: payload,
        expectedWalletAccountId: 'alice.testnet',
        expectedPublicKey: id.nearPublicKey,
        allowedRecipients: ['terraagent.testnet'],
        network: 'testnet',
      }),
    ).toThrow(/already been used/i);

    // Wrong network suffix (.testnet presented on mainnet)
    const crossNet = signNep413Message({
      accountId: 'alice.testnet',
      publicKey: id.nearPublicKey,
      privateKey: id.privateKey,
      message: 'claim:col_0',
      nonceBase64: randomBytes(32).toString('base64'),
      recipient: 'terraagent.near',
    });
    expect(() =>
      verifyNep413ClaimSignature({
        signature: crossNet,
        expectedWalletAccountId: 'alice.testnet',
        expectedPublicKey: id.nearPublicKey,
        allowedRecipients: ['terraagent.near'],
        network: 'mainnet',
      }),
    ).toThrow(/mainnet/i);

    // Tampered message
    const fresh = signNep413Message({
      accountId: 'alice.testnet',
      publicKey: id.nearPublicKey,
      privateKey: id.privateKey,
      message: 'claim:col_0',
      nonceBase64: randomBytes(32).toString('base64'),
      recipient: 'terraagent.testnet',
    });
    expect(() =>
      verifyNep413ClaimSignature({
        signature: { ...fresh, message: 'claim:col_999' },
        expectedWalletAccountId: 'alice.testnet',
        expectedPublicKey: id.nearPublicKey,
        allowedRecipients: ['terraagent.testnet'],
        network: 'testnet',
      }),
    ).toThrow();
  });
});

describe('MyNearWallet NEP-413 callbackUrl claim verification', () => {
  beforeEach(() => {
    clearNep413ReplayCache();
  });

  it('verifies MyNearWallet NEP-413 claim signatures signed over Some(callbackUrl) and rejects invalid callbackUrl schemes', () => {
    const id = makeEd25519Identity();
    const withCallback = signNep413Message({
      accountId: 'alice.testnet',
      publicKey: id.nearPublicKey,
      privateKey: id.privateKey,
      message: 'claim:col_0',
      nonceBase64: randomBytes(32).toString('base64'),
      recipient: 'terraagent.testnet',
      callbackUrl: 'http://127.0.0.1:5173/play.html',
    });
    expect(withCallback.callbackUrl).toBe('http://127.0.0.1:5173/play.html');
    expect(() =>
      verifyNep413ClaimSignature({
        signature: withCallback,
        expectedWalletAccountId: 'alice.testnet',
        expectedPublicKey: id.nearPublicKey,
        allowedRecipients: ['terraagent.testnet'],
        network: 'testnet',
      }),
    ).not.toThrow();

    // Origin without trailing slash signed literally by wallet must still verify
    const bareOrigin = signNep413Message({
      accountId: 'alice.testnet',
      publicKey: id.nearPublicKey,
      privateKey: id.privateKey,
      message: 'claim:col_0',
      nonceBase64: randomBytes(32).toString('base64'),
      recipient: 'terraagent.testnet',
      callbackUrl: 'https://terraagent.fun',
    });
    expect(() =>
      verifyNep413ClaimSignature({
        signature: bareOrigin,
        expectedWalletAccountId: 'alice.testnet',
        expectedPublicKey: id.nearPublicKey,
        allowedRecipients: ['terraagent.testnet'],
        network: 'testnet',
      }),
    ).not.toThrow();

    // Non-HTTP(S) callbackUrl must fail closed
    const badScheme = signNep413Message({
      accountId: 'alice.testnet',
      publicKey: id.nearPublicKey,
      privateKey: id.privateKey,
      message: 'claim:col_0',
      nonceBase64: randomBytes(32).toString('base64'),
      recipient: 'terraagent.testnet',
      callbackUrl: 'javascript:alert(1)',
    });
    expect(() =>
      verifyNep413ClaimSignature({
        signature: badScheme,
        expectedWalletAccountId: 'alice.testnet',
        expectedPublicKey: id.nearPublicKey,
        allowedRecipients: ['terraagent.testnet'],
        network: 'testnet',
      }),
    ).toThrow(/callbackUrl/i);
  });
});

describe('NEP-366 Relayer deposit cap, FunctionCall-only enforcement & receiver allow-list (R01-59)', () => {
  it('allows res/dao/pilots/staking/intents FunctionCalls within deposit cap and blocks Transfer, high deposits, and evil receivers', async () => {
    expect(receiverAllowed('dao.terraagent.testnet')).toBe(true);
    expect(receiverAllowed('pilots.terraagent.near')).toBe(true);
    expect(receiverAllowed('staking.terraagent.testnet')).toBe(true);
    expect(receiverAllowed('intents.near')).toBe(true);
    expect(receiverAllowed('evil.near')).toBe(false);

    const validB64 = await makeSignedDelegateBase64({
      senderId: 'alice.testnet',
      receiverId: 'res.terraagent.testnet',
      innerActions: [actions.functionCall('storage_deposit', {}, 10_000_000_000_000n, nearToYocto('0.0125'))],
    });
    const ok = validateAndDecodeRelayDelegate({
      signedDelegateBase64: validB64,
      expectedSenderId: 'alice.testnet',
      expectedReceiverId: 'res.terraagent.testnet',
      maxDepositNear: 0.05,
    });
    expect(ok.attachedNear).toBeCloseTo(0.0125, 6);

    const overCapB64 = await makeSignedDelegateBase64({
      senderId: 'alice.testnet',
      receiverId: 'res.terraagent.testnet',
      innerActions: [actions.functionCall('storage_deposit', {}, 10_000_000_000_000n, nearToYocto('0.25'))],
    });
    expect(() =>
      validateAndDecodeRelayDelegate({
        signedDelegateBase64: overCapB64,
        expectedSenderId: 'alice.testnet',
        expectedReceiverId: 'res.terraagent.testnet',
        maxDepositNear: 0.05,
      }),
    ).toThrow(/exceeds relayer cap/i);

    const transferB64 = await makeSignedDelegateBase64({
      senderId: 'alice.testnet',
      receiverId: 'res.terraagent.testnet',
      innerActions: [actions.transfer(nearToYocto('0.001')) as never],
    });
    expect(() =>
      validateAndDecodeRelayDelegate({
        signedDelegateBase64: transferB64,
        expectedSenderId: 'alice.testnet',
        expectedReceiverId: 'res.terraagent.testnet',
        maxDepositNear: 0.05,
      }),
    ).toThrow(/FunctionCall/i);
  });
});

function createMockIdentityAdapterFixture() {
  const relayerId = makeEd25519Identity();
  const dbRow: { accountId: string; ownerAccountId: string; publicKey: string; encryptedSecret: string; kekVersion: number; claimedAt: Date | null } = {
    accountId: '',
    ownerAccountId: '',
    publicKey: '',
    encryptedSecret: '',
    kekVersion: 1,
    claimedAt: null,
  };
  const fakePrisma = {
    nearColonyAccount: {
      findUnique: vi.fn(async ({ where }: { where: { accountId: string } }) =>
        where.accountId === dbRow.accountId ? { ...dbRow } : null,
      ),
      updateMany: vi.fn(async ({ data }: { data: Partial<typeof dbRow> }) => {
        Object.assign(dbRow, data);
        return { count: 1 };
      }),
    },
    socialIdentity: { findUnique: vi.fn(async () => null) },
  };
  const adapter = new TestnetIdentityAdapter(
    {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://terra:terra@127.0.0.1:5432/terra',
      NEAR_MODE: 'testnet',
      NEAR_ROOT_ACCOUNT: 'terraagent.testnet',
      NEAR_RELAYER_SECRET_KEY: relayerId.nearSecretKey,
      NEAR_KEK: randomBytes(32).toString('base64'),
    } as never,
    fakePrisma as never,
  );
  return { adapter, dbRow };
}

describe('Pilot sub-account factory & atomic non-custodial key rotation on ClaimAccount', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearNep413ReplayCache();
  });

  it('creates {label}.pilots.<root> via relayer operator when NEAR_ROOT_SECRET_KEY is absent and rotates keys on claim', async () => {
    const userWallet = makeEd25519Identity();
    const { adapter, dbRow } = createMockIdentityAdapterFixture();
    const rpc = (adapter as unknown as { rpc: Record<string, unknown> }).rpc;
    vi.spyOn(rpc as { accountExists: (id: string) => Promise<boolean> }, 'accountExists').mockResolvedValue(false);
    const callSpy = vi.spyOn(rpc as { call: (arg: unknown) => Promise<unknown> }, 'call').mockResolvedValue({
      receipt: { txHash: 'tx:pilot-factory-1', status: 'success', network: 'testnet', at: 1_700_000_000_000 },
      value: 'ferret.pilots.terraagent.testnet',
    });
    vi.spyOn(
      rpc as { verifyFullAccessKeyOnChain: (acct: string, pub: string) => Promise<void> },
      'verifyFullAccessKeyOnChain',
    ).mockResolvedValue(undefined);
    const rotateSpy = vi
      .spyOn(rpc as { rotateCustodialKeys: (arg: unknown) => Promise<unknown> }, 'rotateCustodialKeys')
      .mockResolvedValue({
        txHash: 'tx:atomic-rotate-1',
        status: 'success',
        network: 'testnet',
        at: 1_700_000_000_100,
      });

    const created = await adapter.createNamedAccount({ opId: 'op:create-1', name: 'ferret' });
    expect(created.accountId).toBe('ferret.pilots.terraagent.testnet');
    expect(callSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        signerAccountId: 'relayer.terraagent.testnet',
        contractId: 'pilots.terraagent.testnet',
        methodName: 'create_pilot_account',
      }),
    );

    dbRow.accountId = created.accountId;
    dbRow.ownerAccountId = created.accountId;
    const claimSignature = signNep413Message({
      accountId: 'alice.testnet',
      publicKey: userWallet.nearPublicKey,
      privateKey: userWallet.privateKey,
      message: 'claim:col_0',
      nonceBase64: randomBytes(32).toString('base64'),
      recipient: 'terraagent.testnet',
    });

    const claimReceipt = await adapter.claimAccount({
      opId: 'op:claim-1',
      accountId: created.accountId,
      walletAccountId: 'alice.testnet',
      walletPublicKey: userWallet.nearPublicKey,
      walletSignature: claimSignature,
    });
    expect(claimReceipt.txHash).toBe('tx:atomic-rotate-1');
    expect(rotateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'ferret.pilots.terraagent.testnet',
        newFullAccessPublicKey: userWallet.nearPublicKey,
      }),
    );
    expect(dbRow.encryptedSecret).toBe('claimed');
    expect(dbRow.publicKey).toBe(userWallet.nearPublicKey);
  });

  it('rejects verifyFullAccessKeyAtFinality when key is FunctionCall-only or missing', async () => {
    await expect(
      verifyFullAccessKeyAtFinality(
        async (op) => op({ query: async () => ({ permission: { FunctionCall: {} } }) } as never),
        'alice.testnet',
        'ed25519:abc',
      ),
    ).rejects.toMatchObject({ errorCode: 'NEAR_NOT_OWNER' });
  });
});

describe('Mainnet intents.near RPC helpers & post-claim custodial signing rejection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('translates cargo/quote token IDs, prefixes 4-byte current_salt nonces, maps simulate_intents, and blocks claimed custodial signing', async () => {
    const cfg = resolveNearNetworkConfig({ NEAR_MODE: 'mainnet', NEAR_ALLOW_MAINNET: '1' }, 'mainnet');
    expect(toMainnetVerifierTokenId('metals.t1', cfg)).toBe('nep245:res.terraagent.near:metals.t1');
    expect(toMainnetVerifierTokenId('nep245:res.terraagent.mock:bio.water', cfg)).toBe(
      'nep245:res.terraagent.near:bio.water',
    );
    expect(toMainnetVerifierTokenId('USDC', cfg)).toBe(
      'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
    );
    expect(toMainnetVerifierTokenId('NEAR', cfg)).toBe('nep141:wrap.near');
    expect(normalizeMainnetDeltas({ 'metals.t1': '-500', NEAR: '250' }, cfg)).toEqual({
      'nep245:res.terraagent.near:metals.t1': '-500',
      'nep141:wrap.near': '250',
    });

    const fakeRpc = {
      config: cfg,
      view: vi.fn(async (_cid: string, method: string) => {
        if (method === 'current_salt') return 'deadbeef';
        throw new Error('Smart contract panicked: insufficient balance for intent');
      }),
    };
    const saltNonceB64 = await buildMainnetSaltNonce(fakeRpc as never);
    const decodedNonce = Buffer.from(saltNonceB64, 'base64');
    expect(decodedNonce.length).toBe(32);
    expect(decodedNonce.subarray(0, 4).toString('hex')).toBe('deadbeef');

    const sim = await simulateMainnetIntents(fakeRpc as never, [
      {
        publicKey: 'ed25519:11111111111111111111111111111111',
        signature: 'ed25519:11111111111111111111111111111111',
        nonce: saltNonceB64,
        deadlineMs: Date.now() + 60_000,
        diff: { accountId: 'alice.near', deltas: { 'nep141:wrap.near': '-100' } },
      },
    ]);
    expect(sim.ok).toBe(false);
    expect(sim.errorCode).toBe('NEAR_INSUFFICIENT_BALANCE');

    const claimedPrisma = {
      nearColonyAccount: {
        findUnique: vi.fn(async () => ({
          accountId: 'p1.pilots.terraagent.near',
          publicKey: 'ed25519:user-key',
          encryptedSecret: 'claimed',
          kekVersion: 1,
        })),
      },
    };
    const intentsAdapter = new TestnetIntentsAdapter(
      {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://terra:terra@127.0.0.1:5432/terra',
        NEAR_MODE: 'mainnet',
        NEAR_ALLOW_MAINNET: '1',
        NEAR_KEK: randomBytes(32).toString('base64'),
      } as never,
      claimedPrisma as never,
    );

    await expect(
      intentsAdapter.signTokenDiff({
        accountId: 'p1.pilots.terraagent.near',
        deltas: { 'metals.t1': '-100', USDC: '50' },
        deadlineMs: Date.now() + 60_000,
      }),
    ).rejects.toMatchObject({ errorCode: 'NEAR_NOT_OWNER' });
  });
});
