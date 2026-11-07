/** Server-sent-event framing and reconnect backoff, pure so they can be tested without a network. */

export interface SseParser { push(chunk: string): string[] }

/** Splits a text stream into the `data:` payloads of complete events (comments / heartbeats `: ping` are dropped). */
export function createSseParser(): SseParser {
  let buf = '';
  return {
    push(chunk: string): string[] {
      buf += chunk.replace(/\r\n/g, '\n');
      const out: string[] = [];
      let at: number;
      while ((at = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, at);
        buf = buf.slice(at + 2);
        const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
        if (data) out.push(data);
      }
      return out;
    },
  };
}

export interface BackoffOptions { readonly baseMs?: number; readonly maxMs?: number; readonly jitter?: number }

/** Exponential delay for the n-th consecutive failure (0 based), capped; `random` in [0,1) adds up to `jitter` of the delay. */
export function backoffDelay(attempt: number, opt: BackoffOptions = {}, random: () => number = Math.random): number {
  const base = opt.baseMs ?? 1000;
  const max = opt.maxMs ?? 30_000;
  const raw = Math.min(max, base * 2 ** Math.min(attempt, 16));
  return Math.round(raw + raw * (opt.jitter ?? 0.25) * random());
}

/** Wire-level connection label for the status chip. */
export function connLabel(conn: string, attempt = 0): string {
  switch (conn) {
    case 'live': return 'LIVE';
    case 'connecting': return 'CONNECTING';
    case 'reconnecting': return `RECONNECTING${attempt > 0 ? ` (try ${attempt})` : ''}`;
    case 'no_colony': return 'NO COLONY ON THIS PLANET';
    default: return 'OFFLINE';
  }
}
