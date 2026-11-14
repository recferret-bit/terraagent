import 'reflect-metadata';
import { createSign, generateKeyPairSync } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  NearAuthChallengeResponseSchema,
  SocialAuthResponseSchema,
} from '@terra/contracts';
import { baseEncode, KeyPairEd25519, KeyPairSigner } from 'near-api-js';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app';
import { Nep413AuthService, validateCallbackUrlCandidates } from '../../src/near/identity/nep413-auth.service';

const DEV = {
  NODE_ENV: 'test',
  SIM_THREADS: '1',
  JWT_ACCESS_SECRET: 'test-jwt-secret-0123456789abcdef',
  LOG_LEVEL: 'silent',
};

const apps: INestApplication[] = [];
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
afterAll(async () => {
  await Promise.all(apps.map((a) => a.close()));
});

async function boot(extra: Record<string, string> = {}) {
  const { app } = await createApp({ source: { ...DEV, ...extra } });
  await app.listen(0, '127.0.0.1');
  apps.push(app);
  const url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  return { app, url };
}

interface RpcKeyMap {
  readonly [accountKeyPair: string]: 'FullAccess' | 'FunctionCall';
}

function buildRpcAccessKeyResponse(id: string | number, permission: 'FullAccess' | 'FunctionCall' | undefined) {
  if (!permission) {
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id,
        error: { name: 'HANDLER_ERROR', cause: { name: 'UNKNOWN_ACCESS_KEY', info: {} }, code: -32000, message: 'err' },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id,
      result: {
        block_height: 185000001,
        block_hash: '11111111111111111111111111111111',
        nonce: 1,
        permission:
          permission === 'FullAccess'
            ? 'FullAccess'
            : { FunctionCall: { allowance: '250000000000000000000000', receiver_id: 'terraagent.testnet', method_names: [] } },
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function stubTestnetRpc(
  realFetch: typeof fetch,
  keys: RpcKeyMap,
  options: { failPrimary?: boolean; seenFinalities?: string[] } = {},
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const href = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (href === 'https://test.rpc.fastnear.com' || href === 'https://rpc.testnet.near.org') {
        if (options.failPrimary && href === 'https://test.rpc.fastnear.com') {
          return new Response('Service Unavailable', { status: 503 });
        }
        const rpcReq = JSON.parse(String(init?.body ?? '{}')) as {
          id?: string | number;
          params?: { finality?: string; account_id?: string; public_key?: string };
        };
        if (rpcReq.params?.finality && options.seenFinalities) {
          options.seenFinalities.push(rpcReq.params.finality);
        }
        const lookup = `${rpcReq.params?.account_id ?? ''}:${rpcReq.params?.public_key ?? ''}`;
        return buildRpcAccessKeyResponse(rpcReq.id ?? 1, keys[lookup]);
      }
      return realFetch(input, init);
    }),
  );
}

