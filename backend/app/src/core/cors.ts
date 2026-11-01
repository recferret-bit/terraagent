import { catalogOrigins } from '../../../../infra/hosts/load-catalog.mjs';
import type { AppEnv } from './tokens';

const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;

const splitOrigins = (raw: string | undefined) => (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);

/** Catalog hosts (`http://`) union `CORS_ORIGINS`. Outside production, loopback on any port is allowed too. */
export function corsOrigin(env: Pick<AppEnv, 'CORS_ORIGINS' | 'NODE_ENV'>) {
  const list = new Set([...catalogOrigins(), ...splitOrigins(env.CORS_ORIGINS)]);
  const allowLocal = env.NODE_ENV !== 'production';
  return (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) =>
    cb(null, !origin || list.has(origin) || (allowLocal && LOCAL.test(origin)));
}
