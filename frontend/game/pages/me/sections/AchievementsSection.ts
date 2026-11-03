import type { MeAchievementsResponse } from '@terra/contracts';
import { el } from '../dom';

/** Renders the Achievements section (`#achievements`, implemented in W12-20..W12-22). */
export function renderAchievementsSection(achievements: MeAchievementsResponse): HTMLElement {
  return el(
    'div',
    { className: 'ta-achievements-body', dataset: { testid: 'me-achievements-body' } },
    el('span', null, `${achievements.earnedCount} / ${achievements.totalCount}`),
  );
}