async function fetchChallenge(realFetch: typeof fetch, baseUrl: string, walletId?: string) {
  const res = await realFetch(`${baseUrl}/v1/auth/near/challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(walletId ? { walletId } : {}),
  });
  expect(res.status).toBe(200);
  return NearAuthChallengeResponseSchema.parse(await res.json());
}

describe('POST /v1/auth/near/challenge & /v1/auth/near/verify (happy paths + RPC failover)', () => {
  it('verifies Wallet Selector base64, near-cli ed25519:base58, and MyNearWallet callbackUrl signatures at final finality', async () => {
    const { url } = await boot();
    const realFetch = globalThis.fetch;
    const aliceKey = KeyPairEd25519.fromRandom();
    const cliKey = KeyPairEd25519.fromRandom();
    const mnwKey = KeyPairEd25519.fromRandom();
    const seenFinalities: string[] = [];

    stubTestnetRpc(
      realFetch,
      {
        [`alice.testnet:${aliceKey.publicKey.toString()}`]: 'FullAccess',
        [`cli-pilot.testnet:${cliKey.publicKey.toString()}`]: 'FullAccess',
        [`mnw-pilot.testnet:${mnwKey.publicKey.toString()}`]: 'FullAccess',
      },
      { failPrimary: true, seenFinalities },
    );

    const ch1 = await fetchChallenge(realFetch, url, 'near-mobile-wallet');
    expect(ch1.network).toBe('testnet');
    expect(Buffer.from(ch1.nonce, 'base64')).toHaveLength(32);
    const signed1 = await new KeyPairSigner(aliceKey).signNep413Message('alice.testnet', {
      message: ch1.message,
      nonce: new Uint8Array(Buffer.from(ch1.nonce, 'base64')),
      recipient: ch1.recipient,
    });
    const verifyRes1 = await realFetch(`${url}/v1/auth/near/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        challengeId: ch1.challengeId,
        accountId: 'alice.testnet',
        publicKey: signed1.publicKey.toString(),
        signature: Buffer.from(signed1.signature).toString('base64'),
        walletId: 'near-mobile-wallet',
      }),
    });
    expect(verifyRes1.status).toBe(200);
    expect(verifyRes1.headers.get('set-cookie')).toContain('ta_rt=');
    expect(SocialAuthResponseSchema.parse(await verifyRes1.json()).accountId).toBe('alice.testnet');
    expect(seenFinalities).toContain('final');

    const ch2 = await fetchChallenge(realFetch, url, 'near-cli');
    const signed2 = await new KeyPairSigner(cliKey).signNep413Message('cli-pilot.testnet', {
      message: ch2.message,
      nonce: new Uint8Array(Buffer.from(ch2.nonce, 'base64')),
      recipient: ch2.recipient,
    });
    const verifyRes2 = await realFetch(`${url}/v1/auth/near/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        challengeId: ch2.challengeId,
        accountId: 'cli-pilot.testnet',
        publicKey: signed2.publicKey.toString(),
        signature: `ed25519:${baseEncode(signed2.signature)}`,
        walletId: 'near-cli',
      }),
    });
    expect(verifyRes2.status).toBe(200);
    expect(SocialAuthResponseSchema.parse(await verifyRes2.json()).accountId).toBe('cli-pilot.testnet');

    const ch3 = await fetchChallenge(realFetch, url, 'my-near-wallet');
    const callbackUrl = 'https://terraagent.fun/landing.html';
    const signed3 = await new KeyPairSigner(mnwKey).signNep413Message('mnw-pilot.testnet', {
      message: ch3.message,
      nonce: new Uint8Array(Buffer.from(ch3.nonce, 'base64')),
      recipient: ch3.recipient,
      callbackUrl,
    });
    const verifyRes3 = await realFetch(`${url}/v1/auth/near/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        challengeId: ch3.challengeId,
        accountId: 'mnw-pilot.testnet',
        publicKey: signed3.publicKey.toString(),
        signature: Buffer.from(signed3.signature).toString('base64'),
        callbackUrl,
        walletId: 'my-near-wallet',
      }),
    });
    expect(verifyRes3.status).toBe(200);
    expect(SocialAuthResponseSchema.parse(await verifyRes3.json()).accountId).toBe('mnw-pilot.testnet');
  });
});

describe('NEP-413 replay, signature tamper, FunctionCall key, network mismatch & TTL checks', () => {
  it('rejects challenge replay, tampered signatures, FunctionCall keys, and mainnet .near accounts on Testnet', async () => {
    const { url } = await boot();
    const realFetch = globalThis.fetch;
    const goodKey = KeyPairEd25519.fromRandom();
    const goodSigner = new KeyPairSigner(goodKey);
    const fnCallKey = KeyPairEd25519.fromRandom();

    stubTestnetRpc(realFetch, {
      [`bob.testnet:${goodKey.publicKey.toString()}`]: 'FullAccess',
      [`dapp-key.testnet:${fnCallKey.publicKey.toString()}`]: 'FunctionCall',
      [`mainnet-user.near:${goodKey.publicKey.toString()}`]: 'FullAccess',
    });

    const chReplay = await fetchChallenge(realFetch, url, 'meteor-wallet');
    const signedReplay = await goodSigner.signNep413Message('bob.testnet', {
      message: chReplay.message,
      nonce: new Uint8Array(Buffer.from(chReplay.nonce, 'base64')),
      recipient: chReplay.recipient,
    });
    const payloadReplay = {
      challengeId: chReplay.challengeId,
      accountId: 'bob.testnet',
      publicKey: signedReplay.publicKey.toString(),
      signature: Buffer.from(signedReplay.signature).toString('base64'),
    };
    expect(
      (await realFetch(`${url}/v1/auth/near/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payloadReplay) })).status,
    ).toBe(200);
    const replayBad = await realFetch(`${url}/v1/auth/near/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payloadReplay),
    });
    expect(replayBad.status).toBe(401);
    expect(((await replayBad.json()) as { errorCode: string }).errorCode).toBe('NEAR_PROVIDER_REJECTED');

    const chTamper = await fetchChallenge(realFetch, url, 'okx-wallet');
    const signedTamper = await goodSigner.signNep413Message('bob.testnet', {
      message: chTamper.message,
      nonce: new Uint8Array(Buffer.from(chTamper.nonce, 'base64')),
      recipient: chTamper.recipient,
    });
    const badSig = Buffer.from(signedTamper.signature);
    badSig[0] = (badSig[0]! ^ 0xff) & 0xff;
    expect(
      (
        await realFetch(`${url}/v1/auth/near/verify`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ challengeId: chTamper.challengeId, accountId: 'bob.testnet', publicKey: signedTamper.publicKey.toString(), signature: badSig.toString('base64') }),
        })
      ).status,
    ).toBe(401);

    const chFn = await fetchChallenge(realFetch, url, 'intear-wallet');
    const signedFn = await new KeyPairSigner(fnCallKey).signNep413Message('dapp-key.testnet', {
      message: chFn.message,
      nonce: new Uint8Array(Buffer.from(chFn.nonce, 'base64')),
      recipient: chFn.recipient,
    });
    expect(
      (
        await realFetch(`${url}/v1/auth/near/verify`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ challengeId: chFn.challengeId, accountId: 'dapp-key.testnet', publicKey: signedFn.publicKey.toString(), signature: Buffer.from(signedFn.signature).toString('base64') }),
        })
      ).status,
    ).toBe(401);

    const chMainnet = await fetchChallenge(realFetch, url, 'near-cli');
    const signedMainnet = await goodSigner.signNep413Message('mainnet-user.near', {
      message: chMainnet.message,
      nonce: new Uint8Array(Buffer.from(chMainnet.nonce, 'base64')),
      recipient: chMainnet.recipient,
    });
    expect(
      (
        await realFetch(`${url}/v1/auth/near/verify`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ challengeId: chMainnet.challengeId, accountId: 'mainnet-user.near', publicKey: signedMainnet.publicKey.toString(), signature: Buffer.from(signedMainnet.signature).toString('base64') }),
        })
      ).status,
    ).toBe(401);
  });
});

