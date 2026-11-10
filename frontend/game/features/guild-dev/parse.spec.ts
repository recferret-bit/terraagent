import { describe, expect, it } from 'vitest';
import { parseGuildDevLine } from './parse';

describe('W15-28 dev console parse', () => {
  it('accepts guild.summon kestrel', () => {
    expect(parseGuildDevLine('guild.summon kestrel')).toEqual({ name: 'guild.summon', npc: 'kestrel' });
    expect(parseGuildDevLine('guild.depart vanguard')).toEqual({ name: 'guild.depart', npc: 'vanguard' });
    expect(parseGuildDevLine('away.simulate off')).toEqual({ name: 'away.simulate', on: false });
    expect(parseGuildDevLine('director.allowance 600')).toEqual({ name: 'director.allowance', resource: 'metals.t1', amount: 600 });
    expect(parseGuildDevLine('director.allowance minerals.t1 40')).toEqual({
      name: 'director.allowance', resource: 'minerals.t1', amount: 40,
    });
  });

  it('rejects a missing npc, away.simulate maybe, and a negative amount', () => {
    expect(() => parseGuildDevLine('guild.summon')).toThrow(/missing <npc>/);
    expect(() => parseGuildDevLine('away.simulate maybe')).toThrow(/on\|off/);
    expect(() => parseGuildDevLine('guild.setInventory kestrel metals.t1 -1')).toThrow(/0 or more/);
    expect(() => parseGuildDevLine('director.allowance -1')).toThrow(/0 or more/);
    expect(() => parseGuildDevLine('guild.summon osprey')).toThrow(/unknown npc "osprey"/);
  });
});
