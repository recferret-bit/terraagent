import { createHash, generateKeyPairSync, randomBytes, sign as cryptoSign } from 'node:crypto';
import { KeyPair } from 'near-api-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NearAiLlmAdapter, sha256Hex, type FetchLike } from '../../src/ai/adapters/nearai-llm.adapter.js';
import { hashEip191PersonalMessage, keccak256 } from '../../src/ai/adapters/secp256k1-eip191.js';
import { negotiateAgentQuote } from '../../src/ai/colony-agent/agent-commerce.js';
import { ColonyAgentLoopService } from '../../src/ai/colony-agent/colony-agent-loop.service.js';
import { EconomySimService } from '../../src/ai/economy-sim/economy-sim.service.js';
import type { AppEnv } from '../../src/core/tokens.js';
import { FlagsService } from '../../src/flags/flags.service.js';
import type { GamePlanets } from '../../src/game/game-planets.service.js';
import type { StakingPort } from '../../src/near/application/ports/staking.port.js';
import type { DeedRepository, StoredDeedRecord } from '../../src/near/deed/deed.repository.js';
import {
  clearNep413ReplayCache,
  computeNep413Hash,
  signNep413Message,
  verifyNep413ClaimSignature,
} from '../../src/near/identity/nep413-verifier.js';
import { OneClickQuoteClient } from '../../src/near/infrastructure/adapters/real/oneclick-quote.service.js';
import { receiverAllowed } from '../../src/near/infrastructure/adapters/relayer/relay-rules.js';
import { encodeBase58 } from '../../src/near/keystore/base58.js';
import { AccountClaimService } from '../../src/near/staking/account-claim.service.js';
import type { IdentityPort } from '../../src/near/application/ports/identity.port.js';
import type { StakingPositionSyncService } from '../../src/near/staking/staking-position-sync.service.js';
import { clearStakingKeyCache } from '../../src/near/staking/staking-signature-guard.js';
import { StakingService } from '../../src/near/staking/staking.service.js';
import type { LlmProviderPort } from '../../src/ports/llm-provider.port.js';
import { createPlanet, createRegistryPipeline, seedRivalAiColonies, SimHost, snapshot } from '@terra/sim';
import { ClaimAccountResponseSchema, parseWaves } from '@terra/contracts';

const SECP_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

function modInvN(a: bigint): bigint {
  let [t, newT] = [0n, 1n];
  let [r, newR] = [SECP_N, ((a % SECP_N) + SECP_N) % SECP_N];
  while (newR !== 0n) {
    const q = r / newR;
    [t, newT] = [newT, t - q * newT];
    [r, newR] = [newR, r - q * newR];
  }
  return ((t % SECP_N) + SECP_N) % SECP_N;
}

function signEip2098Compact64(digest32: Buffer): { address: string; compactHex: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const pubJwk = publicKey.export({ format: 'jwk' });
  const d = BigInt(`0x${Buffer.from(jwk.d!, 'base64url').toString('hex')}`);
  const x = Buffer.from(pubJwk.x!, 'base64url');
  const y = Buffer.from(pubJwk.y!, 'base64url');
  const address = `0x${keccak256(Buffer.concat([x, y])).subarray(12).toString('hex')}`;

  for (;;) {
    const kPair = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
    const k = BigInt(`0x${Buffer.from(kPair.privateKey.export({ format: 'jwk' }).d!, 'base64url').toString('hex')}`);
    const rJwk = kPair.publicKey.export({ format: 'jwk' });
    const rx = BigInt(`0x${Buffer.from(rJwk.x!, 'base64url').toString('hex')}`);
    const ry = BigInt(`0x${Buffer.from(rJwk.y!, 'base64url').toString('hex')}`);
    const r = rx % SECP_N;
    if (r === 0n || rx >= SECP_N) continue;
    const z = BigInt(`0x${digest32.toString('hex')}`);
    let s = (modInvN(k) * ((z + r * d) % SECP_N)) % SECP_N;
    if (s === 0n) continue;
    let yParity = Number(ry & 1n);
    if (s > SECP_N / 2n) {
      s = SECP_N - s;
      yParity ^= 1;
    }
    const rBuf = Buffer.from(r.toString(16).padStart(64, '0'), 'hex');
    const sBuf = Buffer.from(s.toString(16).padStart(64, '0'), 'hex');
    if (yParity === 1) sBuf[0] = sBuf[0]! | 0x80;
    return { address, compactHex: `0x${Buffer.concat([rBuf, sBuf]).toString('hex')}` };
  }
}