describe('NEP-413 challenge TTL expiry', () => {
  it('rejects expired NEP-413 challenges past the 5-minute TTL', async () => {
    vi.useFakeTimers();
    const svc = new Nep413AuthService({ NODE_ENV: 'test', NEAR_MODE: 'testnet' } as never);
    const challenge = svc.issueChallenge({ walletId: 'meteor-wallet' });
    vi.advanceTimersByTime(5 * 60 * 1000 + 1000);

    await expect(
      svc.verifyChallenge({
        challengeId: challenge.challengeId,
        accountId: 'alice.testnet',
        publicKey: KeyPairEd25519.fromRandom().publicKey.toString(),
        signature: Buffer.alloc(64, 1).toString('base64'),
      }),
    ).rejects.toMatchObject({ errorCode: 'NEAR_PROVIDER_REJECTED' });
  });
});

describe('Security hardening on POST /v1/auth/social (unsigned wallet & email bypasses closed)', () => {
  it('rejects unsigned near-wallet:* and plain-text email tokens, and enforces email_verified on FastAuth Email JWTs', async () => {
    const { url } = await boot();
    const realFetch = globalThis.fetch;

    const unsignedWallet = await realFetch(`${url}/v1/auth/social`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'fastauth', token: 'near-wallet:alice.testnet:ed25519:abc' }),
    });
    expect(unsignedWallet.status).toBe(401);

    const plainEmail = await realFetch(`${url}/v1/auth/social`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'email', token: 'spoofed@terraagent.fun' }),
    });
    expect(plainEmail.status).toBe(401);

    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = { ...(publicKey.export({ format: 'jwk' }) as object), kid: 'email-kid-1', alg: 'RS256' };
    const signJwt = (claims: Record<string, unknown>): string => {
      const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'email-kid-1' })).toString('base64url');
      const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
      const signer = createSign('RSA-SHA256');
      signer.update(`${h}.${p}`);
      return `${h}.${p}.${signer.sign(privateKey).toString('base64url')}`;
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const href = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (href === 'https://dev-ep2ml1ryu5jcs8pz.us.auth0.com/.well-known/jwks.json') {
          return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
        }
        return realFetch(input, init);
      }),
    );

    const unverifiedEmailJwt = signJwt({
      iss: 'https://dev-ep2ml1ryu5jcs8pz.us.auth0.com/',
      aud: 'GhPTEx5u0o5Bh16F6LWjPXOXAyQROUNL',
      sub: 'email|65f001',
      email: 'pilot@terraagent.fun',
      email_verified: false,
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    const unverifiedRes = await realFetch(`${url}/v1/auth/social`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'email', token: unverifiedEmailJwt }),
    });
    expect(unverifiedRes.status).toBe(401);

    const verifiedEmailJwt = signJwt({
      iss: 'https://dev-ep2ml1ryu5jcs8pz.us.auth0.com/',
      aud: 'GhPTEx5u0o5Bh16F6LWjPXOXAyQROUNL',
      sub: 'email|65f001',
      email: 'pilot@terraagent.fun',
      email_verified: true,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    const verifiedRes = await realFetch(`${url}/v1/auth/social`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'email', token: verifiedEmailJwt }),
    });
    expect(verifiedRes.status).toBe(200);
    expect(SocialAuthResponseSchema.parse(await verifiedRes.json()).player.handle).toBe('pilot');

    // Omitted `email_verified` and string `'false'` must also be rejected (strict `=== true`):
    for (const badVerified of [undefined, 'false']) {
      const badEmailJwt = signJwt({
        iss: 'https://dev-ep2ml1ryu5jcs8pz.us.auth0.com/',
        aud: 'GhPTEx5u0o5Bh16F6LWjPXOXAyQROUNL',
        sub: 'email|65f002',
        email: 'spoof@terraagent.fun',
        ...(badVerified !== undefined ? { email_verified: badVerified } : {}),
        exp: Math.floor(Date.now() / 1000) + 300,
      });
      const badRes = await realFetch(`${url}/v1/auth/social`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'email', token: badEmailJwt }),
      });
      expect(badRes.status).toBe(401);
    }
  });
});

