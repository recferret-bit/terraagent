import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { EnvSection } from '@terra/config';

export interface DiscoveredModule {
  readonly name: string;
  readonly module: new () => object;
  readonly env?: EnvSection;
}

const isEnvSection = (v: unknown): v is EnvSection => typeof v === 'object' && v !== null && 'schema' in v && 'name' in v;

/** Finds every `<dir>/<name>/<name>.module.ts` (or `.js`), sorted by name; folders without one are skipped. */
export async function discoverModules(dir: string): Promise<DiscoveredModule[]> {
  const found: DiscoveredModule[] = [];
  const names = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  for (const name of names) {
    const file = ['ts', 'js'].map((x) => join(dir, name, `${name}.module.${x}`)).find(existsSync);
    if (!file) continue;
    const exports = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, unknown>;
    const cls = Object.entries(exports).find(([k, v]) => k.endsWith('Module') && typeof v === 'function')?.[1];
    if (!cls) throw new Error(`${file} must export a Nest module class named *Module`);
    found.push({ name, module: cls as new () => object, env: isEnvSection(exports.env) ? exports.env : undefined });
  }
  return found;
}
