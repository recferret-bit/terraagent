import { pushNotification } from '../notifications/notificationStore';
import { makeBtn } from '../shared/dom';
import { GuildVisitMemory, type GuildArrivalToastInput, type GuildDepartureToastInput } from './lines';

export const DEFAULT_GUILD_TOAST_DURATION_MS = 8000;

export interface GuildToastHooks {
  /** Read on each push so a live flag set that drops W15 stops further toasts. */
  enabled(): boolean;
  /** Arrival tap: open the Trade Hub. Departure taps only dismiss. */
  openTrade(): void;
  /** Optional custom auto-dismiss duration in ms. */
  durationMs?: number;
}

/** Plates for `guild.arrived` / `guild.departed`. Not the sim event log: those pushes are not `SimEventWire`. */
export class GuildToastHost {
  private readonly memory = new GuildVisitMemory();
  private readonly root: HTMLElement;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(
    parent: HTMLElement,
    private readonly hooks: GuildToastHooks,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'ta-guild-toasts';
    this.root.dataset.testid = 'guild-toasts';
    this.root.setAttribute('role', 'status');
    this.root.setAttribute('aria-live', 'polite');
    this.root.hidden = true;
    parent.appendChild(this.root);
  }

  arrive(payload: GuildArrivalToastInput): string | null {
    const line = this.memory.docked(payload, this.hooks.enabled());
    if (line) {
      this.show(line, true);
      pushNotification({
        category: 'guild',
        title: 'Guild Trader Docked',
        message: line,
        dedupeKey: `guild-arrived:${payload.shipId}:${payload.departAt}`,
        onSelect: () => this.hooks.openTrade(),
      });
    }
    return line;
  }

  depart(payload: GuildDepartureToastInput): string | null {
    const line = this.memory.departed(payload, this.hooks.enabled());
    if (line) {
      this.show(line, false);
      pushNotification({
        category: 'guild',
        title: 'Guild Trader Departed',
        message: line,
        dedupeKey: `guild-departed:${payload.shipId}`,
      });
    }
    return line;
  }

  dispose(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.root.remove();
  }

  private show(line: string, opensTrade: boolean): void {
    const row = document.createElement('div');
    row.className = 'plate-sm ta-guild-toast-row';
    let timer: ReturnType<typeof setTimeout> | null = null;
    const removeRow = () => {
      if (timer !== null) {
        clearTimeout(timer);
        this.timers.delete(timer);
        timer = null;
      }
      row.remove();
      this.root.hidden = this.root.childElementCount === 0;
    };
    const toast = makeBtn('ta-guild-toast', 'guild-toast', line, () => {
      if (opensTrade) this.hooks.openTrade();
      removeRow();
    });
    toast.dataset.kind = opensTrade ? 'arrived' : 'departed';
    const closeBtn = makeBtn('ta-guild-toast__close', 'guild-toast-close', '×', () => {
      removeRow();
    });
    closeBtn.setAttribute('aria-label', 'Dismiss guild notification');
    row.append(toast, closeBtn);
    this.root.hidden = false;
    this.root.appendChild(row);
    const ms = this.hooks.durationMs ?? DEFAULT_GUILD_TOAST_DURATION_MS;
    if (ms > 0) {
      timer = setTimeout(removeRow, ms);
      this.timers.add(timer);
    }
  }
}
