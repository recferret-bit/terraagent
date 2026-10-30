import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { PortContract } from '../../src/near/__contract__/harness';

// Contracts differ in port and helper types; the runner only uses them through the untyped adapter factory.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyContract = PortContract<any, any>;

/** Folders holding `<port>.contract.ts` suites: NEAR ports, and the app-level LLM / notifier ports. */
export const CONTRACT_DIRS = [
  fileURLToPath(new URL('../../src/near/__contract__/', import.meta.url)),
  fileURLToPath(new URL('../../src/ports/__contract__/', import.meta.url)),
];

/** Imports every `*.contract.ts` in the folders (sorted) and returns its exported `contract`. Missing folders yield none. */
export async function discoverContracts(dirs: readonly string[] = CONTRACT_DIRS): Promise<{ file: string; contract: AnyContract }[]> {
  const out: { file: string; contract: AnyContract }[] = [];
  for (const dir of dirs) {
    let names: string[];
    try { names = readdirSync(dir).filter((n) => n.endsWith('.contract.ts')).sort(); } catch { continue; }
    for (const name of names) {
      const mod = (await import(/* @vite-ignore */ pathToFileURL(dir + name).href)) as { contract?: AnyContract };
      if (!mod.contract) throw new Error(`${dir}${name} must export \`contract\` (defineNearContract / PortContract)`);
      out.push({ file: dir + name, contract: mod.contract });
    }
  }
  return out;
}
