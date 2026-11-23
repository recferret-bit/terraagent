import { resolveClientFlags } from '../../core/flags';

export type OnlineMode = 'boot' | 'scenario' | 'host';

/** True when URL requests zero-player spectator mode (`/play.html?spectator=1` or `?scenario=spectator`). */
export function isSpectatorSearch(search: string): boolean {
  const q = new URLSearchParams(search);
  const spec = q.get('spectator')?.trim().toLowerCase();
  const mode = q.get('mode')?.trim().toLowerCase();
  const scenario = q.get('scenario')?.trim().toLowerCase();
  return spec === '1' || spec === 'true' || mode === 'spectator' || scenario === 'spectator';
}

/**
 * Determines whether `/play.html` runs the online/boot flow or the prototype world-picker (`null`).
 * - Spectator URL (`?spectator=1` / `?scenario=spectator` / `?mode=spectator`):
 *   - With `?join=<planetId>`: `'scenario'` (read-only WS spectator of a backend planet)
 *   - Otherwise: `'host'` (immediate local zero-player bot-only planet)
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
  if (isSpectatorSearch(search)) {
    return q.has('join') || q.get('host') === 'server' ? 'scenario' : 'host';
  }
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
