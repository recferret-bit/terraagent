import { generateKeyPairSync, randomBytes, sign as cryptoSign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { executeContractorTaskPlan } from '../../src/ai/colony-agent/agent-commerce.js';
import { NearAiLlmAdapter, sha256Hex, type FetchLike } from '../../src/ai/adapters/nearai-llm.adapter.js';
import { hashEip191PersonalMessage, keccak256, recoverSecp256k1Address } from '../../src/ai/adapters/secp256k1-eip191.js';
import { runScriptedSwarmRounds } from '../../src/ai/economy-sim/swarm-rounds.js';
import type { AppEnv } from '../../src/core/tokens.js';
import { FlagsService } from '../../src/flags/flags.service.js';
import type { StakingPort } from '../../src/near/application/ports/staking.port.js';
import type { DeedRepository, StoredDeedRecord } from '../../src/near/deed/deed.repository.js';
import { signNep413Message } from '../../src/near/identity/nep413-verifier.js';
import { assertRelayAllowed, receiverAllowed } from '../../src/near/infrastructure/adapters/relayer/relay-rules.js';
import { NearStatusController } from '../../src/near/infrastructure/dev/near-status.controller.js';
import { verifyTokenDiffIntent } from '../../src/near/intents/nep413-token-diff.js';
import { encodeBase58 } from '../../src/near/keystore/base58.js';
import type { AccountClaimService } from '../../src/near/staking/account-claim.service.js';
import type { StakingPositionSyncService } from '../../src/near/staking/staking-position-sync.service.js';
import { StakingController } from '../../src/near/staking/staking.controller.js';
import { StakingService } from '../../src/near/staking/staking.service.js';

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

function signSecp256k1Recoverable(digest32: Buffer): { address: string; sigHex: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const pubJwk = publicKey.export({ format: 'jwk' });
  const d = BigInt(`0x${Buffer.from(jwk.d!, 'base64url').toString('hex')}`);
  const x = Buffer.from(pubJwk.x!, 'base64url');
  const y = Buffer.from(pubJwk.y!, 'base64url');
  const expectedAddr = `0x${keccak256(Buffer.concat([x, y])).subarray(12).toString('hex')}`;

  const kPair = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
  const kJwk = kPair.privateKey.export({ format: 'jwk' });
  const rJwk = kPair.publicKey.export({ format: 'jwk' });
  const k = BigInt(`0x${Buffer.from(kJwk.d!, 'base64url').toString('hex')}`);
  const rx = BigInt(`0x${Buffer.from(rJwk.x!, 'base64url').toString('hex')}`);
  const ry = BigInt(`0x${Buffer.from(rJwk.y!, 'base64url').toString('hex')}`);
  const r = rx % SECP_N;
  const z = BigInt(`0x${digest32.toString('hex')}`);
  const s = (modInvN(k) * ((z + r * d) % SECP_N)) % SECP_N;
  const v = 27 + Number(ry & 1n);
  const sig = Buffer.concat([
    Buffer.from(r.toString(16).padStart(64, '0'), 'hex'),
    Buffer.from(s.toString(16).padStart(64, '0'), 'hex'),
    Buffer.from([v]),
  ]);
  expect(recoverSecp256k1Address(digest32, sig)).toBe(expectedAddr);
  return { address: expectedAddr, sigHex: `0x${sig.toString('hex')}` };
}

function generateNearEd25519() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const pubDer = publicKey.export({ format: 'der', type: 'spki' });
  const rawPub = pubDer.subarray(pubDer.length - 32);
  return {
    privateKey,
    rawPubHex: `0x${rawPub.toString('hex')}`,
    nearPublicKey: `ed25519:${encodeBase58(rawPub)}`,
  };
}

