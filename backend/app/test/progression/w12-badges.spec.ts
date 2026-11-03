// Achievement Badge Art and Preview Suite (W12-23)
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACHIEVEMENTS, ACHIEVEMENT_FAMILIES } from '@terra/contracts';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
const BADGES_DIR = join(ROOT, 'frontend/public/img/achievements');
const PREVIEW_FILE = join(ROOT, 'frontend/design/achievements/preview.html');
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('W12-23 Achievement Badge Generator', () => {
  it('verifies that all 60 unlocked achievement SVGs exist and are valid', () => {
    expect(ACHIEVEMENTS).toHaveLength(60);
    for (const a of ACHIEVEMENTS) {
      const file = join(BADGES_DIR, `${a.id}.svg`);
      expect(existsSync(file), `Missing SVG: ${file}`).toBe(true);
      const content = readFileSync(file, 'utf8');
      expect(content).toContain('<svg');
      expect(content).toContain('viewBox="0 0 1024 1024"');
      expect(content).toContain('TERRAAGENT');
      expect(content).toContain(a.name.toUpperCase());
    }
  });

  it('verifies that all 60 locked achievement SVGs exist with silhouette styling', () => {
    for (const a of ACHIEVEMENTS) {
      const file = join(BADGES_DIR, `${a.id}-locked.svg`);
      expect(existsSync(file), `Missing locked SVG: ${file}`).toBe(true);
      const content = readFileSync(file, 'utf8');
      expect(content).toContain('<svg');
      expect(content).toContain('viewBox="0 0 1024 1024"');
      expect(content).toContain('(locked)');
      expect(content).toContain('opacity=".45"');
    }
  });

  it('verifies that all 60 badge PNG files exist with valid PNG signature and 1024x1024 IHDR', () => {
    for (const a of ACHIEVEMENTS) {
      const file = join(BADGES_DIR, `${a.id}.png`);
      expect(existsSync(file), `Missing PNG: ${file}`).toBe(true);
      const buf = readFileSync(file);
      expect(buf.subarray(0, 8).equals(PNG_SIG), `Invalid PNG signature for ${file}`).toBe(true);
      expect(buf.subarray(12, 16).toString('ascii')).toBe('IHDR');
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      expect(width).toBe(1024);
      expect(height).toBe(1024);
    }
  });

  it('verifies that preview.html contains all 20 families and 60 badges', () => {
    expect(existsSync(PREVIEW_FILE), `Missing preview.html: ${PREVIEW_FILE}`).toBe(true);
    const html = readFileSync(PREVIEW_FILE, 'utf8');
    expect(html).toContain('tokens.css');
    expect(html).toContain('base.css');

    for (const fam of ACHIEVEMENT_FAMILIES) {
      expect(html).toContain(fam.name);
      expect(html).toContain(fam.glyph);
    }

    for (const a of ACHIEVEMENTS) {
      expect(html).toContain(a.id);
      expect(html).toContain(`${a.id}.svg`);
      expect(html).toContain(`${a.id}-locked.svg`);
      expect(html).toContain(`${a.id}.png`);
    }
  });
});
