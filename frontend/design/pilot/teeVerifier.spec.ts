// @vitest-environment jsdom
import { createECDH, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  hashEip191PersonalMessage,
  keccak256,
  recoverSecp256k1Address,
} from '../../../backend/app/src/ai/adapters/secp256k1-eip191';
import { encodeBase58 } from '../../../backend/app/src/near/keystore/base58';
import { buildNearSocialPostTx } from '../../game/features/deed/deedShare';
import { openTeeProofModal } from '../../game/features/director/parts/teeProofModal';
import { renderAiSettingsSection } from '../../game/pages/me/sections/AiSettingsSection';
import { makeW12ProfileFixture } from '../../game/pages/me/testFixtures';
import { verifyTeeAttestationClient } from './teeVerifier';

const SECP_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const SECP_HALF_N = SECP_N >> 1n;

function signSecp256k1Personal(text: string): { address: string; sig65Hex: string; sig64CompactHex: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  const uncompressed64 = spki.subarray(spki.length - 64);
  const address = `0x${keccak256(uncompressed64).subarray(12).toString('hex')}`;

  const digest = hashEip191PersonalMessage(text);
  const jwk = privateKey.export({ format: 'jwk' });
  const d = BigInt(`0x${Buffer.from(jwk.d!, 'base64url').toString('hex')}`);
  const k = (BigInt(`0x${keccak256(digest).toString('hex')}`) % (SECP_N - 2n)) + 1n;

  const z = BigInt(`0x${digest.toString('hex')}`);
  let [t, newT] = [0n, 1n];
  let [rem, newRem] = [SECP_N, k];
  while (newRem !== 0n) {
    const q = rem / newRem;
    [t, newT] = [newT, t - q * newT];
    [rem, newRem] = [newRem, rem - q * newRem];
  }
  const modInvK = ((t % SECP_N) + SECP_N) % SECP_N;

  return signWithEcdhScalar(d, k, z, modInvK, digest, address);
}

function signWithEcdhScalar(
  d: bigint,
  k: bigint,
  z: bigint,
  kInv: bigint,
  digest: Buffer,
  address: string,
): { address: string; sig65Hex: string; sig64CompactHex: string } {
  const ecdh = createECDH('secp256k1');
  ecdh.setPrivateKey(Buffer.from(k.toString(16).padStart(64, '0'), 'hex'));
  const rUncompressed = ecdh.getPublicKey(); // 65 bytes: 0x04 || X || Y
  const rx = BigInt(`0x${rUncompressed.subarray(1, 33).toString('hex')}`);
  const r = rx % SECP_N;
  let s = (((z + r * d) % SECP_N) * kInv) % SECP_N;
  if (s > SECP_HALF_N) s = SECP_N - s;

  const rBuf = Buffer.from(r.toString(16).padStart(64, '0'), 'hex');
  const sBuf = Buffer.from(s.toString(16).padStart(64, '0'), 'hex');
  let matchedV = 27;
  for (const v of [27, 28]) {
    const candidate = Buffer.concat([rBuf, sBuf, Buffer.from([v])]);
    if (recoverSecp256k1Address(digest, candidate) === address) {
      matchedV = v;
      break;
    }
  }
  const sig65 = Buffer.concat([rBuf, sBuf, Buffer.from([matchedV])]);
  const compact = Buffer.concat([rBuf, sBuf]);
  if (matchedV === 28) compact[32] = compact[32]! | 0x80;
  return {
    address,
    sig65Hex: `0x${sig65.toString('hex')}`,
    sig64CompactHex: `0x${compact.toString('hex')}`,
  };
}

describe('verifyTeeAttestationClient (browser secp256k1 EIP-191/EIP-2098 + WebCrypto Ed25519)', () => {
  const reqHash = 'a1'.repeat(32);
  const resHash = 'b2'.repeat(32);
  const model = 'z-ai/glm-5.3-flash';

  it('cryptographically verifies provider_tee and gateway secp256k1 EIP-191 & EIP-2098 signatures in browser', async () => {
    const providerText = `${model}:${reqHash}:${resHash}`;
    const { address, sig65Hex, sig64CompactHex } = signSecp256k1Personal(providerText);

    const ok65 = await verifyTeeAttestationClient({
      model,
      requestHash: reqHash,
      responseHash: resHash,
      signingAlgo: 'ecdsa',
      signingAddress: address,
      signature: sig65Hex,
    });
    expect(ok65).toMatchObject({ valid: true, algo: 'ecdsa', browserVerified: true });

    const ok64 = await verifyTeeAttestationClient({
      model,
      requestHash: reqHash,
      responseHash: resHash,
      signingAlgo: 'ecdsa',
      signingAddress: address,
      signature: sig64CompactHex,
      signatureText: providerText,
    });
    expect(ok64).toMatchObject({ valid: true, algo: 'ecdsa', browserVerified: true });

    // Tampered responseHash must fail cryptographic recovery
    const tampered = await verifyTeeAttestationClient({
      model,
      requestHash: reqHash,
      responseHash: 'c3'.repeat(32),
      signingAlgo: 'ecdsa',
      signingAddress: address,
      signature: sig65Hex,
    });
    expect(tampered).toMatchObject({ valid: false, algo: 'ecdsa', browserVerified: true });
  });

  it('verifies Ed25519 provider_tee (${model}:${req}:${res}) across Base58 and Base64 and enforces server allowlist rejections', async () => {
    const kp = generateKeyPairSync('ed25519');
    const rawPub = kp.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
    const signedText = `${model}:${reqHash}:${resHash}`;
    const rawSig = cryptoSign(null, Buffer.from(signedText, 'utf8'), kp.privateKey);

    const okB58 = await verifyTeeAttestationClient({
      model,
      requestHash: reqHash,
      responseHash: resHash,
      signingAlgo: 'ed25519',
      signingAddress: `ed25519:${encodeBase58(rawPub)}`,
      signature: encodeBase58(rawSig),
    });
    expect(okB58).toMatchObject({ valid: true, algo: 'ed25519', browserVerified: true });

    const okB64 = await verifyTeeAttestationClient({
      model,
      requestHash: reqHash,
      responseHash: resHash,
      signingAlgo: 'ed25519',
      signingAddress: rawPub.toString('base64'),
      signature: rawSig.toString('base64'),
    });
    expect(okB64).toMatchObject({ valid: true, algo: 'ed25519', browserVerified: true });

    // Server allowlist rejection (verified: false) must NEVER be overridden by cryptoVerified: true
    const allowlistRejected = await verifyTeeAttestationClient({
      model,
      requestHash: reqHash,
      responseHash: resHash,
      signingAlgo: 'ed25519',
      signingAddress: `ed25519:${encodeBase58(rawPub)}`,
      signature: encodeBase58(rawSig),
      cryptoVerified: true,
      verified: false,
    });
    expect(allowlistRejected.valid).toBe(false);
  });
});

