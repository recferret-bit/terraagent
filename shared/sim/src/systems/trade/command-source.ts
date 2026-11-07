import type { CommandReject, SimCommand } from '../../kernel/commands';

/**
 * Who may send which market command (W13). The wire enum of `SimCommandV1.source` lives in `shared/contracts`; `'bot'` is
 * a bot-operated colony authenticated by the backend bot API (ActorKind `bot`). Until the contract enum lists it, the host
 * schema drops it, so the check is made against this constant, not a literal union member.
 *  - `market.placeOrder` / `market.cancelOrder`: `player` or `bot` (a bot must re-quote, so it may cancel its own orders).
 *  - `market.setHubFee`: `player` only (a bot never changes a stall rate).
 *  - `market.reserve` / `release` / `settled`: module sources only (`system`, `near`, `admin`, `dev`); never `player`, `bot` or `ai`.
 */
export const BOT_SOURCE = 'bot';

const MODULE_SOURCES: readonly string[] = ['system', 'near', 'admin', 'dev'];

/** True for commands of the market module itself (not of an acting colony). */
export const isModuleSource = (cmd: SimCommand): boolean => MODULE_SOURCES.includes(cmd.source as string);

/**
 * Authorizes the acting side of a client-style market command. Players act on `colonyIndex` (default 0, like cargo); a bot
 * must name its colony explicitly (an integer `colonyIndex`), so a missing index can never fall back to colony 0.
 * Returns `undefined` when allowed.
 */
export function authorizeMarketActor(cmd: SimCommand, allowBot: boolean): 'not_authorized' | CommandReject | undefined {
  const source = cmd.source as string;
  if (source === 'player') return undefined;
  if (allowBot && source === BOT_SOURCE) {
    return typeof cmd.colonyIndex === 'number' && Number.isInteger(cmd.colonyIndex) && cmd.colonyIndex >= 0
      ? undefined
      : { code: 'invalid_args', detail: 'A bot command must name its colonyIndex.' };
  }
  return 'not_authorized';
}
