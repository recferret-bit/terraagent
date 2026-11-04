import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { directorBoot } from '../src/main.js';

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name.endsWith('.ts')) out.push(readFileSync(path, 'utf8'));
  }
  return out;
}

describe('W16-29 director boundary', () => {
  it('boots alone and does not import the game app or a database client', () => {
    expect(directorBoot()).toEqual({ ok: true, role: 'director', gameDb: 'none' });
    const text = sources(join(import.meta.dirname, '../src')).join('\n');
    expect(text).not.toContain('backend/app');
    expect(text).not.toContain('@terra/app');
    expect(text).not.toContain('prisma');
    expect(text).not.toContain('@prisma/client');
  });
});
