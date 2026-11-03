import type { PlayerAchievementEntry } from '@terra/contracts';
import { el, formatThinInt } from '../dom';

/**
 * Renders a single achievement tier card shell inside a family ladder (W12-20).
 * Extended in W12-21 (flip mechanics) and W12-22 (locked/earned/coming_soon states + Share-to-X).
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

  return el(
    'article',
    {
      className: `plate-sm ta-ach-card is-${entry.status}`,
      tabIndex: 0,
      role: 'button',
      aria: { expanded: 'false', label: `${entry.familyName} ${entry.tierName}` },
      dataset: {
        testid: `ach-card-${entry.id}`,
        achievementId: entry.id,
        familyId: entry.familyId,
        tier: entry.tier,
        status: entry.status,
        next: isNextToEarn ? 'true' : 'false',
      },
      style: { '--i': String(indexInLadder) },
    },
    el('span', { className: 'label ta-ach-tier' }, entry.tierName.toUpperCase()),
    el('h4', { className: 'ta-ach-title' }, entry.familyName),
    el('p', { className: 'ta-ach-desc' }, entry.description),
    el('span', { className: 'ta-ach-status' }, statusText),
  );
}
