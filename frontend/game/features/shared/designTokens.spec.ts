import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const FEATURES_DIR = fileURLToPath(new URL('..', import.meta.url));
const DESIGN_CSS_DIR = fileURLToPath(new URL('../../../design/css', import.meta.url));

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name);
    if (d.isDirectory()) return d.name === 'node_modules' ? [] : cssFiles(p);
    return d.name.endsWith('.css') ? [p] : [];
  });
}

const defined = (css: string): Set<string> => new Set([...css.matchAll(/(--ta-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
const used = (css: string): Set<string> => new Set([...css.matchAll(/var\(\s*(--ta-[a-z0-9-]+)/g)].map((m) => m[1]));

describe('design tokens (FF-21)', () => {
  it('every var(--ta-*) used by the feature CSS exists in the design system (or is defined in the same file)', () => {
    const tokens = new Set(cssFiles(DESIGN_CSS_DIR).flatMap((f) => [...defined(readFileSync(f, 'utf8'))]));
    expect(tokens.has('--ta-chamfer-s')).toBe(true);
    const missing: string[] = [];
    for (const file of cssFiles(FEATURES_DIR)) {
      const css = readFileSync(file, 'utf8');
      const local = defined(css);
      for (const v of used(css)) if (!tokens.has(v) && !local.has(v)) missing.push(`${file.slice(FEATURES_DIR.length)}: ${v}`);
    }
    expect(missing).toEqual([]);
  });

  it('feature CSS never rounds corners and never hard-codes a design-system font (FF-31)', () => {
    const offenders: string[] = [];
    for (const file of cssFiles(FEATURES_DIR)) {
      const css = readFileSync(file, 'utf8');
      if (/border-radius\s*:\s*(?!0[;\s])/.test(css)) offenders.push(`${file.slice(FEATURES_DIR.length)}: border-radius`);
      for (const font of ['IBM Plex Mono', 'IBM Plex Sans', 'Chakra Petch']) {
        if (new RegExp(`font(-family)?\\s*:[^;]*${font}`).test(css)) offenders.push(`${file.slice(FEATURES_DIR.length)}: ${font}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
