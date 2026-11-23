import type { IncomingHttpHeaders } from 'node:http';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const LOOPBACK_REMOTES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);
const LOCAL_APP_ENVS = new Set(['development', 'dev', 'local', 'test']);

function stripBrackets(value: string): string {
  return value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
}

function extractHostName(hostSegment: string): string {
  const trimmed = hostSegment.trim().toLowerCase();
  if (!trimmed) return '';
  if (trimmed.startsWith('[')) {
    const close = trimmed.indexOf(']');
    return close > 1 ? trimmed.slice(1, close) : '';
  }
  const firstColon = trimmed.indexOf(':');
  if (firstColon >= 0 && firstColon === trimmed.lastIndexOf(':')) {
    return trimmed.slice(0, firstColon);
  }
  return trimmed;
}

function joinHeaderStrings(val: string | string[] | undefined): string {
  if (Array.isArray(val)) return val.join(',');
  return typeof val === 'string' ? val : '';
}

function allSegmentsMatch(raw: string, predicate: (seg: string) => boolean): boolean | null {
  const parts = raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  if (parts.length === 0) return null;
  return parts.every(predicate);
}

/**
 * True only when every present network signal (`remoteAddress`, `X-Forwarded-For`,
 * `X-Forwarded-Host`, `Host`, and `Origin`) targets local loopback (`localhost` / `127.0.0.1` / `::1`).
 * Never returns early on `Host: localhost` alone, preventing header-spoofing from non-local clients.
 */
export function isLocalRequestHeaders(
  headers: IncomingHttpHeaders | undefined,
  remoteAddress?: string | undefined,
): boolean {
  if (headers === undefined && remoteAddress === undefined) return true;
  let sawLoopback = false;

  if (typeof remoteAddress === 'string' && remoteAddress.trim().length > 0) {
    const remote = stripBrackets(remoteAddress.trim().toLowerCase());
    if (!LOOPBACK_REMOTES.has(remote)) return false;
    sawLoopback = true;
  }

  const xffOk = allSegmentsMatch(joinHeaderStrings(headers?.['x-forwarded-for']), (seg) =>
    LOOPBACK_REMOTES.has(stripBrackets(seg.toLowerCase())),
  );
  if (xffOk === false) return false;
  if (xffOk === true) sawLoopback = true;

  const xfhOk = allSegmentsMatch(joinHeaderStrings(headers?.['x-forwarded-host']), (seg) =>
    LOOPBACK_HOSTS.has(extractHostName(seg)),
  );
  if (xfhOk === false) return false;
  if (xfhOk === true) sawLoopback = true;

  const hostOk = allSegmentsMatch(joinHeaderStrings(headers?.host), (seg) =>
    LOOPBACK_HOSTS.has(extractHostName(seg)),
  );
  if (hostOk === false) return false;
  if (hostOk === true) sawLoopback = true;

  const origin = joinHeaderStrings(headers?.origin).trim();
  if (origin.length > 0) {
    try {
      const parsed = new URL(origin);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
      if (!LOOPBACK_HOSTS.has(stripBrackets(parsed.hostname.toLowerCase()))) return false;
      sawLoopback = true;
    } catch {
      return false;
    }
  }

  return sawLoopback;
}

/** Spectator mode is strictly restricted to non-production local environments on loopback hosts. */
export function isSpectatorEnvAllowed(
  env: { readonly NODE_ENV?: string; readonly APP_ENV?: unknown } | undefined,
  headers?: IncomingHttpHeaders | undefined,
  remoteAddress?: string | undefined,
): boolean {
  if (env?.NODE_ENV === 'production') return false;
  const appEnv = typeof env?.APP_ENV === 'string' ? env.APP_ENV.trim().toLowerCase() : '';
  if (appEnv.length > 0 && !LOCAL_APP_ENVS.has(appEnv)) return false;
  return isLocalRequestHeaders(headers, remoteAddress);
}
