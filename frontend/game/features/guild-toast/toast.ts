import type { GuildArrivedPayload, GuildDepartedPayload } from '@terra/contracts';
import { makeBtn } from '../shared/dom';
import { GuildVisitMemory } from './lines';

export interface GuildToastHooks {
  /** Read on each push so a live flag set that drops W15 stops further toasts. */
  enabled(): boolean;
  /** Arrival tap: open the Trade Hub. Departure taps only dismiss. */
  openTrade(): void;
}

/** Plates for `guild.arrived` / `guild.departed`. Not the sim event log: those pushes are not `SimEventWire`. */
export class GuildToastHost {
  private readonly memory = new GuildVisitMemory();
  private readonly root: HTMLElement;

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

  arrive(payload: GuildArrivedPayload): string | null {
    const line = this.memory.docked(payload, this.hooks.enabled());
    if (line) this.show(line, true);
    return line;
  }

  depart(payload: GuildDepartedPayload): string | null {
    const line = this.memory.departed(payload, this.hooks.enabled());
    if (line) this.show(line, false);
    return line;
  }

  dispose(): void {
    this.root.remove();
  }

  private show(line: string, opensTrade: boolean): void {
    const toast = makeBtn('plate-sm ta-guild-toast', 'guild-toast', line, () => {
      if (opensTrade) this.hooks.openTrade();
      toast.remove();
      this.root.hidden = this.root.childElementCount === 0;
    });
    toast.dataset.kind = opensTrade ? 'arrived' : 'departed';
    this.root.hidden = false;
    this.root.appendChild(toast);
  }
}