function makeDeedRecord(): StoredDeedRecord {
  const now = new Date('2026-11-15T00:00:00.000Z');
  return {
    colonyId: 'col_0',
    planetId: 'pl_1',
    playerId: 'p1',
    accountId: 'alex.pilots.terraagent.testnet',
    tokenId: 'deed:col_0',
    contract: 'deed.terraagent.testnet',
    metadata: {
      version: 1,
      planet: 'pl_1',
      colony: 'col_0',
      status: 'active',
      settled: false,
      imageUrl: '/v1/deeds/deed:col_0/image',
    },
    metadataVersion: 1,
    status: 'active',
    settled: false,
    chainState: 'ACTIVE',
    pendingOpId: null,
    lastUpdateTx: 'tx-1',
    lastError: null,
    lastDispatchedAt: now,
    lastDispatchedSimMs: 0n,
    pendingMilestone: null,
    createdAt: now,
    updatedAt: now,
    history: [],
  };
}

describe('TEE enclave allowlist pinning & unprefixed Base58 / EIP-2098 verification', () => {
  it('blocks NEAR_AI_TRUSTED_SIGNERS bypass via short signatures and verifies raw base58 Ed25519 + EIP-2098 ECDSA', async () => {
    let capturedReq = '';
    const completion = JSON.stringify({
      id: 'chatcmpl_allowlist_guard',
      model: 'z-ai/glm-5.3-flash-202611',
      choices: [{ message: { content: '{"action":"hold"}' } }],
      usage: { prompt_tokens: 12, completion_tokens: 4 },
    });
    const respHash = sha256Hex(completion);
    const pinnedAddr = '0x1111111111111111111111111111111111111111';

    const bypassAttemptFetch: FetchLike = async (input, init) => {
      if (String(input).endsWith('/chat/completions')) {
        capturedReq = String(init?.body ?? '');
        return new Response(completion, { status: 200 });
      }
      return new Response(
        JSON.stringify({
          text: `z-ai/glm-5.3-flash:${sha256Hex(capturedReq)}:${respHash}`,
          signature: '0x00',
          signing_address: pinnedAddr,
          signing_algo: 'ecdsa',
        }),
        { status: 200 },
      );
    };

    const blocked = await new NearAiLlmAdapter(bypassAttemptFetch).complete(
      { system: 's', messages: [{ role: 'user', content: 'obs' }], maxTokens: 32 },
      { NEAR_AI_API_KEY: 'k', NEAR_AI_TRUSTED_SIGNERS: pinnedAddr },
    );
    expect(blocked.attestation?.cryptoVerified).toBe(false);
    expect(blocked.attestation?.enclaveAllowlisted).toBe(false);
    expect(blocked.attestation?.verified).toBe(false);

    // Unprefixed base58 Ed25519 signature + canonicalized responseModelId
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const rawPub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
    const pubB58 = encodeBase58(rawPub);
    const b58EdFetch: FetchLike = async (input, init) => {
      if (String(input).endsWith('/chat/completions')) {
        capturedReq = String(init?.body ?? '');
        return new Response(completion, { status: 200 });
      }
      const text = `z-ai/glm-5.3-flash-202611:${sha256Hex(capturedReq)}:${respHash}`;
      const sigB58 = encodeBase58(cryptoSign(null, Buffer.from(text, 'utf8'), privateKey));
      return new Response(
        JSON.stringify({ text, signature: sigB58, signing_address: pubB58, signing_algo: 'ed25519' }),
        { status: 200 },
      );
    };

    const edOk = await new NearAiLlmAdapter(b58EdFetch).complete(
      { system: 's', messages: [{ role: 'user', content: 'obs' }], maxTokens: 32 },
      { NEAR_AI_API_KEY: 'k', NEAR_AI_SIGNING_ALGO: 'ed25519', NEAR_AI_TRUSTED_SIGNERS: pubB58 },
    );
    expect(edOk.attestation?.verified).toBe(true);
    expect(edOk.attestation?.cryptoVerified).toBe(true);
    expect(edOk.attestation?.enclaveAllowlisted).toBe(true);

    // EIP-2098 64-byte compact ECDSA signature
    let compactSigner = '';
    const compactFetch: FetchLike = async (input, init) => {
      if (String(input).endsWith('/chat/completions')) {
        capturedReq = String(init?.body ?? '');
        return new Response(completion, { status: 200 });
      }
      const text = `z-ai/glm-5.3-flash:${sha256Hex(capturedReq)}:${respHash}`;
      const signed = signEip2098Compact64(hashEip191PersonalMessage(text));
      compactSigner = signed.address;
      return new Response(
        JSON.stringify({ text, signature: signed.compactHex, signing_address: signed.address, signing_algo: 'ecdsa' }),
        { status: 200 },
      );
    };
    const ecdsaOk = await new NearAiLlmAdapter(compactFetch).complete(
      { system: 's', messages: [{ role: 'user', content: 'obs' }], maxTokens: 32 },
      { NEAR_AI_API_KEY: 'k', NEAR_AI_STRICT_CRYPTO_VERIFY: 'true' },
    );
    expect(ecdsaOk.attestation?.verified).toBe(true);
    expect(ecdsaOk.attestation?.signingAddress).toBe(compactSigner);
  });
});

