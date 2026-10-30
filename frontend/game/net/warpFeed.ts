import type { ServerMessage } from '@terra/contracts';

/** Dev time warp carried by a server message: `welcome.warp` (absent = 1) or a `dev.warp` event; undefined for anything else. */
export function warpOfMessage(m: ServerMessage): number | undefined {
  if (m.t === 'welcome') return m.d.warp ?? 1;
  if (m.t === 'event' && m.d.kind === 'dev.warp') {
    const k = (m.d.data as { k?: unknown }).k;
    return typeof k === 'number' && Number.isInteger(k) && k >= 1 ? k : undefined;
  }
  return undefined;
}