function makeTestDeed(): StoredDeedRecord {
  const now = new Date('2026-11-14T00:00:00.000Z');
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

describe('NEAR.AI EIP-191 secp256k1 TEE signature verification', () => {
  it('matches canonical Ethereum Keccak-256 vectors and recovers real EIP-191 secp256k1 TEE signatures', async () => {
    expect(keccak256(Buffer.alloc(0)).toString('hex')).toBe(
      'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
    );
    expect(keccak256(Buffer.from('abc', 'utf8')).toString('hex')).toBe(
      '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45',
    );

    let capturedReq = '';
    const completion = JSON.stringify({
      id: 'chatcmpl_crypto_ecdsa',
      model: 'z-ai/glm-5.3-flash',
      choices: [{ message: { content: '{"action":"hold"}' } }],
      usage: { prompt_tokens: 18, completion_tokens: 6 },
    });
    const respHash = sha256Hex(completion);
    let teeAddress = '';

    const makeFetch = (overrideAddr?: string): FetchLike => async (input, init) => {
      if (String(input).endsWith('/chat/completions')) {
        capturedReq = String(init?.body ?? '');
        return new Response(completion, { status: 200 });
      }
      const text = `z-ai/glm-5.3-flash:${sha256Hex(capturedReq)}:${respHash}`;
      const signed = signSecp256k1Recoverable(hashEip191PersonalMessage(text));
      teeAddress = signed.address;
      return new Response(
        JSON.stringify({
          text,
          signature: signed.sigHex,
          signing_address: overrideAddr ?? signed.address,
          signing_algo: 'ecdsa',
          signature_kind: 'provider_tee',
        }),
        { status: 200 },
      );
    };

    const okRes = await new NearAiLlmAdapter(makeFetch()).complete(
      { system: 's', messages: [{ role: 'user', content: 'obs' }], maxTokens: 32 },
      { NEAR_AI_API_KEY: 'k', NEAR_AI_STRICT_CRYPTO_VERIFY: 'true' },
    );
    expect(okRes.attestation?.verified).toBe(true);
    expect(okRes.attestation?.cryptoVerified).toBe(true);
    expect(okRes.attestation?.signingAddress).toBe(teeAddress);

    const forgedRes = await new NearAiLlmAdapter(makeFetch('0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef')).complete(
      { system: 's', messages: [{ role: 'user', content: 'obs' }], maxTokens: 32 },
      { NEAR_AI_API_KEY: 'k' },
    );
    expect(forgedRes.attestation?.cryptoVerified).toBe(false);
    expect(forgedRes.attestation?.verified).toBe(false);
  });
});

describe('NEAR.AI Ed25519 TEE verification & enclave allowlist pinning', () => {
  it('verifies Ed25519 TEE signatures and enforces NEAR_AI_STRICT_CRYPTO_VERIFY + NEAR_AI_TRUSTED_SIGNERS', async () => {
    const enclave = generateNearEd25519();
    let capturedReq = '';
    const completion = JSON.stringify({
      id: 'chatcmpl_crypto_ed25519',
      model: 'z-ai/glm-5.3-flash',
      choices: [{ message: { content: '{"action":"hold"}' } }],
      usage: { prompt_tokens: 10, completion_tokens: 4 },
    });
    const respHash = sha256Hex(completion);

    const fakeFetch: FetchLike = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/chat/completions')) {
        capturedReq = String(init?.body ?? '');
        return new Response(completion, { status: 200 });
      }
      expect(url).toContain('signing_algo=ed25519');
      const text = `z-ai/glm-5.3-flash:${sha256Hex(capturedReq)}:${respHash}`;
      const sig = cryptoSign(null, Buffer.from(text, 'utf8'), enclave.privateKey);
      return new Response(
        JSON.stringify({
          text,
          signature: `0x${sig.toString('hex')}`,
          signing_address: enclave.rawPubHex,
          signing_algo: 'ed25519',
          signature_kind: 'provider_tee',
        }),
        { status: 200 },
      );
    };

    const trusted = await new NearAiLlmAdapter(fakeFetch).complete(
      { system: 's', messages: [{ role: 'user', content: 'obs' }], maxTokens: 32 },
      {
        NEAR_AI_API_KEY: 'k',
        NEAR_AI_SIGNING_ALGO: 'ed25519',
        NEAR_AI_STRICT_CRYPTO_VERIFY: 'true',
        NEAR_AI_TRUSTED_SIGNERS: enclave.rawPubHex,
      },
    );
    expect(trusted.attestation?.verified).toBe(true);
    expect(trusted.attestation?.cryptoVerified).toBe(true);
    expect(trusted.attestation?.enclaveAllowlisted).toBe(true);

    const untrusted = await new NearAiLlmAdapter(fakeFetch).complete(
      { system: 's', messages: [{ role: 'user', content: 'obs' }], maxTokens: 32 },
      {
        NEAR_AI_API_KEY: 'k',
        NEAR_AI_SIGNING_ALGO: 'ed25519',
        NEAR_AI_TRUSTED_SIGNERS: '0x0000000000000000000000000000000000000000000000000000000000000001',
      },
    );
    expect(untrusted.attestation?.enclaveAllowlisted).toBe(false);
    expect(untrusted.attestation?.verified).toBe(false);
  });
});

