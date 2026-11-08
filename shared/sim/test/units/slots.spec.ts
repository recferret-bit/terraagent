import { describe, expect, it } from 'vitest';
import { hexDistance } from '../../src';
import { assignSlots, hexLine, ringCoords } from '../../src/units/movement/slots';

describe('group march slot rings', () => {
  it('puts the middle of the group on the anchor and keeps each flank on its own side', () => {
    const units = [
      { id: 10, q: 0, r: 0 },
      { id: 11, q: 2, r: 0 },
      { id: 12, q: 4, r: 0 },
    ];
    const { slots, overflow } = assignSlots({ q: 16, r: 0 }, units, () => true, { maxRing: 2 });
    const at = (id: number) => slots.find((slot) => slot.id === id)!;
    expect(overflow).toEqual([]);
    expect(at(11)).toEqual({ id: 11, q: 16, r: 0 });
    expect(at(10).q).toBeLessThan(16);
    expect(at(12).q).toBeGreaterThan(16);
    expect(ringCoords(0, 0, 1).slice(0, 2)).toEqual([[1, 0], [1, -1]]);
  });

  it('keeps a north-south line from being folded onto an east-west arc', () => {
    const units = [
      { id: 1, q: 0, r: -3 },
      { id: 2, q: 0, r: 0 },
      { id: 3, q: 0, r: 3 },
    ];
    const { slots } = assignSlots({ q: 0, r: 0 }, units, () => true, { maxRing: 3 });
    const at = (id: number) => slots.find((slot) => slot.id === id)!;
    expect(at(2)).toEqual({ id: 2, q: 0, r: 0 });
    expect(at(1).r).toBeLessThan(0);
    expect(at(3).r).toBeGreaterThan(0);
    expect(Math.abs(at(1).q)).toBeLessThanOrEqual(Math.abs(at(1).r));
    expect(Math.abs(at(3).q)).toBeLessThanOrEqual(Math.abs(at(3).r));
  });

  it('does not depend on the order the units are listed', () => {
    const units = [
      { id: 4, q: 1, r: -2 },
      { id: 1, q: -2, r: 1 },
      { id: 3, q: 0, r: 0 },
    ];
    const first = assignSlots({ q: 8, r: -3 }, units, () => true, { maxRing: 3 });
    const reversed = assignSlots({ q: 8, r: -3 }, [...units].reverse(), () => true, { maxRing: 3 });
    expect(reversed).toEqual(first);
    expect(new Set(first.slots.map((slot) => `${slot.q},${slot.r}`)).size).toBe(first.slots.length);
  });

  it('skips a blocked anchor and still seats by place, not by id', () => {
    const blocked = new Set(['0,0', '1,0']);
    const units = [
      { id: 2, q: 5, r: 0 },
      { id: 1, q: -4, r: 0 },
    ];
    const { slots } = assignSlots({ q: 0, r: 0 }, units, (q, r) => !blocked.has(`${q},${r}`));
    const west = slots.find((slot) => slot.id === 1)!;
    const east = slots.find((slot) => slot.id === 2)!;
    expect(west.q).toBeLessThan(east.q);
    expect(slots.some((slot) => slot.q === 0 && slot.r === 0)).toBe(false);
    expect(slots.some((slot) => slot.q === 1 && slot.r === 0)).toBe(false);
  });

  it('returns the same tiles for the same inputs and overflows the highest ids when the disk is full', () => {
    const open = new Set(['0,0', '1,0']);
    const isFree = (q: number, r: number) => open.has(`${q},${r}`);
    const units = [
      { id: 3, q: 0, r: 0 },
      { id: 1, q: 0, r: 0 },
      { id: 2, q: 0, r: 0 },
      { id: 4, q: 0, r: 0 },
    ];
    const first = assignSlots({ q: 0, r: 0 }, units, isFree, { maxRing: 3 });
    const second = assignSlots({ q: 0, r: 0 }, units, isFree, { maxRing: 3 });
    expect(second).toEqual(first);
    expect(first.slots.map((slot) => slot.id).sort((a, b) => a - b)).toEqual([1, 2]);
    expect(first.overflow).toEqual([3, 4]);
    expect(new Set(first.slots.map((slot) => `${slot.q},${slot.r}`)).size).toBe(first.slots.length);
  });
});

describe('hex lines used to sit down', () => {
  it('steps through neighbours and lands on the goal', () => {
    const goals: Array<[number, number]> = [
      [0, 0],
      [5, 0],
      [0, -4],
      [-3, 3],
      [3, -2],
      [2, 2],
      [-4, -1],
    ];
    for (const [q, r] of goals) {
      const line = hexLine({ q: 0, r: 0 }, { q, r });
      expect(line[0]).toEqual({ q: 0, r: 0 });
      expect(line[line.length - 1]).toEqual({ q, r });
      expect(line.length).toBe(hexDistance(0, 0, q, r) + 1);
      for (let i = 1; i < line.length; i++) {
        expect(hexDistance(line[i - 1].q, line[i - 1].r, line[i].q, line[i].r)).toBe(1);
      }
    }
  });
});
