/** Product analytics client (CLIENT §10): consent-gated, batched, no third parties. Pure logic; browser wiring is in index.ts. */
export type PropValue = string | number | boolean | null;
export type Props = Record<string, PropValue>;

export const ANALYTICS_ENDPOINT = '/v1/analytics/events';
export const BATCH_MAX = 20;
export const FLUSH_MS = 10_000;
const MAX_QUEUE = 200;
const NAME_RE = /^[a-z][a-z0-9_]{1,63}$/;

interface QueuedEvent { name: string; ts: number; props: Props }

export interface AnalyticsDeps {
  /** Consent source of truth (cookie in the browser). */
  readConsent(): boolean;
  writeConsent(allowed: boolean): void;
  /** Returns the anonymous id, creating and persisting it on first call; `clearAnonId` deletes it. */
  anonId(): string;
  clearAnonId(): void;
  newSessionId(): string;
  fetch(url: string, init: { method: 'POST'; headers: Record<string, string>; body: string; keepalive: boolean }): Promise<unknown>;
  /** Returns false when the browser refused to queue the beacon. */
  sendBeacon(url: string, body: string): boolean;
  now(): number;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export class AnalyticsClient {
  private queue: QueuedEvent[] = [];
  private timer: unknown;
  private sessionId: string | undefined;

  constructor(private readonly d: AnalyticsDeps) {
    if (d.readConsent()) this.start();
  }

  getConsent(): boolean {
    return this.d.readConsent();
  }

  setConsent(allowed: boolean): void {
    this.d.writeConsent(allowed);
    if (allowed) this.start();
    else this.stop();
  }

  /** No-op without consent. Invalid names are dropped (the server would reject the whole batch). */
  track(name: string, props: Props = {}): void {
    if (!this.d.readConsent() || !NAME_RE.test(name)) return;
    this.queue.push({ name, ts: this.d.now(), props });
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
    if (this.queue.length >= BATCH_MAX) void this.flush();
  }

  /** Sends everything queued (in batches of 20). `unloading` uses sendBeacon so the page can close. */
  async flush(unloading = false): Promise<void> {
    if (!this.d.readConsent()) {
      this.queue = [];
      return;
    }
    while (this.queue.length > 0) {
      const events = this.queue.splice(0, BATCH_MAX);
      const body = JSON.stringify({ anonId: this.d.anonId(), sessionId: this.sessionId ?? (this.sessionId = this.d.newSessionId()), events });
      if (unloading && this.d.sendBeacon(ANALYTICS_ENDPOINT, body)) continue;
      try {
        await this.d.fetch(ANALYTICS_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true });
      } catch {
        // analytics must never disturb the game; the batch is dropped
      }
    }
  }

  /** `pagehide` handler. */
  onPageHide(): void {
    void this.flush(true);
  }

  private start(): void {
    this.sessionId ??= this.d.newSessionId();
    this.timer ??= this.d.setInterval(() => void this.flush(), FLUSH_MS);
  }

  private stop(): void {
    if (this.timer !== undefined) this.d.clearInterval(this.timer);
    this.timer = undefined;
    this.queue = [];
    this.sessionId = undefined;
    this.d.clearAnonId();
  }
}
