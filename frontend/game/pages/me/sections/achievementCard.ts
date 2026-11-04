import type { PlayerAchievementEntry } from '@terra/contracts';
import { renderCardBackFace, renderCardFrontFace } from './cardStates';
import { createFlipCardShell } from './flipCard';

export const TIER_COLORS: Readonly<Record<number, string>> = {
  1: '#C8844A',
  2: '#C9CED6',
  3: '#FFCF5A',
};

/**
 * Renders a 3D flip card inside a family ladder with locked/earned/coming_soon states,
 * tier rim colour, chamfered progress bar, back face metadata, and Share-to-X button (W12-20..W12-22).
 */
export function renderAchievementCard(
  entry: PlayerAchievementEntry,
  indexInLadder: number,
  isNextToEarn: boolean,
): HTMLElement {
  const front = renderCardFrontFace(entry, isNextToEarn);
  const back = renderCardBackFace(entry);

  return createFlipCardShell(
    {
      id: entry.id,
      familyId: entry.familyId,
      tier: entry.tier,
      status: entry.status,
      isNextToEarn,
      indexInLadder,
      label: `${entry.familyName} ${entry.tierName}`,
      tierColor: TIER_COLORS[entry.tier] ?? '#C8844A',
    },
    front,
    back,
  );
}