describe('ColonyAgentLoopService & EconomySimService reject forged TEE attestations', () => {
  it('blocks unverified TEE directives with TEE_ATTESTATION_FAILED before submitting sim commands', async () => {
    const flags = parseWaves('..22').list;
    const host = new SimHost(createRegistryPipeline({ flags }));
    const state = createPlanet({ id: 'pl_tee', planetId: 'pl_tee', type: 'temperate', planetType: 'temperate', seed: 'loop-seed', radius: 26, capacity: 6 });
    host.load(state);
    host.submit({
      colonyIndex: 0,
      source: 'system',
      commandId: 'spawn_0',
      kind: 'system.spawnColony',
      args: { colonyId: 'col_0', colonyIndex: 0, name: 'Human Colony', unlockStage: 0 },
    });
    host.step(1);
    const [seededRival] = seedRivalAiColonies(host.state, { count: 1, capacity: 6, tick: host.tick });
    const rivalIndex = seededRival!.colonyIndex;
    const submitSpy = vi.fn().mockResolvedValue({ ok: true, appliedAtTick: 1 });
    const planets = {
      fullState: async () => ({ bytes: snapshot(host.state), tick: host.state.meta.tick }),
      submit: submitSpy,
    } as unknown as GamePlanets;

    const forgedLlm: LlmProviderPort = {
      complete: async () => ({
        text: JSON.stringify({
          directives: [{ colonyIndex: rivalIndex, action: 'queue_goal', goal: 'grow_economy', rationale: 'Forged directive' }],
        }),
        usage: { inputTokens: 10, outputTokens: 10 },
        model: 'z-ai/glm-5.3-flash',
        attestation: {
          chatId: 'forged_1',
          requestHash: 'a'.repeat(64),
          responseHash: 'b'.repeat(64),
          signingAddress: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
          signature: `0x${'11'.repeat(65)}`,
          verified: false,
          cryptoVerified: false,
        },
      }),
    };

    const loop = new ColonyAgentLoopService(planets, forgedLlm);
    const evals = await loop.tickPlanetAgents('pl_tee');
    const rival = evals.find((e) => e.colonyIndex === rivalIndex);
    expect(rival?.guardrailRejected).toBe('TEE_ATTESTATION_FAILED');
    expect(submitSpy).not.toHaveBeenCalled();

    const econSvc = new EconomySimService(forgedLlm);
    const report = await econSvc.run({ seed: 'forged-tee-check', days: 2 });
    expect(report.ai.providerModel).toBe('deterministic-policy');
    expect(report.ai.attestation?.verified).toBe(false);
  });
});

