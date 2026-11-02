import type { AppEnv } from './tokens';

type EnvView = Pick<AppEnv, 'NODE_ENV' | 'DATABASE_URL'> & { readonly SNAPSHOTS?: unknown };

/**
 * Whether the core stores (players, sessions) use Postgres: always, except under `NODE_ENV=test` without an explicit
 * `DATABASE_URL` (unit tests never touch the dev database). Chosen once at construction: a store never falls back to
 * memory on a database error (the error propagates and maps to 500/409).
 */
export function databaseEnabled(env: EnvView | undefined): boolean {
  return !env || env.NODE_ENV !== 'test' || Boolean(env.DATABASE_URL);
}

/**
 * `SNAPSHOTS=on|off`; unset → on, except under NODE_ENV=test so unit tests never touch the dev database. Snapshots, the
 * ledger journal and the colony/planet rows persist together: a colony row whose planet is not saved would point at a
 * world that is regenerated without it after a restart (BE-14).
 */
export function persistenceEnabled(env: EnvView): boolean {
  return env.SNAPSHOTS === 'on' || (env.SNAPSHOTS !== 'off' && env.NODE_ENV !== 'test');
}