describe('NEP-366 Relayer root-domain pinning & Staking bot guardrails', () => {
  it('blocks third-party prefixed contracts (res.evil.near) while allowing TerraAgent contracts & planet sub-DAOs', () => {
    expect(receiverAllowed('res.evil.near')).toBe(false);
    expect(receiverAllowed('deed.attacker.testnet')).toBe(false);
    expect(receiverAllowed('staking.phishing.near')).toBe(false);
    expect(receiverAllowed('dune.dao.attacker.testnet')).toBe(false);

    expect(receiverAllowed('res.terraagent.testnet')).toBe(true);
    expect(receiverAllowed('dune.dao.terraagent.testnet')).toBe(true);
    expect(receiverAllowed('ocean.dao.terraagent.near')).toBe(true);
    expect(receiverAllowed('res.custom.testnet', 'custom.testnet')).toBe(true);
    expect(receiverAllowed('res.terraagent.testnet', 'custom.testnet')).toBe(false);

    expect(() =>
      assertRelayAllowed({
        opId: 'op-evil-prefix',
        signerId: 'alice.testnet',
        receiverId: 'res.attacker.testnet',
        signedDelegate: 'delegate-bytes',
      }),
    ).toThrow(/NEAR_RELAY_RECEIVER_NOT_ALLOWED|not allowed/i);
  });

  it('blocks ta_bot_ API keys and bot/swarm actors from staking, unstaking, or withdrawing (403 AI_STAKING_FORBIDDEN)', () => {
    const fakeSvc = { stake: vi.fn(), unstake: vi.fn(), withdraw: vi.fn() } as unknown as StakingService;
    const ctrl = new StakingController(
      fakeSvc,
      new FlagsService({ NODE_ENV: 'test', TA_WAVES: 'all' } as unknown as AppEnv),
    );

    expect(() =>
      ctrl.stake({ pool: 'astro-stakers.pool.testnet', amount: '10' }, undefined, 'Bearer ta_bot_live_secret123', undefined),
    ).toThrow(/AI_STAKING_FORBIDDEN|cannot stake/i);

    expect(() =>
      ctrl.unstake({ pool: 'astro-stakers.pool.testnet', amount: '5' }, undefined, undefined, 'ta_bot_header_key'),
    ).toThrow(/AI_STAKING_FORBIDDEN|cannot stake/i);

    expect(() =>
      ctrl.withdraw({ pool: 'astro-stakers.pool.testnet' }, 'swarm', undefined, undefined),
    ).toThrow(/AI_STAKING_FORBIDDEN|cannot stake/i);

    expect(fakeSvc.stake).not.toHaveBeenCalled();
  });
});

