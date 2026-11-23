import type { IncomingMessage } from 'node:http';
import { CoreException } from '../../core/errors/core-exception.js';
import { nearAdapterFor } from '../infrastructure/adapter-selection.js';

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);
const LOCAL_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const DEV_APP_ENVS = new Set(['development', 'dev', 'local', 'test']);

function stripHostPort(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return '';
  if (trimmed.startsWith('[')) {
    const closeIdx = trimmed.indexOf(']');
    if (closeIdx < 0) return '';
    const host = trimmed.slice(1, closeIdx);
    const rest = trimmed.slice(closeIdx + 1);
    if (rest && !/^:\d+$/.test(rest)) return '';
    return host;
  }
  const firstColon = trimmed.indexOf(':');
  const lastColon = trimmed.lastIndexOf(':');
  if (firstColon !== -1 && firstColon === lastColon) {
    const host = trimmed.slice(0, firstColon);
    const port = trimmed.slice(firstColon + 1);
    return /^\d+$/.test(port) ? host : '';
  }
  return trimmed;
}

/** True only for loopback hostnames (`localhost`, `127.0.0.1`, `::1`, with optional `:port`). */
export function isLoopbackHost(rawHost: string | undefined): boolean {
  if (typeof rawHost !== 'string') return false;
  const host = stripHostPort(rawHost);
  return host.length > 0 && LOCAL_HOSTNAMES.has(host);
}

/** True only for loopback IPv4/IPv6 addresses (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`). */
export function isLoopbackIp(rawIp: string | undefined): boolean {
  if (typeof rawIp !== 'string') return false;
  let ip = rawIp.trim().toLowerCase();
  if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1);
  return LOCAL_IPS.has(ip);
}

/** True only for `http:` / `https:` URLs whose hostname is loopback. */
export function isLoopbackUrlOrigin(rawUrl: string | undefined): boolean {
  if (typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed === 'null') return false;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return isLoopbackHost(parsed.hostname);
  } catch {
    return false;
  }
}

function headerValues(raw: string | string[] | undefined): string[] {
  if (raw === undefined) return [];
  const items = Array.isArray(raw) ? raw : [raw];
  return items
    .flatMap((v) => v.split(','))
    .map((s) => s.trim())
    .filter(Boolean);
}

function unquoteHeaderToken(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function assertLoopbackForwardedHeader(raw: string | string[] | undefined): void {
  const entries = headerValues(raw);
  if (entries.length === 0) {
    throw new CoreException('FORBIDDEN', { status: 403, message: 'Local mock sign-in is only allowed on localhost.' });
  }
  for (const entry of entries) {
    let sawIdentityParam = false;
    for (const part of entry.split(';')) {
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      const key = part.slice(0, eq).trim().toLowerCase();
      const val = unquoteHeaderToken(part.slice(eq + 1));
      if (key === 'for') {
        sawIdentityParam = true;
        const ip = stripHostPort(val);
        if (!isLoopbackIp(ip)) {
          throw new CoreException('FORBIDDEN', { status: 403, message: 'Local mock sign-in is only allowed on localhost.' });
        }
      } else if (key === 'host') {
        sawIdentityParam = true;
        if (!isLoopbackHost(val)) {
          throw new CoreException('FORBIDDEN', { status: 403, message: 'Local mock sign-in is only allowed on localhost.' });
        }
      }
    }
    if (!sawIdentityParam) {
      throw new CoreException('FORBIDDEN', { status: 403, message: 'Local mock sign-in is only allowed on localhost.' });
    }
  }
}

/**
 * Fail-closed environment gate for localhost mock login/signup:
 * - Requires `NODE_ENV` to be `'development'` or `'test'`
 * - Rejects non-local `VITE_APP_ENV` (`production`, `prod`, `staging`, `preview`, etc.)
 * - Rejects `TA_ALLOW_LOCAL_MOCK_AUTH=false|0`
 * - Rejects `NEAR_MODE=mainnet` or `NEAR_ADAPTER_IDENTITY=mainnet`
 */
export function assertLocalMockEnvAllowed(
  env: Readonly<Record<string, unknown>> | undefined,
  fallbackEnv?: Readonly<Record<string, string | undefined>>,
): void {
  const hasExplicitEnv = env !== undefined;
  const source = (env ?? fallbackEnv ?? process.env) as Readonly<Record<string, unknown>>;
  if (!hasExplicitEnv && process.env.NODE_ENV === 'production') {
    throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
  }
  const nodeEnv = typeof source.NODE_ENV === 'string' ? source.NODE_ENV.trim().toLowerCase() : '';
  if (nodeEnv !== 'development' && nodeEnv !== 'test') {
    throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
  }
  const viteAppEnv = typeof source.VITE_APP_ENV === 'string' ? source.VITE_APP_ENV.trim().toLowerCase() : '';
  if (viteAppEnv.length > 0 && !DEV_APP_ENVS.has(viteAppEnv)) {
    throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
  }
  const toggle =
    typeof source.TA_ALLOW_LOCAL_MOCK_AUTH === 'string'
      ? source.TA_ALLOW_LOCAL_MOCK_AUTH.trim().toLowerCase()
      : '';
  if (toggle === 'false' || toggle === '0') {
    throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
  }
  const envMap = source as Readonly<Record<string, string | undefined>>;
  const nearMode = typeof envMap.NEAR_MODE === 'string' ? envMap.NEAR_MODE.trim().toLowerCase() : '';
  if (nearMode === 'mainnet' || nearAdapterFor('Identity', envMap) === 'mainnet') {
    throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
  }
}

/** Fail-closed HTTP request gate: requires loopback remote IP, Host, Origin/Referer, and proxy headers. */
export function assertLocalhostRequest(req: IncomingMessage | undefined): void {
  const deny = (): never => {
    throw new CoreException('FORBIDDEN', { status: 403, message: 'Local mock sign-in is only allowed on localhost.' });
  };
  if (!req) throw deny();
  if (!isLoopbackIp(req.socket?.remoteAddress)) deny();
  const hostHeader = Array.isArray(req.headers.host) ? req.headers.host[0] : req.headers.host;
  if (!isLoopbackHost(hostHeader)) deny();

  if (req.headers['x-forwarded-host'] !== undefined) {
    const vals = headerValues(req.headers['x-forwarded-host']);
    if (vals.length === 0 || vals.some((v) => !isLoopbackHost(v))) deny();
  }
  if (req.headers['x-forwarded-for'] !== undefined) {
    const vals = headerValues(req.headers['x-forwarded-for']);
    if (vals.length === 0 || vals.some((v) => !isLoopbackIp(v))) deny();
  }
  if (req.headers['x-real-ip'] !== undefined) {
    const vals = headerValues(req.headers['x-real-ip']);
    if (vals.length === 0 || vals.some((v) => !isLoopbackIp(v))) deny();
  }
  if (req.headers.forwarded !== undefined) {
    assertLoopbackForwardedHeader(req.headers.forwarded);
  }
  if (req.headers.origin !== undefined) {
    const origin = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin;
    if (!isLoopbackUrlOrigin(origin)) deny();
  }
  if (req.headers.referer !== undefined) {
    const referer = Array.isArray(req.headers.referer) ? req.headers.referer[0] : req.headers.referer;
    if (!isLoopbackUrlOrigin(referer)) deny();
  }
}
