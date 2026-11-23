/**
 * Next fire time of an interval schedule: the middle of the next `everyMs` slot of the wall clock, so every instance
 * fires into the same slot and a database clock up to half a slot off still counts it in that slot.
 */
export function slotNext(everyMs: number): (fromMs: number) => number {
  const every = Math.max(2, everyMs);
  const half = Math.floor(every / 2);
  return (fromMs) => {
    const mid = fromMs - (fromMs % every) + half;
    return mid > fromMs ? mid : mid + every;
  };
}

/**
 * The one local timer of a schedule: arms the next occurrence from `next`, fires, re-arms. For an interval schedule
 * every instance fires once per slot and the adapter's throttle slot (`floor(now / everyMs)`) keeps only the first
 * job, so the work runs once per interval across the cluster.
 */
export class ScheduleTrigger {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  constructor(
    private readonly next: (fromMs: number) => number | null,
    private readonly fire: () => Promise<unknown>,
    private readonly onError: (err: unknown) => void = () => undefined,
    private readonly now: () => number = () => Date.now(),
  ) {}

  start(): void {
    this.stopped = false;
    this.arm();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private arm(): void {
    if (this.stopped) return;
    const at = this.next(this.now());
    if (at === null) return;
    // setTimeout caps at 2^31-1 ms; an occurrence further away re-arms on the way.
    this.timer = setTimeout(() => {
      if (this.now() + 5 < at) return this.arm();
      void this.fire().catch(this.onError).finally(() => this.arm());
    }, Math.min(2 ** 31 - 1, Math.max(0, at - this.now())));
    this.timer.unref?.();
  }
}
