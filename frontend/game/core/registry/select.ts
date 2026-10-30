import type { Feature, LoadOptions } from './types';

/** Pure filter + sort: drops disabled waves and features of the other host (`hostOnly`); sorted by id. */
export function selectFeatures(all: readonly Feature[], opts: LoadOptions): Feature[] {
  return all
    .filter((f) => opts.flags.has(f.wave) && (!f.hostOnly || f.hostOnly === opts.host))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Accepts either `export default defineFeature(...)` modules. Throws on duplicate ids. */
export function collectFeatures(mods: Record<string, { default?: Feature }>): Feature[] {
  const seen = new Set<string>();
  const out: Feature[] = [];
  for (const [path, mod] of Object.entries(mods)) {
    const f = mod.default;
    if (!f) throw new Error(`feature module ${path} has no default export`);
    if (seen.has(f.id)) throw new Error(`duplicate feature id "${f.id}" (${path})`);
    seen.add(f.id);
    out.push(f);
  }
  return out;
}
