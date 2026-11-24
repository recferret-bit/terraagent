import { CLOSE_CODES } from '@terra/contracts';

/** What the client does after a close (CLIENT §6.3). */
export type CloseAction = 'reconnect' | 'reconnect-once' | 'terminal';

/** `bad_hello` and `forbidden` retry once (fresh token / re-resolve), a repeat within 30 s is terminal. */
export const REPEAT_WINDOW_MS = 30_000;

/**
 * `bye 4003 not_your_planet` (WS-12): the planet is not the one of the player's own live colony. Retrying the same
 * join cannot succeed, so it is terminal at once and shown; any other `4003` (token expired, planet not loaded) retries.
 */
export const NOT_YOUR_PLANET = 'not_your_planet';
export const SPECTATOR_LOCAL_ONLY = 'spectator_local_only';
/** `bye 4000 unsupported_proto`: the app speaks a newer ws protocol than this page; only a reload can fix it. */
export const UNSUPPORTED_PROTO = 'unsupported_proto';

export function closeAction(code: number, reason = ''): CloseAction {
  switch (code) {
    case CLOSE_CODES.replaced:
    case CLOSE_CODES.planet_ended:
    case CLOSE_CODES.colony_eliminated:
      return 'terminal';
    case CLOSE_CODES.forbidden:
      return reason === NOT_YOUR_PLANET || reason === SPECTATOR_LOCAL_ONLY ? 'terminal' : 'reconnect-once';
    case CLOSE_CODES.bad_hello:
      return reason === UNSUPPORTED_PROTO ? 'terminal' : 'reconnect-once';
    default:
      return 'reconnect'; // 4012 server_restarting / planet_down (the planet restarts), 1000/1001/1006, unknown
  }
}

const TERMINAL_TEXT: Record<number, string> = {
  [CLOSE_CODES.replaced]: 'Playing elsewhere',
  [CLOSE_CODES.planet_ended]: 'This planet has ended',
  [CLOSE_CODES.colony_eliminated]: 'Your colony was eliminated',
  [CLOSE_CODES.bad_hello]: "Couldn't join colony",
  [CLOSE_CODES.forbidden]: "Couldn't join colony",
};

/** The banner text of a terminal close: by reason where the reason says more than the code, else by code. */
export function terminalText(code: number | undefined, reason: string | undefined): string {
  if (code === CLOSE_CODES.forbidden && reason === NOT_YOUR_PLANET) return "Not your colony's planet";
  if (code === CLOSE_CODES.forbidden && reason === SPECTATOR_LOCAL_ONLY) return 'Spectator mode is local-only';
  if (code === CLOSE_CODES.bad_hello && reason === UNSUPPORTED_PROTO) return 'Game updated. Reload to continue';
  return TERMINAL_TEXT[code ?? 0] ?? 'Disconnected';
}
