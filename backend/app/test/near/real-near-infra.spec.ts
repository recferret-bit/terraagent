import { createSign, generateKeyPairSync, sign as edSign } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NearStatusController } from '../../src/near/infrastructure/dev/near-status.controller.js';
import { verifyFastAuthSessionProof, verifyOidcJwt } from '../../src/near/infrastructure/adapters/real/jwks-verifier.js';
import { OneClickQuoteClient } from '../../src/near/infrastructure/adapters/real/oneclick-quote.service.js';
import { OpReceiptCache } from '../../src/near/infrastructure/adapters/real/op-receipt-cache.js';
import { resolveNearNetworkConfig } from '../../src/near/infrastructure/network/near-network.config.js';
import { isDeterministicChainError, toNearException } from '../../src/near/infrastructure/rpc/near-error-map.js';
import { seedToNearSecretKey } from '../../src/near/infrastructure/rpc/near-rpc.client.js';
import { encodeBase58 } from '../../src/near/keystore/base58.js';
import { InMemoryChainRead } from '../../src/near/testing/in-memory-chain-read.js';

describe('W23 real NEAR testnet infrastructure & adapters', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves default testnet endpoints and contract sub-accounts without leaking secrets in status', async () => {
    const cfg = resolveNearNetworkConfig({ NODE_ENV: 'production', NEAR_ROOT_ACCOUNT: 'terraagent.testnet' }, 'testnet');
    expect(cfg.contracts.res).toBe('res.terraagent.testnet');
    expect(cfg.contracts.deed).toBe('deed.terraagent.testnet');
    expect(cfg.contracts.bounty).toBe('bounty.terraagent.testnet');
    expect(cfg.accounts.relayer).toBe('relayer.terraagent.testnet');
    expect(cfg.explorerBaseUrl).toBe('https://testnet.nearblocks.io');

    const ctrl = new NearStatusController(new InMemoryChainRead(), {
      NODE_ENV: 'test',
      NEAR_MODE: 'testnet',
      NEAR_ROOT_SECRET_KEY: 'ed25519:super-secret-do-not-expose',
    } as never);
    const status = await ctrl.status();
    expect(status.nearMode).toBe('testnet');
    expect(status.ports.find((p) => p.port === 'CargoToken')?.mode).toBe('testnet');
    expect(status.ports.find((p) => p.port === 'BadgeNft')?.mode).toBe('mock');
    expect(status.ports.find((p) => p.port === 'Staking')?.mode).toBe('mock');
    expect(status.ports.find((p) => p.port === 'TreasuryDao')?.mode).toBe('mock');
    expect(JSON.stringify(status)).not.toContain('super-secret-do-not-expose');
  });

  it('maps deterministic contract panics to canonical NearException codes and distinguishes RPC outages', () => {
    expect(isDeterministicChainError(new Error('Contract panicked: NEAR_INSUFFICIENT_BALANCE: have 10'))).toBe(true);
    expect(isDeterministicChainError(new Error('FetchError: ECONNRESET'))).toBe(false);

    expect(toNearException(new Error('Smart contract panicked: NEAR_NFT_ALREADY_MINTED')).errorCode).toBe('NEAR_NFT_EXISTS');
    expect(toNearException(new Error('Smart contract panicked: NEAR_NOT_OWNER')).errorCode).toBe('NEAR_NOT_OWNER');
    expect(toNearException(new Error('Smart contract panicked: NEAR_ESCROW_ALREADY_CLOSED')).errorCode).toBe('NEAR_ESCROW_STATE');
    expect(toNearException(new Error('ECONNREFUSED')).errorCode).toBe('NEAR_UNAVAILABLE');
  });

  it('caches successful opIds and allows retrying failed opIds in OpReceiptCache', async () => {
    const cache = new OpReceiptCache<{ txHash: string }>();
    let calls = 0;
    await expect(
      cache.run('op-1', async () => {
        calls += 1;
        throw new Error('insufficient balance');
      }),
    ).rejects.toThrow('insufficient balance');

    const first = await cache.run('op-1', async () => {
      calls += 1;
      return { txHash: 'real-hash-1' };
    });
    const replay = await cache.run('op-1', async () => {
      calls += 1;
      return { txHash: 'real-hash-2' };
    });
    expect(first.txHash).toBe('real-hash-1');
    expect(replay.txHash).toBe('real-hash-1');
    expect(calls).toBe(2);
  });
});

