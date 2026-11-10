import type { GuildArrivedPayload, GuildDepartedPayload, GuildOffer } from '@terra/contracts';

/** The tab never draws more than the curated cap, even if a payload is longer. */
export const GUILD_OFFER_CAP = 6;

export interface GuildVisit {
  shipId: string;
  name: string;
  departAt: number;
  offers: GuildOffer[];
  /** `guild.departed` for this ship, before `departAt`. */
  left: boolean;
}

/** Latest dock on this page. Listeners repaint the tab; the model itself is filled as soon as the feature mounts. */
export class GuildVisitModel {
  visit: GuildVisit | null = null;
  /** Bumped on each arrival so a late accept result cannot paint onto the next ship. */
  generation = 0;
  readonly sent = new Set<string>();
  rejectText = '';
  private readonly listeners = new Set<() => void>();

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  arrive(payload: GuildArrivedPayload): void {
    this.generation += 1;
    this.visit = {
      shipId: payload.shipId,
      name: payload.name,
      departAt: payload.departAt,
      offers: payload.offers.slice(0, GUILD_OFFER_CAP),
      left: false,
    };
    this.sent.clear();
    this.rejectText = '';
    this.emit();
  }

  depart(payload: GuildDepartedPayload): void {
    if (!this.visit || this.visit.shipId !== payload.shipId) return;
    this.visit = { ...this.visit, left: true };
    this.emit();
  }

  /** False when this id was already sent. One Accept, one command. */
  markSent(offerId: string): boolean {
    if (this.sent.has(offerId)) return false;
    this.sent.add(offerId);
    this.emit();
    return true;
  }

  setReject(text: string): void {
    this.rejectText = text;
    this.emit();
  }

  clearReject(): void {
    if (!this.rejectText) return;
    this.rejectText = '';
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}
