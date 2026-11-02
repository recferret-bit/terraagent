import { describe, expect, it } from 'vitest';
import { deriveAccountName, isReservedAccountName } from '../../src/near/identity/account-name';

const LABEL = /^[a-z0-9-]{2,32}$/;
const RESERVED = ['relayer', 'minter', 'npc', 'admin', 'root', 'system', 'near', 'intents', 'terraagent'] as const;

describe('deriveAccountName', () => {
  it('turns "Test Pilot!" into test-pilot', () => {
    expect(deriveAccountName('Test Pilot!')).toBe('test-pilot');
  });

  it('turns "relayer" into relayer-1', () => {
    expect(deriveAccountName('relayer')).toBe('relayer-1');
  });

  it('truncates a 40-character name to 32', () => {
    expect(deriveAccountName('a'.repeat(40))).toBe('a'.repeat(32));
    expect(deriveAccountName('a'.repeat(40))).toHaveLength(32);
  });

  it('does not leave a guild-trader label starting with guild-', () => {
    const name = deriveAccountName('guild-trader');
    expect(name.startsWith('guild-')).toBe(false);
    expect(name).toBe('trader');
  });

  it('uses pilot for an empty string and for "!!"', () => {
    expect(deriveAccountName('')).toBe('pilot');
    expect(deriveAccountName('!!')).toBe('pilot');
  });

  it('suffixes every exact reserved name and drops a guild- prefix before that', () => {
    for (const reserved of RESERVED) {
      expect(isReservedAccountName(reserved)).toBe(true);
      expect(deriveAccountName(reserved)).toBe(`${reserved}-1`);
      expect(deriveAccountName(`guild-${reserved}`)).toBe(`${reserved}-1`);
    }
    expect(isReservedAccountName('guild-trader')).toBe(true);
    expect(isReservedAccountName('test-pilot')).toBe(false);
  });

  it('strips a hyphen left by the 32-character cut', () => {
    expect(deriveAccountName(`${'b'.repeat(31)}!${'c'.repeat(10)}`)).toBe('b'.repeat(31));
  });

  it('returns a legal unreserved label', () => {
    for (const raw of ['Test Pilot!', 'relayer', 'a'.repeat(40), 'guild-trader', '', '!!', 'guild-guild-trader']) {
      const name = deriveAccountName(raw);
      expect(name).toMatch(LABEL);
      expect(name.startsWith('guild-')).toBe(false);
      expect(isReservedAccountName(name)).toBe(false);
    }
  });
});
