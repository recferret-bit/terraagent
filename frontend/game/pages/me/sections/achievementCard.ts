import type { PlayerAchievementEntry } from '@terra/contracts';
import { el, formatThinInt } from '../dom';
import { createFlipCardShell } from './flipCard';

export const TIER_COLORS: Readonly<Record<number, string>> = {
  1: '#C8844A',
  2: '#C9CED6',
  3: '#FFCF5A',
};

/**
 * Renders a 3D flip card inside a family ladder (W12-20, W12-21).
 * Extended in W12-22 with full locked/earned/coming_soon front & back faces and Share-to-X.
 */
export function renderAchievementCard(
  entry: PlayerAchievementEntry,
  indexInLadder: number,
  isNextToEarn: boolean,
): HTMLElement {
  const pct =
    entry.progress.target > 0
      ? Math.max(0, Math.min(100, Math.round((entry.progress.value / entry.progress.target) * 100)))
      : 0;
  const barLabel = `${formatThinInt(entry.progress.value)} / ${formatThinInt(entry.progress.target)} (${pct}%)`;
  const statusText =
    entry.status === 'earned'
      ? 'EARNED'
      : entry.status === 'coming_soon'
        ? 'Coming soon'
        : isNextToEarn
          ? barLabel
          : 'LOCKED';

  const front = el(
    'div',
    { dataset: { testid: `ach-front-${entry.id}` } },
    el('span', { className: 'label ta-ach-tier' }, entry.tierName.toUpperCase()),
    el('h4', { className: 'ta-ach-title' }, entry.familyName),
    el('p', { className: 'ta-ach-desc' }, entry.description),
    el('span', { className: 'ta-ach-status' }, statusText),
  );

  const back = el(
    'div',
    { dataset: { testid: `ach-back-${entry.id}` } },
    el('h4', { className: 'ta-ach-title' }, `${entry.familyName} · ${entry.tierName}`),
    el('p', { className: 'ta-ach-desc' }, entry.description),
    el('span', { className: 'label c-orange' }, `+${entry.xp} XP`),
  );

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
