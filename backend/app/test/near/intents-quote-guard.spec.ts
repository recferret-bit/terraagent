import { describe, expect, it } from 'vitest';
import { guardQuoteRequest, resolveQuoteDry } from '../../src/near/infrastructure/dev/intents-quote-guard';

const MAIN = { NEAR_MODE: 'mainnet', NEAR_ALLOW_MAINNET: '1' };
const body = { originAsset: 'nep141:wrap.near', destinationAsset: 'nep141:usdc.near', amount: '10000000' };

describe('intents quote guard (Q-007)', () => {
  it('mainnet + allow + dry:false + confirm -> live', () => {
    expect(resolveQuoteDry({ dry: false, confirmMainnet: true }, MAIN)).toBe(false);
    expect(guardQuoteRequest({ ...body, dry: false, confirmMainnet: true }, MAIN).dry).toBe(false);
  });
  it('stays dry without confirm, without dry:false, or without the allow flag', () => {
    expect(resolveQuoteDry({ dry: false }, MAIN)).toBe(true);
    expect(resolveQuoteDry({ confirmMainnet: true }, MAIN)).toBe(true);
    expect(resolveQuoteDry({ dry: false, confirmMainnet: true }, { NEAR_MODE: 'mainnet' })).toBe(true);
  });
  it('testnet / mock / unset + confirm -> still dry', () => {
    for (const NEAR_MODE of ['testnet', 'mock', 'devnet', undefined])
      expect(resolveQuoteDry({ dry: false, confirmMainnet: true }, { NEAR_MODE, NEAR_ALLOW_MAINNET: '1' })).toBe(true);
  });
  it('passes the atomic amount through unscaled and defaults to dry', () => {
    const r = guardQuoteRequest(body, {});
    expect(r).toMatchObject({ amount: '10000000', dry: true, originAsset: body.originAsset });
  });
  it('assets are optional (legacy amount-only callers)', () => {
    expect(guardQuoteRequest({ amount: '1' }, {})).toMatchObject({ amount: '1', dry: true });
  });
  it('rejects non-integer, human-decimal, negative, missing and non-object bodies with 400 VALIDATION_ERROR', () => {
    for (const raw of [{ ...body, amount: '10.00' }, { ...body, amount: '-5' }, { ...body, amount: '1e6' }, { ...body, amount: 10 }, {}, null, 'x'])
      expect(() => guardQuoteRequest(raw, {}), JSON.stringify(raw)).toThrowError(expect.objectContaining({ errorCode: 'VALIDATION_ERROR', status: 400 }));
  });
});
