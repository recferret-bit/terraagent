interface Pending {
  readonly planetId: string;
  resolve(v: unknown): void;
  reject(e: Error): void;
}

/**
 * Request/reply bookkeeping for main → thread requests answered by `reqId` (`fullState`, `tune`, `landingSite`): one
 * timeout per request, and every request of a planet (or all of them) can be failed at once when the planet or its
 * thread goes down.
 */
export class ThreadRequests {
  private readonly pending = new Map<number, Pending>();
  private nextReq = 1;

  /**
   * Sends a request through `send(reqId)` (false: the planet is not loaded or its thread is dead → rejected at once)
   * and resolves with the reply passed to {@link answer}, or rejects after `timeoutMs` (`<label> timeout for <planet>`).
   */
  ask<T>(planetId: string, label: string, timeoutMs: number, send: (reqId: number) => boolean): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const reqId = this.nextReq++;
      const timer = setTimeout(() => { this.pending.delete(reqId); reject(new Error(`${label} timeout for ${planetId}`)); }, timeoutMs);
      const done = () => { clearTimeout(timer); this.pending.delete(reqId); };
      this.pending.set(reqId, { planetId, resolve: (v) => { done(); resolve(v as T); }, reject: (e) => { done(); reject(e); } });
      if (!send(reqId)) this.pending.get(reqId)?.reject(new Error(`planet ${planetId} is not loaded`));
    });
  }

  answer(reqId: number, value: unknown): void {
    this.pending.get(reqId)?.resolve(value);
  }

  /** Fails every request of `planetId`, or every request when `planetId` is undefined. */
  failAll(e: Error, planetId?: string): void {
    for (const p of [...this.pending.values()]) if (planetId === undefined || p.planetId === planetId) p.reject(e);
  }
}
