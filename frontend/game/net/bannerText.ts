import { STILL_TRYING_AFTER_MS } from './backoff';
import { TERMINAL_TEXT } from './closeCodes';
import type { ConnectionState } from './types';

/** Banner text for a connection state, or null when nothing should show (CLIENT §6). */
export function bannerText(s: ConnectionState, nowMs: number): string | null {
  if (s.phase === 'terminal') return TERMINAL_TEXT[s.code ?? 0] ?? 'Disconnected';
  if (s.downSinceMs === null) return s.phase === 'connecting' || s.phase === 'resolving' ? 'Connecting…' : null;
  if (s.phase === 'welcomed' || s.phase === 'streaming') return null;
  return nowMs - s.downSinceMs >= STILL_TRYING_AFTER_MS ? 'Reconnecting… still trying' : 'Reconnecting…';
}