describe('Staking NEP-413 action/amount/pool binding', () => {
  beforeEach(() => {
    clearNep413ReplayCache();
    clearStakingKeyCache();
  });

  it('rejects login challenges, cross-action substitution, and amount inflation on real-network staking', async () => {
    const kp = generateKeyPairSync('ed25519');
    const pubB58 = `ed25519:${encodeBase58(kp.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32))}`;
    const deed = makeDeedRecord();
    const deeds = { findByColonyId: vi.fn().mockResolvedValue(deed) } as unknown as DeedRepository;
    const claimSvc = {
      isAccountClaimed: vi.fn().mockResolvedValue({
        claimed: true,
        accountId: 'alex.pilots.terraagent.testnet',
        claimedAt: '2026-11-15T00:00:00.000Z',
        claimedByAccountId: 'alex.testnet',
        claimedPublicKey: pubB58,
      }),
    } as unknown as AccountClaimService;
    const stakingPort = {
      listPools: vi.fn().mockResolvedValue([{ poolId: 'astro.pool.testnet', name: 'Astro', apyBp: 900 }]),
      stake: vi.fn().mockResolvedValue({ txHash: 'tx-ok', status: 'success', network: 'testnet', at: Date.now() }),
      unstake: vi.fn(),
      withdraw: vi.fn(),
    } as unknown as StakingPort;
    const sync = { syncAccount: vi.fn().mockResolvedValue(null) } as unknown as StakingPositionSyncService;
    const svc = new StakingService(
      new FlagsService({ NODE_ENV: 'test', TA_WAVES: 'all' } as unknown as AppEnv),
      stakingPort,
      deeds,
      claimSvc,
      sync,
      undefined,
      { NODE_ENV: 'test', NEAR_ADAPTER_STAKING: 'testnet' } as unknown as AppEnv,
    );

    const loginSig = signNep413Message({
      accountId: 'alex.testnet',
      publicKey: pubB58,
      privateKey: kp.privateKey,
      message: 'Sign in to TerraAgent\nChallenge: ch_123',
      nonceBase64: randomBytes(32).toString('base64'),
      recipient: 'terraagent.testnet',
    });
    await expect(
      svc.stake({ colonyId: 'col_0', pool: 'astro.pool.testnet', amount: '10', walletSignature: loginSig }),
    ).rejects.toMatchObject({ errorCode: 'NEAR_PROVIDER_REJECTED' });

    const smallStakeSig = signNep413Message({
      accountId: 'alex.testnet',
      publicKey: pubB58,
      privateKey: kp.privateKey,
      message: 'stake:col_0:astro.pool.testnet:1',
      nonceBase64: randomBytes(32).toString('base64'),
      recipient: 'astro.pool.testnet',
    });
    await expect(
      svc.stake({ colonyId: 'col_0', pool: 'astro.pool.testnet', amount: '500', walletSignature: smallStakeSig }),
    ).rejects.toMatchObject({ errorCode: 'NEAR_PROVIDER_REJECTED' });

    await expect(
      svc.withdraw({ colonyId: 'col_0', pool: 'astro.pool.testnet', walletSignature: smallStakeSig }),
    ).rejects.toMatchObject({ errorCode: 'NEAR_PROVIDER_REJECTED' });
    expect(stakingPort.stake).not.toHaveBeenCalled();
  });
});

describe('Staking secp256k1 wallets & multi-key rotation', () => {
  beforeEach(() => {
    clearNep413ReplayCache();
    clearStakingKeyCache();
  });

  it('supports secp256k1: NEAR wallet keys and multi-device FullAccess key rotation while blocking revoked keys', async () => {
    const secpWallet = KeyPair.fromRandom('secp256k1');
    const secpPub = secpWallet.getPublicKey().toString();
    const nonce = randomBytes(32);
    const msg = 'stake:col_0:astro.pool.testnet:25';
    const digest = computeNep413Hash({ message: msg, nonce, recipient: 'astro.pool.testnet' });
    const rawSig = secpWallet.sign(new Uint8Array(digest));
    const secpNep413 = {
      accountId: 'ethsnap.testnet',
      publicKey: secpPub,
      signature: `secp256k1:${encodeBase58(Buffer.from(rawSig.signature))}`,
      message: msg,
      nonce: nonce.toString('base64'),
      recipient: 'astro.pool.testnet',
    };

    expect(() =>
      verifyNep413ClaimSignature({
        signature: secpNep413,
        expectedWalletAccountId: 'ethsnap.testnet',
        expectedMessagePrefix: 'claim:',
        allowedRecipients: ['astro.pool.testnet'],
        network: 'testnet',
      }),
    ).toThrow(/must start with "claim:"/i);

    const activeKeys = new Set<string>([secpPub]);
    const keyVerifier = vi.fn(async (_acct: string, pk: string) => {
      if (!activeKeys.has(pk)) throw Object.assign(new Error('Key revoked'), { errorCode: 'NEAR_NOT_OWNER' });
    });

    const deeds = { findByColonyId: vi.fn().mockResolvedValue(makeDeedRecord()) } as unknown as DeedRepository;
    const claimSvc = {
      isAccountClaimed: vi.fn().mockResolvedValue({
        claimed: true,
        accountId: 'alex.pilots.terraagent.testnet',
        claimedAt: '2026-11-15T00:00:00.000Z',
        claimedByAccountId: 'ethsnap.testnet',
        claimedPublicKey: 'ed25519:OldRotatedKey1111111111111111111111111111',
      }),
    } as unknown as AccountClaimService;
    const stakingPort = {
      listPools: vi.fn().mockResolvedValue([{ poolId: 'astro.pool.testnet', name: 'Astro', apyBp: 900 }]),
      stake: vi.fn().mockResolvedValue({ txHash: 'tx-secp-ok', status: 'success', network: 'testnet', at: Date.now() }),
    } as unknown as StakingPort;
    const sync = { syncAccount: vi.fn().mockResolvedValue(null) } as unknown as StakingPositionSyncService;

    const svc = new StakingService(
      new FlagsService({ NODE_ENV: 'test', TA_WAVES: 'all' } as unknown as AppEnv),
      stakingPort,
      deeds,
      claimSvc,
      sync,
      undefined,
      { NODE_ENV: 'test', NEAR_ADAPTER_STAKING: 'testnet' } as unknown as AppEnv,
      undefined,
      undefined,
      keyVerifier,
    );

    const res = await svc.stake({
      colonyId: 'col_0',
      pool: 'astro.pool.testnet',
      amount: '25',
      walletSignature: secpNep413,
    });
    expect(res.txHash).toBe('tx-secp-ok');
    expect(keyVerifier).toHaveBeenCalledWith('ethsnap.testnet', secpPub, 'testnet', expect.any(Object));
  });
});

