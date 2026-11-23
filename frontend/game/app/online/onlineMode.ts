import { isProductionBuild } from '../../core/buildEnv';
import { resolveClientFlags } from '../../core/flags';

export type OnlineMode = 'boot' | 'scenario' | 'host';

const LOCAL_SPECTATOR_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export interface SpectatorEnvOptions {
  readonly location?: Pick<Location, 'hostname' | 'protocol'> | null;
  readonly mode?: string;
  readonly prod?: boolean;
  readonly appEnv?: string;
}

/** True only for loopback hostnames (`localhost`, `127.0.0.1`, `::1`, `[::1]`). */
export function isLocalSpectatorHostname(hostname: string | undefined): boolean {
  if (typeof hostname !== 'string') return false;
  let clean = hostname.trim().toLowerCase();
  if (clean.startsWith('[') && clean.endsWith(']')) clean = clean.slice(1, -1);
  return LOCAL_SPECTATOR_HOSTS.has(clean);
}

/**
 * Spectator mode (`?spectator=1`) is strictly local-only:
 * disabled in production/staging builds and disabled on any non-loopback origin.
 */
export function isLocalSpectatorAllowed(opts?: SpectatorEnvOptions): boolean {
  if (isProductionBuild(opts?.mode, opts?.prod, opts?.appEnv)) return false;
  const loc = opts?.location !== undefined ? opts.location : (typeof location !== 'undefined' ? location : null);
  if (!loc) return true;
  if (loc.protocol !== 'http:' && loc.protocol !== 'https:') return false;
  return isLocalSpectatorHostname(loc.hostname);
}

/** True when URL requests zero-player spectator mode (`/play.html?spectator=1` or `?scenario=spectator`) on localhost. */
export function isSpectatorSearch(search: string, envOpts?: SpectatorEnvOptions): boolean {
  if (!isLocalSpectatorAllowed(envOpts)) return false;
  const q = new URLSearchParams(search);
  const spec = q.get('spectator')?.trim().toLowerCase();
  const mode = q.get('mode')?.trim().toLowerCase();
  const scenario = q.get('scenario')?.trim().toLowerCase();
  return spec === '1' || spec === 'true' || mode === 'spectator' || scenario === 'spectator';
}

/** True when URL requests wiping existing spectator bots & restarting from scratch (`&reset=1` / `&reset=true` / `&reset`). */
export function isSpectatorResetSearch(search: string): boolean {
  const q = new URLSearchParams(search);
  if (!q.has('reset')) return false;
  const v = q.get('reset')?.trim().toLowerCase() ?? '';
  return v === '' || v === '1' || v === 'true';
}

/**
 * Strips one-shot `reset` parameter from the browser address bar once consumed so a subsequent reload
 * or returning after restarting the dev stack resumes persisted bots instead of wiping them again.
 */
export function stripSpectatorResetFromUrl(
  loc: Pick<Location, 'pathname' | 'search' | 'hash'> | undefined = typeof location !== 'undefined' ? location : undefined,
  replaceUrl?: (nextUrl: string) => void,
): boolean {
  if (!loc || !isSpectatorResetSearch(loc.search)) return false;
  const q = new URLSearchParams(loc.search);
  q.delete('reset');
  const qs = q.toString();
  const nextUrl = `${loc.pathname}${qs ? `?${qs}` : ''}${loc.hash ?? ''}`;
  if (replaceUrl) replaceUrl(nextUrl);
  else if (typeof history !== 'undefined' && typeof history.replaceState === 'function') {
    history.replaceState(null, '', nextUrl);
  }
  return true;
}

/**
 * Determines whether `/play.html` runs the online/boot flow or the prototype world-picker (`null`).
 * - Spectator URL (`?spectator=1` / `?scenario=spectator` / `?mode=spectator`, local dev only):
 *   - With `?join=<planetId>` or `?host=server`: `'scenario'` (read-only WS spectator of a backend planet)
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
export function onlineMode(search: string, envOpts?: SpectatorEnvOptions): OnlineMode | null {
  const q = new URLSearchParams(search);
  const prod = isProductionBuild(envOpts?.mode, envOpts?.prod, envOpts?.appEnv);
  if (isSpectatorSearch(search, envOpts)) {
    return q.has('join') || q.get('host') === 'server' ? 'scenario' : 'host';
  }
  if (prod) {
    return q.has('planet') ? null : 'boot';
  }
  if (q.has('planet') || q.has('autodeploy') || q.has('menutime')) return null;
  if (q.has('join')) return 'scenario';
  const host = q.get('host');
  const rawScenario = q.get('scenario')?.trim().toLowerCase() ?? null;
  const scenario = rawScenario === 'spectator' ? null : rawScenario;
  if (host === 'local' && !scenario) return null;

  const { flags } = resolveClientFlags({ search, dev: !prod });
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
