import { parseWaves } from '@terra/contracts';
import { compileData, dataRow } from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { rawLogExpired, readRawRetentionDays, redactSecrets } from '../../src/ai/audit/redact';

const DAY_MS = 86_400_000;

describe('redactSecrets', () => {
  it('keeps injected secrets out of stored text', () => {
    const stored = redactSecrets('note sk-live-SECRETVALUE and NEAR_AI_API_KEY=supersecret Bearer abc.def');
    expect(stored).not.toContain('SECRETVALUE');
    expect(stored).not.toContain('supersecret');
    expect(stored).not.toContain('abc.def');
    expect(stored).toContain('[redacted]');
  });
});

describe('rawLogExpired', () => {
  it('keeps a raw row for 13 days and expires it at the data-row day count', () => {
    // Decision audit is a different retention (30 days). rawLogExpired does not delete it.
    const rawDays = readRawRetentionDays();
    expect(dataRow(compileData(parseWaves('..16')), 'director', 'retention').rawDays).toBe(14);
    expect(rawDays).toBe(14);
    const now = 20 * DAY_MS;
    expect(rawLogExpired(now - 13 * DAY_MS, now, rawDays)).toBe(false);
    expect(rawLogExpired(now - 14 * DAY_MS, now, rawDays)).toBe(true);
  });
});