describe('NEP-413 exact vs normalized callbackUrl candidate matching', () => {
  it('verifies signatures over raw origin without trailing slash, normalized URL, and omitted callbackUrl while rejecting non-HTTP schemes', async () => {
    const { url } = await boot();
    const realFetch = globalThis.fetch;
    const kp = KeyPairEd25519.fromRandom();
    const signer = new KeyPairSigner(kp);
    const seenFinalities: string[] = [];

    stubTestnetRpc(realFetch, { [`origin-pilot.testnet:${kp.publicKey.toString()}`]: 'FullAccess' }, { seenFinalities });

    // 1) Wallet signed exact raw `http://127.0.0.1:5173` (without trailing slash) while URL() normalizes to `http://127.0.0.1:5173/`:
    const chRaw = await fetchChallenge(realFetch, url, 'my-near-wallet');
    const signedRaw = await signer.signNep413Message('origin-pilot.testnet', {
      message: chRaw.message,
      nonce: new Uint8Array(Buffer.from(chRaw.nonce, 'base64')),
      recipient: chRaw.recipient,
      callbackUrl: 'http://127.0.0.1:5173',
    });
    const resRaw = await realFetch(`${url}/v1/auth/near/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        challengeId: chRaw.challengeId,
        accountId: 'origin-pilot.testnet',
        publicKey: signedRaw.publicKey.toString(),
        signature: Buffer.from(signedRaw.signature).toString('base64'),
        callbackUrl: 'http://127.0.0.1:5173',
        walletId: 'my-near-wallet',
      }),
    });
    expect(resRaw.status).toBe(200);
    expect(seenFinalities).toHaveLength(1);

    // 2) Wallet signed normalized `http://127.0.0.1:5173/` while client sent `http://127.0.0.1:5173` (cached RPC key reused across candidates):
    const chNorm = await fetchChallenge(realFetch, url, 'my-near-wallet');
    const signedNorm = await signer.signNep413Message('origin-pilot.testnet', {
      message: chNorm.message,
      nonce: new Uint8Array(Buffer.from(chNorm.nonce, 'base64')),
      recipient: chNorm.recipient,
      callbackUrl: 'http://127.0.0.1:5173/',
    });
    const resNorm = await realFetch(`${url}/v1/auth/near/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        challengeId: chNorm.challengeId,
        accountId: 'origin-pilot.testnet',
        publicKey: signedNorm.publicKey.toString(),
        signature: Buffer.from(signedNorm.signature).toString('base64'),
        callbackUrl: 'http://127.0.0.1:5173',
        walletId: 'my-near-wallet',
      }),
    });
    expect(resNorm.status).toBe(200);
    expect(seenFinalities).toHaveLength(2);

    // 3) Invalid non-HTTP(S) callbackUrl scheme must fail closed with 401:
    const chBad = await fetchChallenge(realFetch, url, 'my-near-wallet');
    const resBad = await realFetch(`${url}/v1/auth/near/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        challengeId: chBad.challengeId,
        accountId: 'origin-pilot.testnet',
        publicKey: signedRaw.publicKey.toString(),
        signature: Buffer.from(signedRaw.signature).toString('base64'),
        callbackUrl: 'javascript:alert(1)',
      }),
    });
    expect(resBad.status).toBe(401);

    // 4) Direct unit checks on deduplicated callbackUrl candidate list:
    expect(validateCallbackUrlCandidates(undefined)).toEqual([undefined]);
    expect(validateCallbackUrlCandidates('   ')).toEqual([undefined]);
    expect(validateCallbackUrlCandidates('http://127.0.0.1:5173')).toEqual([
      'http://127.0.0.1:5173',
      'http://127.0.0.1:5173/',
      undefined,
    ]);
    expect(validateCallbackUrlCandidates('https://terraagent.fun/play.html')).toEqual([
      'https://terraagent.fun/play.html',
      undefined,
    ]);
    expect(() => validateCallbackUrlCandidates('ftp://terraagent.fun')).toThrow(/HTTP\(S\) URL/);
  });
});
