import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** One adapter for one port. `kind` is the selection value it answers to (`mock`, `testnet`, `mainnet`, `zai`, `live`). */
export interface AdapterDef {
  readonly port: abstract new () => object;
  readonly kind: string;
  readonly useClass: new (...args: never[]) => object;
}

/** Declares an adapter. Adapter files `export const adapter = adapterOf({...})` (one or several exports per file). */
export const adapterOf = (def: AdapterDef): AdapterDef => def;

const isAdapterDef = (v: unknown): v is AdapterDef =>
  typeof v === 'object' && v !== null && typeof (v as AdapterDef).port === 'function' && typeof (v as AdapterDef).kind === 'string' && typeof (v as AdapterDef).useClass === 'function';

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) yield* walk(join(dir, e.name));
    else if (/\.adapter\.(ts|js)$/.test(e.name)) yield join(dir, e.name);
  }
}

/**
 * Imports every `**\/*.adapter.ts` under `dir` (sorted, like module discovery) and collects its exported `AdapterDef`s.
 * A missing folder yields none. A later wave adds an adapter by dropping a file here; no binding module is edited.
 */
export async function discoverAdapters(dir: string): Promise<AdapterDef[]> {
  if (!existsSync(dir)) return [];
  const out: AdapterDef[] = [];
  for (const file of [...walk(dir)].sort()) {
    const exports = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, unknown>;
    const defs = Object.values(exports).filter(isAdapterDef);
    if (!defs.length) throw new Error(`${file} must export an adapterOf({ port, kind, useClass }) definition`);
    out.push(...defs);
  }
  return out;
}
