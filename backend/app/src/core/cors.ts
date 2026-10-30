import type { AppEnv } from './tokens';

const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;

/** CORS allow-list from `CORS_ORIGINS` (comma-separated); outside production loopback origins on any port are allowed too. */
export function corsOrigin(env: Pick<AppEnv, 'CORS_ORIGINS' | 'NODE_ENV'>) {
  const list = (env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const allowLocal = env.NODE_ENV !== 'production';
  return (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) =>
    cb(null, !origin || list.includes(origin) || (allowLocal && LOCAL.test(origin)));
}
