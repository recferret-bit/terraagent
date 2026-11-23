import type { VisitWindow } from './schedule.js';

export interface RadarVisit {
  readonly npcId: string;
  readonly name: string;
  readonly arriveAt: number;
  readonly departAt: number;
  /** When this wallet's radar shows the ship (`arriveAt - leadMs`); everyone else sees it at `arriveAt`. */
  readonly noticeAt: number;
  /** The radar shows the ship at `nowMs` (already inbound or docked). */
  readonly visibleNow: boolean;
  /** Visible to this wallet before it is to a player without the radar perk. */
  readonly early: boolean;
}

export interface RadarView {
  readonly planetId: string;
  readonly nowMs: number;
  /** `guildRadarLeadMs` of the wallet's tier (`5 min` from Tier 2, `0` without W28 or below Tier 2). */
  readonly leadMs: number;
  readonly visits: readonly RadarVisit[];
}

/**
 * Pure: the radar notice of each upcoming Guild visit. The base notice is the arrival (`guild.arrived`); Tier 2+ wallets
 * see the ship `leadMs` earlier. A visit that already departed is not shown.
 */
export function radarVisits(windows: readonly (VisitWindow & { readonly name: string })[], leadMs: number, nowMs: number): RadarVisit[] {
  const lead = Math.max(0, Math.trunc(leadMs));
  return windows
    .filter((w) => nowMs < w.departAt)
    .map((w) => {
      const noticeAt = w.arriveAt - lead;
      return {
        npcId: w.npcId,
        name: w.name,
        arriveAt: w.arriveAt,
        departAt: w.departAt,
        noticeAt,
        visibleNow: nowMs >= noticeAt,
        early: lead > 0 && nowMs >= noticeAt && nowMs < w.arriveAt,
      };
    });
}
