import type { AppEnv } from '../../core/tokens';

/**
 * `SNAPSHOTS=on|off`; unset → on, except under NODE_ENV=test so unit tests never touch the dev database. Snapshots and
 * the ledger journal persist together (a restore replays the journal up to the snapshot's tick).
 */
export function persistenceEnabled(env: AppEnv): boolean {
  return env.SNAPSHOTS === 'on' || (env.SNAPSHOTS !== 'off' && env.NODE_ENV !== 'test');
}
