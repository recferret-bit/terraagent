import { resolveClientFlags } from '../../core/flags';

export type OnlineMode = 'boot' | 'scenario' | 'host';

/**
 * Determines whether `/play.html` runs the online/boot flow or the prototype world-picker (`null`).
 * - Prototype mode (`null`):
 *   - `?planet=dune|oceanForest|forestRock` (or `?autodeploy=` / `?menutime=`)
 *   - `?host=local` without `?scenario=` (prototype world picker)
 *   - `!flags.has('W01')` (e.g. `?waves=..00`) without `?scenario=`, `?join=` or `?host=`
 * - W00 / join online mode (`'scenario'` | `'host'`):
 *   - `?join=<planetId>`
 *   - `?scenario=w00*` or `!flags.has('W01')` with `?scenario=` / `?host=`
 * - W01 automatic boot flow (`'boot'`):
 *   - Default on `/play.html` when `flags.has('W01')` (including `?scenario=w01*` or `?host=local&scenario=w01*`)
 */
export function onlineMode(search: string): OnlineMode | null {
  const q = new URLSearchParams(search);
  if (q.has('planet') || q.has('autodeploy') || q.has('menutime')) return null;
  if (q.has('join')) return 'scenario';
  const host = q.get('host');
  const scenario = q.get('scenario')?.trim().toLowerCase() ?? null;
  if (host === 'local' && !scenario) return null;

  const { flags } = resolveClientFlags({ search, dev: true });
  const hasW01 = flags.has('W01');

  if (scenario) {
    // w00 and w09 are landed dev planets. They skip the drop-pod boot, which hides the HUD until an HQ deploys.
    if (!hasW01 || scenario.startsWith('w00') || scenario === 'w09' || scenario.startsWith('w09-')) return 'scenario';
    return 'boot';
  }
  if (q.has('host')) {
    return hasW01 ? 'boot' : 'host';
  }
  return hasW01 ? 'boot' : null;
}
