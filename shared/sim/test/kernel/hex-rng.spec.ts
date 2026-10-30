import { describe, expect, it } from 'vitest';
import { hexCount, hexIndex, hexDistance, axialToPlane, planeToAxial, seedRng, nextU32 } from '../../src';

describe('hex grid', () => {
  it('radius 56 has 9 577 tiles and indexOf inverts the coordinate tables', () => {
    expect(hexCount(56)).toBe(9577);
    const h = hexIndex(56);
    for (let i = 0; i < h.count; i += 37) expect(h.indexOf(h.q[i], h.r[i])).toBe(i);
    expect(h.indexOf(57, 0)).toBe(-1);
    expect(hexDistance(0, 0, h.q[0], h.r[0])).toBe(56);
  });
  it('plane round trip', () => {
    for (const [q, r] of [[0, 0], [3, -2], [-5, 7]]) expect(planeToAxial(...axialToPlane(q, r))).toEqual([q, r]);
  });
});

describe('rng streams', () => {
  it('are independent and reproducible', () => {
    const a = seedRng('x'), b = seedRng('x');
    const seqA = [nextU32(a.gen), nextU32(a.gen)], seqB = [nextU32(b.gen), nextU32(b.gen)];
    expect(seqA).toEqual(seqB);
    expect(nextU32(a.combat)).not.toBe(seqA[0]);
  });
});
