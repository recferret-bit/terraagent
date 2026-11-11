import { HomeColonyId, type NotificationPayload } from '@terra/contracts';

/** One note for the whole open set, not one per tick (W22-16). */
export function councilNoticeBody(openCount: number): string {
  const noun = openCount === 1 ? 'proposal' : 'proposals';
  return `Planet council: ${openCount} open ${noun}`;
}

/**
 * Same open ids → same event id, so a second poll does not insert another `mock_notify` row.
 * A newly opened proposal changes the id and queues a new note.
 */
export function councilNoticeEventId(planetId: string, proposalIds: readonly number[]): string {
  const ids = [...proposalIds].sort((a, b) => a - b).join('.');
  const raw = `council-open:${planetId}:${ids}`;
  return raw.length <= 128 ? raw : raw.slice(0, 128);
}

/** Null when `colonyId` is not a home id or there is nothing open. Kind is not a CT-36 toggle. */
export function councilNotice(
  planetId: string,
  colonyId: string,
  proposalIds: readonly number[],
): NotificationPayload | null {
  if (proposalIds.length === 0 || !HomeColonyId.safeParse(colonyId).success) return null;
  return {
    colonyId,
    eventId: councilNoticeEventId(planetId, proposalIds),
    kind: 'council_proposal',
    channel: 'webpush',
    to: colonyId,
    title: 'Planet council',
    body: councilNoticeBody(proposalIds.length),
    data: { planetId, open: proposalIds.length },
  };
}
