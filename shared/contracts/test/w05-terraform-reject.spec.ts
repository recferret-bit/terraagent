import { describe, expect, it } from 'vitest';
import { REJECT_CODES, RejectCode, parseCommandArgs } from '../src';

const ok = (args: unknown): boolean => parseCommandArgs('enqueueTask', args).success;

describe('W05 terraform contract validation', () => {
  it('lists the typed terraform reject reasons once each', () => {
    for (const c of ['already_terraformed', 'already_queued', 'already_at_target']) {
      expect(RejectCode.safeParse(c).success).toBe(true);
      expect(REJECT_CODES.filter((x) => x === c)).toHaveLength(1);
    }
  });

  it('accepts a well-formed terraform stroke', () => {
    expect(ok({ terraform: { op: 'grade', tiles: [{ q: 1, r: 2 }] } })).toBe(true);
  });

  it('refuses malformed terraform input', () => {
    expect(ok({ terraform: { op: 'explode', tiles: [{ q: 1, r: 2 }] } })).toBe(false);
    expect(ok({ terraform: { op: 'grade', tiles: [] } })).toBe(false);
    expect(ok({ terraform: { op: 'grade', tiles: Array.from({ length: 257 }, () => ({ q: 0, r: 0 })) } })).toBe(false);
    expect(ok({ terraform: { op: 'grade', tiles: [{ q: 0.5, r: 0 }] } })).toBe(false);
    expect(ok({ terraform: { op: 'grade', tiles: [{ q: 40000, r: 0 }] } })).toBe(false);
    expect(ok({ terraform: { op: 'grade', tiles: [{ q: 0, r: 0 }], extra: true } })).toBe(false);
  });
});
