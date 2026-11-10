import type { GuildArrivedPayload, GuildDepartedPayload } from '@terra/contracts';

/** Arrival toast. The count is `offers.length`, including zero. */
export function guildDockedLine(name: string, offers: number): string {
  return `Guild trader ${name} has docked — ${offers} offers`;
}

/** Departure toast. `name` is the arrival display name, or the ship id when this page never saw the arrival. */
export function guildDepartedLine(name: string): string {
  return `Guild trader ${name} has departed`;
}

/**
 * One toast per dock (`shipId` + `departAt`). Remembers the display name for the matching departure.
 * W15 off records nothing and returns null.
 */
export class GuildVisitMemory {
  private readonly seen = new Set<string>();
  private readonly names = new Map<string, string>();

  docked(payload: GuildArrivedPayload, enabled: boolean): string | null {
    if (!enabled) return null;
    this.names.set(payload.shipId, payload.name);
    const key = `${payload.shipId}\0${payload.departAt}`;
    if (this.seen.has(key)) return null;
    this.seen.add(key);
    return guildDockedLine(payload.name, payload.offers.length);
  }

  departed(payload: GuildDepartedPayload, enabled: boolean): string | null {
    if (!enabled) return null;
    return guildDepartedLine(this.names.get(payload.shipId) ?? payload.shipId);
  }
}
