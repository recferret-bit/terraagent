import { namedAccountOpId } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { labelChoices, NamedAccountBook, nextFreeLabel } from '../../src/near/identity/account-allocate';

describe('nextFreeLabel', () => {
  it('keeps a free base and starts collisions at -2, never -1', () => {
    expect(nextFreeLabel('test-pilot', () => false)).toBe('test-pilot');
    expect(nextFreeLabel('test-pilot', (label) => label === 'test-pilot')).toBe('test-pilot-2');
    const choices = labelChoices('test-pilot');
    expect(choices[0]).toBe('test-pilot');
    expect(choices[1]).toBe('test-pilot-2');
    expect(choices).not.toContain('test-pilot-1');
  });

  it('fits a numeric suffix into 32 characters', () => {
    const base = 'a'.repeat(32);
    expect(nextFreeLabel(base, (label) => label === base)).toBe(`${'a'.repeat(30)}-2`);
  });
});

describe('NamedAccountBook', () => {
  it('gives colliding names -2 then -3, and a repeated opId does not take another suffix', () => {
    const book = new NamedAccountBook();
    const a = namedAccountOpId('google', 'subj-a');
    const b = namedAccountOpId('google', 'subj-b');
    const c = namedAccountOpId('google', 'subj-c');

    expect(book.allocate(a, 'test-pilot')).toBe('test-pilot.terraagent.mock');
    expect(book.allocate(b, 'test-pilot')).toBe('test-pilot-2.terraagent.mock');
    expect(book.allocate(a, 'other-name')).toBe('test-pilot.terraagent.mock');
    expect(book.allocate(c, 'test-pilot')).toBe('test-pilot-3.terraagent.mock');
  });
});
