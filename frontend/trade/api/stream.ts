import { TradeStreamEvent } from '@terra/contracts';
import { backoffDelay, createSseParser } from '../model/sse';
import type { ConnState } from '../model/state';
import type { FetchFn } from './client';

export interface StreamHandlers {
  onEvent(e: TradeStreamEvent): void;
  onState(s: ConnState, attempt: number): void;
}

/**
 * SSE over `fetch` (an `EventSource` cannot send the bearer header). Reconnects with exponential backoff + jitter; `no_colony`
 * (the caller has no colony on the planet: 4xx) is terminal and not retried. `close()` stops everything.
 */
export class TradeStream {
  private ctl: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private closed = false;

  constructor(private readonly url: string, private readonly headers: Record<string, string>, private readonly h: StreamHandlers, private readonly doFetch: FetchFn = (i, init) => fetch(i, init)) {}

  start(): void { this.closed = false; void this.run(); }

  close(): void {
    this.closed = true;
    this.ctl?.abort();
    if (this.timer) clearTimeout(this.timer);
    this.h.onState('offline', 0);
  }

  private async run(): Promise<void> {
    if (this.closed) return;
    this.ctl = new AbortController();
    this.h.onState(this.attempt === 0 ? 'connecting' : 'reconnecting', this.attempt);
    try {
      const res = await this.doFetch(this.url, { headers: { accept: 'text/event-stream', ...this.headers }, signal: this.ctl.signal });
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        this.h.onState(res.status === 401 ? 'offline' : 'no_colony', 0);
        return;
      }
      if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
      this.attempt = 0;
      this.h.onState('live', 0);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      const parser = createSseParser();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const data of parser.push(dec.decode(value, { stream: true }))) this.dispatch(data);
      }
    } catch {
      if (this.closed) return;
    }
    if (this.closed) return;
    this.attempt += 1;
    this.h.onState('reconnecting', this.attempt);
    this.timer = setTimeout(() => { void this.run(); }, backoffDelay(this.attempt - 1));
  }

  private dispatch(data: string): void {
    try {
      const parsed = TradeStreamEvent.safeParse(JSON.parse(data));
      if (parsed.success) this.h.onEvent(parsed.data);
    } catch { /* a malformed frame is skipped */ }
  }
}
