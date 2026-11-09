import type { NotificationKind } from '@terra/contracts';
import type { Notification } from '../ports/notifier.port.js';

export interface HeldAlert {
  readonly colonyId: string;
  readonly kind: NotificationKind;
  readonly note: Notification;
}

/**
 * One send per colony and kind. `under_attack` is one kind, so raids whose sim ticks span hours
 * still collapse to the first note (the same leading edge as the 10-minute debounce).
 */
export function collapseFastRunAlerts(list: readonly HeldAlert[]): Notification[] {
  const seen = new Set<string>();
  const out: Notification[] = [];
  for (const item of list) {
    const key = `${item.colonyId}\0${item.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item.note);
  }
  return out;
}

/** Notifications routed while a planet is inside its restart fast-run (CT-54). */
export class FastRunAlertHold {
  private readonly running = new Set<string>();
  private readonly buf = new Map<string, HeldAlert[]>();

  begin(planetId: string): void {
    this.running.add(planetId);
    if (!this.buf.has(planetId)) this.buf.set(planetId, []);
  }

  holding(planetId: string | undefined): boolean {
    return planetId !== undefined && this.running.has(planetId);
  }

  push(planetId: string, alert: HeldAlert): void {
    this.buf.get(planetId)?.push(alert);
  }

  /** Ends the run and returns the collapsed notes. Empty when nothing was held. */
  flush(planetId: string): Notification[] {
    this.running.delete(planetId);
    const list = this.buf.get(planetId) ?? [];
    this.buf.delete(planetId);
    return collapseFastRunAlerts(list);
  }

  /** Ends the run and drops the buffer (the catch-up stopped before `fastRan`). */
  drop(planetId: string): void {
    this.running.delete(planetId);
    this.buf.delete(planetId);
  }
}