describe('1Click quote validation, Relayer Testnet isolation & Contractor buyer-fee cap', () => {
  it('validates positive atomic amounts on 1Click dryQuote, isolates intents.near from Testnet relayer, and enforces 1% buyer fee budget cap', async () => {
    const client = new OneClickQuoteClient('http://127.0.0.1:9'); // unreachable -> exercises validation + proportional fallback
    await expect(client.dryQuote({ amount: '-500' })).rejects.toMatchObject({ errorCode: 'VALIDATION_ERROR', status: 400 });
    await expect(client.dryQuote({ amount: '0' })).rejects.toMatchObject({ errorCode: 'VALIDATION_ERROR', status: 400 });
    await expect(client.dryQuote({ amount: 'not-a-number' })).rejects.toMatchObject({ errorCode: 'VALIDATION_ERROR', status: 400 });

    const tenNear = await client.dryQuote({ amount: '10000000000000000000000000' });
    expect(tenNear.source).toBe('fallback');
    expect(tenNear.amountOut).toBe('41500000');
    expect(tenNear.amountOutFormatted).toBe('41.50');

    expect(receiverAllowed('intents.near', 'terraagent.testnet')).toBe(false);
    expect(receiverAllowed('intents.near', 'terraagent.near')).toBe(true);
    expect(receiverAllowed('cargo-v2.terraagent.testnet', ['terraagent.testnet', 'cargo-v2.terraagent.testnet'])).toBe(true);

    // Buyer with exactly 100.00 USDC remaining cannot accept a 100.00 USDC NEP-413 quote once 1% platform fee (101.00 debit) is included
    const overWithFee = negotiateAgentQuote({
      itemOrService: 'metals.t1',
      quantity: 100,
      currency: 'USDC',
      plannedUnitPrice: 1.0,
      walkAwayUnitPrice: 1.0,
      sellerInitialAsk: 1.0,
      sellerFloorPrice: 1.0,
      remainingBudget: 100.0,
      buyerFeeBp: 100,
      benchmarkNote: 'parity 1.00',
    });
    expect(overWithFee.decision).toBe('walked_away');
    expect(createHash('sha256').update(tenNear.amountOut).digest('hex')).toHaveLength(64);

    // Ensure AccountClaimService response satisfies strict @terra/contracts ClaimAccountResponseSchema
    const realClaimSvc = new AccountClaimService(
      new FlagsService({ NODE_ENV: 'test', TA_WAVES: 'all' } as unknown as AppEnv),
      {
        claimAccount: vi.fn().mockResolvedValue({ txHash: 'tx-claim-1', status: 'success', network: 'mock', at: 1 }),
      } as unknown as IdentityPort,
      { NODE_ENV: 'test' } as unknown as AppEnv,
    );
    const claimDto = await realClaimSvc.claimColonyAccount({
      colonyId: 'col_0',
      walletAccountId: 'pilot.testnet',
      newPublicKey: 'ed25519:11111111111111111111111111111111',
    });
    expect(ClaimAccountResponseSchema.parse(claimDto).claimedPublicKey).toBe('ed25519:11111111111111111111111111111111');
  });
});