describe('W23 JWKS OIDC verifier, FastAuth session proofs & 1Click dry quotes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('verifies RS256 OIDC JWTs against JWKS and rejects expired or tampered tokens', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = { ...(publicKey.export({ format: 'jwk' }) as object), kid: 'test-kid-1', alg: 'RS256' };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ keys: [jwk] }), { status: 200 })),
    );

    const makeJwt = (claims: Record<string, unknown>, tamper = false): string => {
      const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-kid-1' })).toString('base64url');
      const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
      const sign = createSign('RSA-SHA256');
      sign.update(`${h}.${p}`);
      const sig = sign.sign(privateKey);
      if (tamper) sig[0] = (sig[0]! ^ 0xff) & 0xff;
      return `${h}.${p}.${sig.toString('base64url')}`;
    };

    const valid = makeJwt({
      iss: 'https://login.testnet.fast-auth.com/',
      aud: 'np8paqIpMWmNbzT4xAvOOapZBjsOpptl',
      sub: 'google-oauth2|12345',
      email: 'pilot@terraagent.fun',
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    const verified = await verifyOidcJwt({
      token: valid,
      jwksUrl: 'https://login.testnet.fast-auth.com/.well-known/jwks.json',
      allowedIssuers: ['https://login.testnet.fast-auth.com/'],
      expectedAudience: 'np8paqIpMWmNbzT4xAvOOapZBjsOpptl',
    });
    expect(verified).toEqual({ subject: 'google-oauth2|12345', email: 'pilot@terraagent.fun' });

    const tampered = makeJwt(
      {
        iss: 'https://login.testnet.fast-auth.com/',
        aud: 'np8paqIpMWmNbzT4xAvOOapZBjsOpptl',
        sub: 'google-oauth2|12345',
        exp: Math.floor(Date.now() / 1000) + 300,
      },
      true,
    );
    await expect(
      verifyOidcJwt({
        token: tampered,
        jwksUrl: 'https://login.testnet.fast-auth.com/.well-known/jwks.json',
        allowedIssuers: ['https://login.testnet.fast-auth.com/'],
      }),
    ).rejects.toMatchObject({ errorCode: 'NEAR_PROVIDER_REJECTED' });
  });

  it('verifies FastAuth ed25519 session proofs and encodes 32-byte seeds to NEAR secret keys', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const pubDer = publicKey.export({ format: 'der', type: 'spki' });
    const privDer = privateKey.export({ format: 'der', type: 'pkcs8' });
    const seed = Buffer.from(privDer.subarray(privDer.length - 32));
    const nearPub = `ed25519:${encodeBase58(pubDer.subarray(pubDer.length - 32))}`;
    expect(seedToNearSecretKey(seed)).toMatch(/^ed25519:[1-9A-HJ-NP-Za-km-z]+$/);

    const message = 'terraagent-session:123';
    const sig = edSign(null, Buffer.from(message, 'utf8'), privateKey);
    const proof = Buffer.from(
      JSON.stringify({
        accountId: 'pilot.terraagent.testnet',
        publicKey: nearPub,
        signature: `ed25519:${encodeBase58(sig)}`,
        message,
        email: 'pilot@near.org',
      }),
    ).toString('base64url');
    expect(verifyFastAuthSessionProof(proof)).toEqual({
      subject: 'pilot.terraagent.testnet',
      email: 'pilot@near.org',
    });
  });
});

describe('W23 NEAR Intents 1Click dry-quote client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requests dry:true quotes from NEAR Intents 1Click API and falls back cleanly on network errors', async () => {
    const spy = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          quote: { amountIn: '1000', amountOut: '4200000', amountOutFormatted: '4.20', timeEstimate: 14 },
          timestamp: '2026-11-11T12:00:00Z',
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', spy);

    const client = new OneClickQuoteClient('https://1click.chaindefuser.com');
    const live = await client.dryQuote({ amount: '1000' });
    expect(live.source).toBe('live-1click');
    expect(live.dry).toBe(true);
    expect(live.amountOutFormatted).toBe('4.20');
    const sentBody = JSON.parse(String((spy.mock.calls[0]?.[1] as RequestInit)?.body));
    expect(sentBody.dry).toBe(true);

    spy.mockRejectedValueOnce(new Error('offline'));
    const fallback = await client.dryQuote({ amount: '1000' });
    expect(fallback.source).toBe('fallback');
    expect(fallback.dry).toBe(true);
  });
});
