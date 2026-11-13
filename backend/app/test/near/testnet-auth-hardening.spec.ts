import 'reflect-metadata';
import { execSync } from 'node:child_process';
import { createSign, generateKeyPairSync, sign as edSign } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { NearAuthChallengeResponseSchema, SocialAuthResponseSchema } from '@terra/contracts';
import { KeyPairEd25519 } from 'near-api-js';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app';
import { IdentityPort } from '../../src/near/application/ports/identity.port';
import { accountRootFromOwner } from '../../src/near/identity/colony-account-write';
import { encodeBase58 } from '../../src/near/keystore/base58';

const DEV = {
  NODE_ENV: 'test',
  SIM_THREADS: '1',
  JWT_ACCESS_SECRET: 'test-jwt-secret-0123456789abcdef',
  LOG_LEVEL: 'silent',
};

const apps: INestApplication[] = [];
afterEach(() => {
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

function hasNearCliRs(): boolean {
  try {
    const out = execSync('near --version', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.includes('near-cli-rs');
  } catch {
    return false;
  }
}

describe('Testnet FastAuth session-proof bypass closed', () => {
  it('blocks unchallenged FastAuth ed25519 session proofs on POST /v1/auth/social in NEAR_MODE=testnet', async () => {
    const { url } = await boot({ NEAR_MODE: 'testnet', NEAR_ROOT_ACCOUNT: 'terraagent.testnet' });
    const realFetch = globalThis.fetch;

    const { publicKey: edPub, privateKey: edPriv } = generateKeyPairSync('ed25519');
    const pubDer = edPub.export({ format: 'der', type: 'spki' });
    const attackerNearPub = `ed25519:${encodeBase58(pubDer.subarray(pubDer.length - 32))}`;
    const forgedMsg = 'terraagent-session:forged';
    const forgedSig = edSign(null, Buffer.from(forgedMsg, 'utf8'), edPriv);
    const forgedProof = Buffer.from(
      JSON.stringify({
        accountId: 'victim.testnet',
        publicKey: attackerNearPub,
        signature: `ed25519:${encodeBase58(forgedSig)}`,
        message: forgedMsg,
        email: 'victim@terraagent.fun',
      }),
    ).toString('base64url');

    const takeoverAttempt = await realFetch(`${url}/v1/auth/social`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'fastauth', token: forgedProof }),
    });
    expect(takeoverAttempt.status).toBe(401);
    expect(((await takeoverAttempt.json()) as { errorCode: string }).errorCode).toBe('NEAR_PROVIDER_REJECTED');
  });
});

describe('PKCE redirect_uri allowlist & OIDC nonce stripping guards', () => {
  it('rejects untrusted PKCE redirect_uri origins and stripped OIDC nonces while accepting valid PKCE exchange', async () => {
    const { app, url } = await boot({ NEAR_MODE: 'testnet', NEAR_ROOT_ACCOUNT: 'terraagent.testnet' });
    const realFetch = globalThis.fetch;
    const identityPort = app.get(IdentityPort);
    vi.spyOn(identityPort, 'createNamedAccount').mockImplementation(async ({ name }) => ({
      accountId: `${name}.terraagent.testnet`,
      receipt: { txHash: '11111111111111111111111111111111', status: 'success', network: 'testnet', at: Date.now() },
    }));

    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = { ...(publicKey.export({ format: 'jwk' }) as object), kid: 'pkce-kid-1', alg: 'RS256' };
    const signIdToken = (claims: Record<string, unknown>): string => {
      const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'pkce-kid-1' })).toString('base64url');
      const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
      const s = createSign('RSA-SHA256');
      s.update(`${h}.${p}`);
      return `${h}.${p}.${s.sign(privateKey).toString('base64url')}`;
    };
    const idTokenWithNonce = signIdToken({
      iss: 'https://dev-ep2ml1ryu5jcs8pz.us.auth0.com/',
      aud: 'GhPTEx5u0o5Bh16F6LWjPXOXAyQROUNL',
      sub: 'google-oauth2|777888999',
      email: 'commander@terraagent.fun',
      nickname: 'commander',
      nonce: 'expected-nonce-abc',
      exp: Math.floor(Date.now() / 1000) + 300,
    });

    let tokenEndpointCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const href = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (href === 'https://dev-ep2ml1ryu5jcs8pz.us.auth0.com/oauth/token') {
          tokenEndpointCalls += 1;
          return new Response(JSON.stringify({ id_token: idTokenWithNonce }), { status: 200 });
        }
        if (href === 'https://dev-ep2ml1ryu5jcs8pz.us.auth0.com/.well-known/jwks.json') {
          return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
        }
        return realFetch(input, init);
      }),
    );

    const evilOriginRes = await realFetch(`${url}/v1/auth/social`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'google',
        token: 'fastauth-code:authcode1:verifier1234:https%3A%2F%2Fevil.example%2Fcb:expected-nonce-abc',
      }),
    });
    expect(evilOriginRes.status).toBe(401);
    expect(tokenEndpointCalls).toBe(0);

    const strippedNonceRes = await realFetch(`${url}/v1/auth/social`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'google',
        token: 'fastauth-code:authcode1:verifier1234:https%3A%2F%2Fterraagent.fun%2Flanding.html',
      }),
    });
    expect(strippedNonceRes.status).toBe(401);

    const validPkceRes = await realFetch(`${url}/v1/auth/social`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'google',
        token: 'fastauth-code:authcode1:verifier1234:https%3A%2F%2Fterraagent.fun%2Flanding.html:expected-nonce-abc',
      }),
    });
    expect(validPkceRes.status).toBe(200);
    expect(SocialAuthResponseSchema.parse(await validPkceRes.json()).player.handle).toBe('commander');
  });
});

