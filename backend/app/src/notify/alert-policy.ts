import { UNDER_ATTACK_DEBOUNCE_S, type NotificationKind } from '@terra/contracts';

/** Wall-clock window. An attack at exactly this many ms after the last send is allowed again. */
const UNDER_ATTACK_WINDOW_MS = UNDER_ATTACK_DEBOUNCE_S * 1000;

/**
 * Per-colony on/off for the eight kinds. A missing colony or kind is on (CT-36).
 * The map is process memory: a restart turns every kind back on (BE-58).
 */
export class AlertToggles {
  private readonly off = new Map<string, ReadonlySet<NotificationKind>>();

  allows(colonyId: string, kind: NotificationKind): boolean {
    return !this.off.get(colonyId)?.has(kind);
  }

  set(colonyId: string, kind: NotificationKind, on: boolean): void {
    const next = new Set(this.off.get(colonyId));
    if (on) next.delete(kind);
    else next.add(kind);
    if (next.size === 0) this.off.delete(colonyId);
    else this.off.set(colonyId, next);
  }
}

/**
 * Leading-edge debounce per colony. The stamp is the last send, not a suppressed attack,
 * so an attack inside the window does not push the next one out.
 */
export class UnderAttackWindow {
  private readonly sentAtMs = new Map<string, number>();

  /** True when this send should proceed. Records it before the port call (the bus does not await). */
  open(colonyId: string, nowMs: number): boolean {
    const prev = this.sentAtMs.get(colonyId);
    if (prev !== undefined && nowMs - prev < UNDER_ATTACK_WINDOW_MS) return false;
    this.sentAtMs.set(colonyId, nowMs);
    return true;
  }
}
