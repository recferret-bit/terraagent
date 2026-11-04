import { describe, expect, it } from 'vitest';
import { directorLine } from '../src/cli.js';

describe('W16-46 director process', () => {
  it('prints a ready line without opening a game database', () => {
    expect(directorLine(['node', 'cli.ts', '--check'])).toBe('director director up db=none');
  });
});
