import { describe, expect, it } from 'vitest';
import { MARKET_TOKENS, toChainUnits } from '@terra/contracts';
import { buildTokenDiffPayload, canonicalTokenDiffMessage, signTokenDiffPayload, verifyTokenDiffIntent } from '../../src/near/intents/nep413-token-diff';
import { InMemoryIntents } from '../../src/near/testing';

const WATER = MARKET_TOKENS['bio.water'].verifierId;
const USDC = MARKET_TOKENS.USDC.verifierId;
const deltas = { [USDC]: '10200000', [WATER]: `-${toChainUnits('bio.water', '10')}` };
const deadlineMs = Date.UTC(2030, 0, 1);

describe('NEP-413 token_diff (W13-07)', () => {
  it('acceptance: a signed diff verifies; changing one amount makes verification fail', async () => {
    const fake = new InMemoryIntents();
    const signed = await fake.signTokenDiff({ accountId: 'colony1.mock', deltas, deadlineMs });
    expect(signed.signature).toMatch(/^ed25519:/);
    expect(Buffer.from(signed.nonce, 'base64')).toHaveLength(32);
    expect(verifyTokenDiffIntent(signed)).toBe(true);
    expect(verifyTokenDiffIntent(signed, fake.publicKeyOf('colony1.mock'))).toBe(true);
    const tampered = { ...signed, diff: { ...signed.diff, deltas: { ...deltas, [USDC]: '10200001' } } };
    expect(verifyTokenDiffIntent(tampered)).toBe(false);
    expect(verifyTokenDiffIntent({ ...signed, deadlineMs: deadlineMs + 1 })).toBe(false);
    expect(verifyTokenDiffIntent({ ...signed, nonce: Buffer.alloc(32, 1).toString('base64') })).toBe(false);
    expect(verifyTokenDiffIntent(signed, fake.publicKeyOf('other.mock'))).toBe(false);
    expect(verifyTokenDiffIntent({ ...signed, signature: 'garbage' })).toBe(false);
  });

  it('builds the canonical message: fixed key order, sorted diff keys, ISO deadline', () => {
    const msg = canonicalTokenDiffMessage('a.mock', { z: '1', a: '-1' }, deadlineMs);
    expect(msg).toBe('{"signer_id":"a.mock","deadline":"2030-01-01T00:00:00.000Z","intents":[{"intent":"token_diff","diff":{"a":"-1","z":"1"}}]}');
    const payload = buildTokenDiffPayload({ accountId: 'a.mock', deltas: {} }, deadlineMs, Buffer.alloc(32).toString('base64'));
    expect(payload.recipient).toBe('intents.near');
    expect(() => buildTokenDiffPayload({ accountId: 'a.mock', deltas: {} }, deadlineMs, 'AAAA')).toThrow(/32 bytes/);
  });

  it('signature is deterministic for a given key and nonce (ed25519)', async () => {
    const fake = new InMemoryIntents();
    const nonce = Buffer.alloc(32, 7).toString('base64');
    const a = await fake.signTokenDiff({ accountId: 'c.mock', deltas, deadlineMs, nonce });
    const b = await fake.signTokenDiff({ accountId: 'c.mock', deltas, deadlineMs, nonce });
    expect(a.signature).toBe(b.signature);
    expect(signTokenDiffPayload).toBeTypeOf('function');
  });
});