describe('Colony sub-account root resolution & live near-cli-rs binary round-trip', () => {
  it('resolves colony account roots under terraagent.testnet for self-custodial .testnet and 64-hex implicit accounts', () => {
    expect(accountRootFromOwner('alice.testnet', 'co_01hxyz', { NEAR_ROOT_ACCOUNT: 'terraagent.testnet' })).toBe(
      'terraagent.testnet',
    );
    expect(accountRootFromOwner('alice.near', 'co_01hxyz', { NEAR_ROOT_ACCOUNT: 'terraagent.near' })).toBe(
      'terraagent.near',
    );
    expect(
      accountRootFromOwner(
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        'co_01hxyz',
        { NEAR_MODE: 'testnet' },
      ),
    ).toBe('terraagent.testnet');
    expect(accountRootFromOwner('pilot.custom-root.testnet', 'co_01hxyz', {})).toBe('custom-root.testnet');
  });

  it.skipIf(!hasNearCliRs())(
    'verifies a real near-cli-rs binary NEP-413 signature over multi-line challenge against POST /v1/auth/near/verify',
    async () => {
      const { url } = await boot({ NEAR_MODE: 'testnet', NEAR_ROOT_ACCOUNT: 'terraagent.testnet' });
      const realFetch = globalThis.fetch;
      const kp = KeyPairEd25519.fromRandom();

      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
          const href = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
          if (href === 'https://test.rpc.fastnear.com' || href === 'https://rpc.testnet.near.org') {
            const rpcReq = JSON.parse(String(init?.body ?? '{}')) as { id?: number | string };
            return new Response(
              JSON.stringify({
                jsonrpc: '2.0',
                id: rpcReq.id ?? 1,
                result: { block_height: 1, block_hash: '11111111111111111111111111111111', nonce: 1, permission: 'FullAccess' },
              }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            );
          }
          return realFetch(input, init);
        }),
      );

      const chRes = await realFetch(`${url}/v1/auth/near/challenge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ walletId: 'near-cli', intent: 'signin' }),
      });
      const ch = NearAuthChallengeResponseSchema.parse(await chRes.json());
      const singleQuotedMsg = `'${ch.message.replace(/'/g, "'\\''")}'`;
      const cliCmd = [
        `near message sign-nep413 utf8 ${singleQuotedMsg}`,
        `  nonce "${ch.nonce}"`,
        `  recipient "${ch.recipient}"`,
        `  sign-as cli-real.testnet`,
        `  sign-with-plaintext-private-key ${kp.toString()}`,
      ].join(' \\\n');

      const rawCliOut = execSync(cliCmd, { shell: '/bin/sh', encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const parsedCli = JSON.parse(rawCliOut) as { accountId: string; publicKey: string; signature: string };

      const verifyRes = await realFetch(`${url}/v1/auth/near/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          challengeId: ch.challengeId,
          accountId: parsedCli.accountId,
          publicKey: parsedCli.publicKey,
          signature: parsedCli.signature,
          walletId: 'near-cli',
        }),
      });
      expect(verifyRes.status).toBe(200);
      expect(SocialAuthResponseSchema.parse(await verifyRes.json()).accountId).toBe('cli-real.testnet');
    },
  );
});
