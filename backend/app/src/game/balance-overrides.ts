import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileData, parseOverrides, type BalanceOverrides } from '@terra/sim';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/**
 * Reads `TA_BALANCE_OVERRIDES` (D-35): a `balance.overrides.json` in design units, relative paths resolved against the repo
 * root. Unset = no overrides. A missing/invalid file or an unknown table/row/field throws an error naming the file, so the
 * app does not boot on numbers it cannot apply.
 */
export function loadBalanceOverrides(path: string | undefined, flags: readonly string[]): BalanceOverrides {
  if (!path) return {};
  const file = isAbsolute(path) ? path : resolve(REPO_ROOT, path);
  try {
    const overrides = parseOverrides(JSON.parse(readFileSync(file, 'utf8')) as unknown, 'overrides');
    compileData(new Set(flags), overrides); // validates every table/row/field/type
    return overrides;
  } catch (e) {
    throw new Error(`TA_BALANCE_OVERRIDES ${file}: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
}
