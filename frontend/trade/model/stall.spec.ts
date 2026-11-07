import { describe, expect, it } from 'vitest';
import type { TradeStallResponse } from '@terra/contracts';
import { earnedLines, parseFeePercent, stallErrorText, stallLockReason } from './stall';

const stall: TradeStallResponse = { planetId: 'p', hubFeeBp: 100, minBp: 0, maxBp: 100, defaultBp: 100, earned: { USDC: '100000' } };

describe('stall fee editor model', () => {
  it('parses a percentage into whole bp inside the range', () => {
    expect(parseFeePercent('0.5', 0, 100)).toEqual({ bp: 50 });
    expect(parseFeePercent('1,00', 0, 100)).toEqual({ bp: 100 });
    expect(parseFeePercent(' 0 ', 0, 100)).toEqual({ bp: 0 });
  });
  it('rejects malformed and out-of-range input with a message', () => {
    expect(parseFeePercent('1.01', 0, 100)).toMatchObject({ error: expect.stringContaining('0.00 % to 1.00 %') });
    expect(parseFeePercent('abc', 0, 100)).toHaveProperty('error');
    expect(parseFeePercent('0.555', 0, 100)).toHaveProperty('error');
    expect(parseFeePercent('', 0, 100)).toHaveProperty('error');
  });
  it('maps stable error codes to text', () => {
    expect(stallErrorText('fee_out_of_range', { minBp: 0, maxBp: 100 })).toContain('1.00 %');
    expect(stallErrorText('forbidden_scope')).toContain('API key');
    expect(stallErrorText('weird')).toContain('weird');
  });
  it('locks for API keys and without a hub, with a reason', () => {
    expect(stallLockReason('dev:a', stall)).toBeNull();
    expect(stallLockReason('ta_bot_k1_secret', stall)).toContain('API key');
    expect(stallLockReason('dev:a', null)).toContain('No Trade Hub');
  });
  it('lists earned fees per token as mock amounts, skipping zero', () => {
    expect(earnedLines(stall.earned)).toEqual(['0.10 mock USDC']);
    expect(earnedLines({ USDC: '0' })).toEqual([]);
  });
});
