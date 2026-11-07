/**
 * One socket's `market.*` push filter (LED-25). Default is "all pairs of the planet" so clients that never subscribe keep
 * working; the first `market.subscribe` switches to an explicit pair list. Unsubscribing from the default state opts out of
 * everything (an exclusion list is not kept: the client re-subscribes the pairs it wants).
 */
export class MarketTopics {
  /** `undefined` = every pair. */
  private pairs: Set<string> | undefined;

  wants(pair: string): boolean {
    return this.pairs === undefined || this.pairs.has(pair);
  }

  subscribe(pairs: readonly string[]): void {
    this.pairs ??= new Set();
    for (const p of pairs) this.pairs.add(p);
  }

  /** Removes `pairs`; without `pairs` (or from the default state) no pair is sent any more. */
  unsubscribe(pairs?: readonly string[]): void {
    if (pairs === undefined || this.pairs === undefined) { this.pairs = new Set(); return; }
    for (const p of pairs) this.pairs.delete(p);
  }

  reset(): void {
    this.pairs = undefined;
  }
}
