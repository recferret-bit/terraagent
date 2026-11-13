import {
  ACHIEVEMENT_FAMILIES,
  type MeAchievementsResponse,
  type PlayerAchievementEntry,
} from '@terra/contracts';
import { el, formatThinInt } from '../dom';
import { renderAchievementCard } from './achievementCard';
import './achievements.css';

/**
 * Scrolls a horizontal 3-card ladder to the first locked card after the highest earned tier
 * so mobile/narrow viewports immediately focus the active tier in progress (W12-20).
 * Skips scrolling on wide viewports where all 3 cards already fit without horizontal overflow.
 */
export function scrollInitialLadder(ladderEl: HTMLElement): void {
  if (ladderEl.clientWidth > 0 && ladderEl.scrollWidth <= ladderEl.clientWidth) return;
  const nextCard = ladderEl.querySelector<HTMLElement>('[data-next="true"]');
  if (!nextCard) return;
  const offset = nextCard.offsetLeft;
  if (typeof ladderEl.scrollTo === 'function') {
    ladderEl.scrollTo({ left: offset, behavior: 'auto' });
  } else {
    ladderEl.scrollLeft = offset;
  }
}

/**
 * Renders the Achievements section (`#achievements`, W12-20):
 * header summary (`earned / 60 · XP`), 20 family blocks in catalogue order,
 * each with an eyebrow `h3` and a horizontal scroll-snap ladder of 3 tier cards.
 */
export function renderAchievementsSection(achievements: MeAchievementsResponse): HTMLElement {
  const byFamily = new Map<string, PlayerAchievementEntry[]>();
  let earnedXp = 0;

  for (const entry of achievements.achievements) {
    if (entry.status === 'earned') earnedXp += entry.xp;
    const list = byFamily.get(entry.familyId) ?? [];
    list.push(entry);
    byFamily.set(entry.familyId, list);
  }

  const summaryHeader = el(
    'div',
    { className: 'ta-ach-summary-bar', dataset: { testid: 'me-achievements-summary' } },
    el(
      'span',
      { className: 'label c-orange', dataset: { testid: 'me-achievements-count' } },
      `ACHIEVEMENTS · ${achievements.earnedCount} / ${achievements.totalCount}`,
    ),
    el(
      'span',
      { className: 'ta-ach-xp-total', dataset: { testid: 'me-achievements-xp' } },
      `${formatThinInt(earnedXp)} XP from achievements`,
    ),
  );

  const familyBlocks: HTMLElement[] = [];
  const laddersToScroll: HTMLElement[] = [];

  for (const fam of ACHIEVEMENT_FAMILIES) {
    const tiers = (byFamily.get(fam.familyId) ?? []).sort((a, b) => a.tier - b.tier);
    const firstLockedTier = tiers.find((t) => t.status === 'locked')?.tier ?? null;

    const cards = tiers.map((entry, idx) =>
      renderAchievementCard(entry, idx, entry.tier === firstLockedTier),
    );

    const ladder = el(
      'div',
      {
        className: 'ta-ach-ladder',
        dataset: { testid: `ach-ladder-${fam.familyId}`, familyId: fam.familyId },
      },
      ...cards,
    );
    laddersToScroll.push(ladder);

    const earnedInFamily = tiers.filter((t) => t.status === 'earned').length;
    const block = el(
      'div',
      {
        className: 'ta-ach-family-block',
        dataset: { testid: `ach-family-${fam.familyId}`, familyId: fam.familyId },
      },
      el(
        'div',
        { className: 'ta-ach-family-head' },
        el(
          'h3',
          { className: 'label ta-ach-family-eyebrow' },
          `${fam.name}${fam.star ? ' ★' : ''}`,
        ),
        el('span', { className: 'label ta-ach-family-progress' }, `${earnedInFamily} / 3`),
      ),
      ladder,
    );
    familyBlocks.push(block);
  }

  if (typeof queueMicrotask === 'function') {
    queueMicrotask(() => {
      for (const l of laddersToScroll) scrollInitialLadder(l);
    });
  }

  return el(
    'div',
    { className: 'ta-achievements-body', dataset: { testid: 'me-achievements-body' } },
    summaryHeader,
    el('div', { className: 'ta-ach-families', dataset: { testid: 'me-achievements-families' } }, ...familyBlocks),
  );
}
