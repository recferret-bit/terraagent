import { CLOSE_CODES } from '@terra/contracts';

/** What the client does after a close (CLIENT §6.3). */
export type CloseAction = 'reconnect' | 'reconnect-once' | 'terminal';

/** `bad_hello` and `forbidden` retry once (fresh token / re-resolve), a repeat within 30 s is terminal. */
export const REPEAT_WINDOW_MS = 30_000;

export function closeAction(code: number): CloseAction {
  switch (code) {
    case CLOSE_CODES.replaced:
    case CLOSE_CODES.planet_ended:
    case CLOSE_CODES.colony_eliminated:
      return 'terminal';
    case CLOSE_CODES.bad_hello:
    case CLOSE_CODES.forbidden:
      return 'reconnect-once';
    default:
      return 'reconnect'; // 4012 server_restarting, 1000/1001/1006, unknown
  }
}

export const TERMINAL_TEXT: Record<number, string> = {
  [CLOSE_CODES.replaced]: 'Playing elsewhere',
  [CLOSE_CODES.planet_ended]: 'This planet has ended',
  [CLOSE_CODES.colony_eliminated]: 'Your colony was eliminated',
  [CLOSE_CODES.bad_hello]: "Couldn't join colony",
  [CLOSE_CODES.forbidden]: "Couldn't join colony",
};
