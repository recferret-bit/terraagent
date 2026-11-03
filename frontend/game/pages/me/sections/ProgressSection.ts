import type { MeProfileResponse, PlayerAchievementEntry } from '@terra/contracts';
import { el, formatThinInt } from '../dom';
import './progress.css';

function renderStageTrack(unlockStage: number, nextCondition: string | null): HTMLElement {
  const segments: HTMLElement[] = [];
  for (let s = 0; s <= 10; s++) {
    const reached = s <= unlockStage;
    const isCurrent = s === unlockStage;
    segments.push(
      el(
        'div',
        {
          className: `plate-sm ta-stage-segment${reached ? ' is-lit' : ''}${isCurrent ? ' is-current' : ''}`,
          dataset: {
            testid: `me-stage-segment-${s}`,
            stage: s,
            lit: reached ? 'true' : 'false',
          },
        },
        `S${s}`,
      ),
    );
  }

  const nextText = nextCondition
    ? `Next stage (S${Math.min(10, unlockStage + 1)}): ${nextCondition}`
    : 'Maximum stage S10 reached';

  return el(
    'div',
    { className: 'ta-stage-block', dataset: { testid: 'me-stage-track' } },
    el(
      'div',
      { className: 'ta-stage-head' },
      el('span', { className: 'label' }, `HIGHEST COLONY STAGE · S${unlockStage}`),
      el('span', { className: 'ta-stage-next', dataset: { testid: 'me-stage-next-condition' } }, nextText),
    ),
    el('div', { className: 'ta-stage-segments' }, ...segments),
  );
}

function renderNextAchievementRow(entry: PlayerAchievementEntry): HTMLElement {
  const { value, target } = entry.progress;
  const pct = target > 0 ? Math.max(0, Math.min(100, Math.round((value / target) * 100))) : 0;
  const barText = `${formatThinInt(value)} / ${formatThinInt(target)} (${pct}%)`;

  return el(
    'div',
    {
      className: 'plate-sm ta-next-ach-card',
      dataset: { testid: 'me-next-achievement', achievementId: entry.id },
    },
    el(
      'div',
      { className: 'ta-next-ach-head' },
      el('strong', { className: 'ta-next-ach-name' }, `${entry.familyName} (${entry.tierName})`),
      el('span', { className: 'label c-orange' }, `+${entry.xp} XP`),
    ),
    el('p', { className: 'ta-next-ach-desc' }, entry.description),
    el(
      'div',
      { className: 'ta-next-ach-bar', dataset: { testid: 'me-next-achievement-bar' } },
      el('div', { className: 'ta-next-ach-fill', style: { width: `${pct}%` } }),
      el('span', { className: 'ta-next-ach-bar-text' }, barText),
    ),
  );
}

/**
 * Renders the Progress section (`#progress`, W12-15):
 * level/XP detail, 11-segment `unlockStage` track (`S0–S10`) with next unlock condition,
 * and the 3 closest locked achievements with progress bars.
 */
export function renderProgressSection(profile: MeProfileResponse): HTMLElement {
  const { progression, nextAchievements } = profile;
  const xpToNext = Math.max(0, progression.nextLevelXp - progression.xp);

  const summaryRow = el(
    'div',
    { className: 'ta-progress-summary', dataset: { testid: 'me-progress-summary' } },
    el(
      'span',
      { className: 'ta-progress-xp-detail' },
      `Level ${progression.level} (${progression.title}) · ${formatThinInt(progression.xp)} XP total · ${formatThinInt(xpToNext)} XP to next level`,
    ),
  );

  const nextGrid = el(
    'div',
    { className: 'ta-next-ach-grid', dataset: { testid: 'me-next-achievements' } },
    ...nextAchievements.map(renderNextAchievementRow),
  );

  return el(
    'div',
    { className: 'ta-progress-body', dataset: { testid: 'me-progress-body' } },
    summaryRow,
    renderStageTrack(progression.unlockStage, progression.nextStageCondition),
    el(
      'div',
      { className: 'ta-next-ach-section' },
      el('h3', { className: 'label ta-sub-eyebrow' }, 'NEXT ACHIEVEMENTS'),
      nextGrid,
    ),
  );
}
