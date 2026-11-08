import type { ActorKind } from '@terra/contracts';

/** The facts of one order side that decide whether a fill counts as organic demand (D-44, W13 bot decision). */
export interface OrganicParty {
  readonly actorKind: ActorKind | string;
  readonly colonyId: string;
  /** The owner (`playerId`) of the colony; null/empty = unknown. */
  readonly ownerId: string | null | undefined;
}

/** Kinds whose trades may price the board: humans and API-key bots. Fixture, subsidy, npc and guild never do. */
export const ORGANIC_KINDS: readonly string[] = ['player', 'bot'];

/**
 * A fill is organic when BOTH sides are `player` or `bot`, sit in DIFFERENT colonies AND have different owners.
 * The same owner on both sides (two colonies or two bots of one person) is never organic, so nobody paints the price board
 * by trading with themselves. An unknown owner (null) counts as different outside production (dev scenario seats, legacy rows and unit
 * fixtures have no owner) and as NOT organic in production (`failClosed`): real colonies always carry their owner.
 *
 * Truth table (kinds P=player, B=bot, X=npc|guild|fixture|subsidy; colony C same/diff; owner O same/diff/unknown):
 *   P|B vs P|B, C diff, O diff  -> organic        P|B vs P|B, C diff, O unknown -> organic
 *   P|B vs P|B, C diff, O same  -> not organic    P|B vs P|B, C same            -> not organic
 *   any side X                  -> not organic
 */
export function isOrganicFill(a: OrganicParty, b: OrganicParty, failClosed: boolean = process.env.NODE_ENV === 'production'): boolean {
  if (!ORGANIC_KINDS.includes(a.actorKind) || !ORGANIC_KINDS.includes(b.actorKind)) return false;
  if (a.colonyId === b.colonyId) return false;
  if (failClosed && (!a.ownerId || !b.ownerId)) return false; // production: an unknown owner cannot be shown to differ
  return !(a.ownerId && b.ownerId && a.ownerId === b.ownerId);
}