describe('Real-network Staking NEP-413 public-key ownership binding', () => {
  it('rejects real-network staking signatures signed by an unowned throwaway Ed25519 keypair and accepts the pinned owner key', async () => {
    const ownerKey = generateNearEd25519();
    const attackerKey = generateNearEd25519();
    const deed = makeTestDeed();
    const deeds = { findByColonyId: vi.fn().mockResolvedValue(deed) } as unknown as DeedRepository;
    const claimService = {
      isAccountClaimed: vi.fn().mockResolvedValue({
        claimed: true,
        accountId: 'alex.pilots.terraagent.testnet',
        claimedAt: '2026-11-14T00:00:00.000Z',
        claimedByAccountId: 'alex.testnet',
        claimedPublicKey: ownerKey.nearPublicKey,
      }),
    } as unknown as AccountClaimService;
    const stakingPort = {
      listPools: vi.fn().mockResolvedValue([{ poolId: 'astro-stakers.pool.testnet', name: 'Astro', apyBp: 900 }]),
      stake: vi.fn().mockResolvedValue({ txHash: 'tx-stake-ok', status: 'success', network: 'testnet', at: Date.now() }),
    } as unknown as StakingPort;
    const sync = { syncAccount: vi.fn().mockResolvedValue(null) } as unknown as StakingPositionSyncService;

    const svc = new StakingService(
      new FlagsService({ NODE_ENV: 'test', TA_WAVES: 'all' } as unknown as AppEnv),
      stakingPort,
      deeds,
      claimService,
      sync,
      undefined,
      { NODE_ENV: 'test', NEAR_ADAPTER_STAKING: 'testnet' } as unknown as AppEnv,
    );

    const forgedSig = signNep413Message({
      accountId: 'alex.testnet',
      publicKey: attackerKey.nearPublicKey,
      privateKey: attackerKey.privateKey,
      message: 'stake:10',
      nonceBase64: randomBytes(32).toString('base64'),
      recipient: 'staking.terraagent.testnet',
    });

    await expect(
      svc.stake({ colonyId: 'col_0', pool: 'astro-stakers.pool.testnet', amount: '10', walletSignature: forgedSig }),
    ).rejects.toMatchObject({ errorCode: 'NEAR_PROVIDER_REJECTED' });
    expect(stakingPort.stake).not.toHaveBeenCalled();

    const validSig = signNep413Message({
      accountId: 'alex.testnet',
      publicKey: ownerKey.nearPublicKey,
      privateKey: ownerKey.privateKey,
      message: 'stake:10',
      nonceBase64: randomBytes(32).toString('base64'),
      recipient: 'staking.terraagent.testnet',
    });
    const ok = await svc.stake({
      colonyId: 'col_0',
      pool: 'astro-stakers.pool.testnet',
      amount: '10',
      walletSignature: validSig,
    });
    expect(ok.txHash).toBe('tx-stake-ok');
  });
});

describe('Cryptographic NEP-413 Swarm & Contractor proofs + /v1/near/status AI telemetry', () => {
  it('emits verifiable Ed25519 NEP-413 SignedIntent proofs on Swarm rounds and 4-way Contractor tasks', async () => {
    const swarm = runScriptedSwarmRounds('verify-nep413-swarm', 3);
    for (const round of swarm.rounds) {
      expect(round.zeroSumVerified).toBe(true);
      expect(round.signedIntentCount).toBeGreaterThan(2);
      const sample = round.sampleSignedIntent!;
      expect(
        verifyTokenDiffIntent({
          diff: { accountId: sample.signerId, deltas: sample.deltas },
          publicKey: sample.publicKey,
          signature: sample.signature,
          nonce: sample.nonce,
          deadlineMs: 1_763_000_000_000 + 15 * 60_000,
        }),
      ).toBe(true);
    }

    const plan = executeContractorTaskPlan('verify-nep413-contractor');
    expect(plan.receipts[0]?.nep413Proof?.verified).toBe(true);
    expect(plan.receipts[0]?.nep413Proof?.signedIntentCount).toBe(4);
    expect(plan.receipts[1]?.nep413Proof?.verified).toBe(true);
    expect(plan.receipts[2]?.nep413Proof).toBeUndefined();
    expect(plan.receipts[3]?.nep413Proof).toBeUndefined();

    const statusCtrl = new NearStatusController(undefined, {
      NODE_ENV: 'test',
      NEAR_MODE: 'testnet',
      AI_PROVIDER: 'nearai',
      NEAR_AI_SIGNING_ALGO: 'ed25519',
      NEAR_AI_STRICT_CRYPTO_VERIFY: 'true',
      NEAR_AI_TRUSTED_SIGNERS: '0xabc,0xdef',
    } as unknown as AppEnv);
    const status = await statusCtrl.status();
    expect(status.ai).toEqual({
      provider: 'nearai',
      defaultModel: 'z-ai/glm-5.3-flash',
      attestationEnabled: true,
      signingAlgo: 'ed25519',
      cryptoVerification: 'ed25519+secp256k1-eip191',
      strictCryptoVerify: true,
      enclaveAllowlistCount: 2,
      byokEncryption: 'AES-256-GCM',
    });
  });
});