describe('verifyTeeAttestationClient hardening & NEAR Social network routing', () => {
  const reqHash = 'a1'.repeat(32);
  const resHash = 'b2'.repeat(32);
  const model = 'z-ai/glm-5.3-flash';

  it('rejects spoofed model prefixes and malformed signatures while verifying base64url Ed25519 and NEAR Social URLs', async () => {
    const kp = generateKeyPairSync('ed25519');
    const rawPub = kp.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
    const signedText = `${model}:${reqHash}:${resHash}`;
    const rawSig = cryptoSign(null, Buffer.from(signedText, 'utf8'), kp.privateKey);

    const spoofedModel = await verifyTeeAttestationClient({
      model,
      requestHash: reqHash,
      responseHash: resHash,
      signingAlgo: 'ed25519',
      signingAddress: `ed25519:${encodeBase58(rawPub)}`,
      signature: encodeBase58(rawSig),
      signatureText: `evil-model/trojan:${reqHash}:${resHash}`,
      verified: true,
    });
    expect(spoofedModel.valid).toBe(false);

    const malformedSig = await verifyTeeAttestationClient({
      model,
      requestHash: reqHash,
      responseHash: resHash,
      signingAlgo: 'ecdsa',
      signingAddress: '0x1111111111111111111111111111111111111111',
      signature: `0x${'ab'.repeat(30)}`,
      verified: true,
    });
    expect(malformedSig.valid).toBe(false);

    const okB64Url = await verifyTeeAttestationClient({
      model,
      requestHash: reqHash,
      responseHash: resHash,
      signingAlgo: 'ed25519',
      signingAddress: rawPub.toString('base64url'),
      signature: rawSig.toString('base64url'),
    });
    expect(okB64Url).toMatchObject({ valid: true, algo: 'ed25519', browserVerified: true });

    const testnetSocial = buildNearSocialPostTx({ tokenId: 'deed:col_0', network: 'testnet' }, 'pilot.testnet');
    const mainnetSocial = buildNearSocialPostTx({ tokenId: 'deed:col_0', network: 'mainnet' }, 'pilot.near');
    expect(testnetSocial.contractId).toBe('v1.social08.testnet');
    expect(testnetSocial.nearSocialUrl).toContain('test.near.social');
    expect(mainnetSocial.contractId).toBe('social.near');
    expect(mainnetSocial.nearSocialUrl).toContain('https://near.social/');
  });
});

describe('openTeeProofModal & /me enclave probe browser verification', () => {
  const reqHash = 'a1'.repeat(32);
  const resHash = 'b2'.repeat(32);
  const model = 'z-ai/glm-5.3-flash';

  it('renders accessible Faction Plate teeProofModal without raw hex and dismisses on Escape', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ attestations: [] }),
    }) as unknown as typeof fetch;

    const host = document.createElement('div');
    document.body.appendChild(host);
    openTeeProofModal('col_0', host);

    const modal = host.querySelector<HTMLElement>('[data-testid="tee-proof-modal"]');
    expect(modal).not.toBeNull();
    const dialog = modal?.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(modal?.innerHTML).not.toMatch(/#[0-9a-f]{6}/i);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(host.querySelector('[data-testid="tee-proof-modal"]')).toBeNull();

    host.remove();
    globalThis.fetch = origFetch;
  });

  it('verifies /v1/me/ai-settings/verify enclave response in-browser and flags rejected probes', async () => {
    const providerText = `${model}:${reqHash}:${resHash}`;
    const { address, sig65Hex } = signSecp256k1Personal(providerText);
    const profile = makeW12ProfileFixture('pilot');

    let serverOk = true;
    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: serverOk,
        model,
        managedStaker: true,
        attestation: {
          chatId: 'chat_1',
          model,
          requestHash: reqHash,
          responseHash: resHash,
          signingAlgo: 'ecdsa',
          signingAddress: address,
          signature: sig65Hex,
          cryptoVerified: serverOk,
          verified: serverOk,
        },
      }),
    }));

    const section = renderAiSettingsSection(profile, { fetch: mockFetch as never });
    const btn = section.querySelector<HTMLButtonElement>('[data-testid="me-ai-verify-btn"]')!;
    const statusEl = section.querySelector<HTMLElement>('[data-testid="me-ai-status"]')!;

    btn.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(statusEl.textContent).toContain('TEE OK');
    expect(statusEl.textContent).toContain('browserVerified=true');

    serverOk = false;
    btn.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(statusEl.textContent).toContain('rejected');
  });
});
