import type { PlanetState } from '../kernel/state';

/** Ledger account of a colony's stockpile. */
export function colonyAccount(colonyIndex: number): string {
  return `colony:${colonyIndex}`;
}

/** The colony index of a `colony:<n>` account, or -1. */
export function colonyIndexOfAccount(account: string): number {
  const m = /^colony:(\d+)$/.exec(account);
  return m ? Number(m[1]) : -1;
}

/** System accounts (`sys:*`) are the sources and sinks of the economy and may go negative; colonies may not. */
export function isSystemAccount(account: string): boolean {
  return account.startsWith('sys:');
}

/** Actor for a change caused by a colony's own order: its player when known, else the colony. */
export function colonyActor(state: PlanetState, colonyIndex: number): string {
  const playerId = state.colonies[colonyIndex]?.playerId;
  return typeof playerId === 'string' && playerId.length > 0 ? `player:${playerId}` : `colony:${colonyIndex}`;
}

/** Actor for a change caused by a sim system (`system:terraform`, `system:landing`, …). */
export function systemActor(system: string): string {
  return `system:${system}`;
}

/** Actor for dev-console changes. */
export const DEV_ACTOR = 'dev:console';
