// @vitest-environment jsdom
import { ACHIEVEMENTS } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { renderAchievementCard } from './sections/achievementCard';
import { getAchievementLore } from './sections/achievementLore';
import { makeW12AchievementsFixture } from './testFixtures';

describe('W12-22 Achievement card states: earned, locked, coming_soon, lore riddles, and Share-to-X', () => {
  it('renders earned card with enlarged art, ✓ date, EARNED badge, Souls lore riddle, Recorded (mock), and Share-to-X intent link', () => {
    const ach = makeW12AchievementsFixture();
    const earnedEntry = ach.achievements.find((a) => a.id === 'groundbreaker')!;
    const card = renderAchievementCard(earnedEntry, 0, false);

    expect(card.classList.contains('is-earned')).toBe(true);
    const art = card.querySelector<HTMLImageElement>('[data-testid="ach-card-art"]')!;
    expect(art.src).toContain('/img/achievements/groundbreaker.svg');
    expect(art.getAttribute('width')).toBe('240');
    expect(art.getAttribute('height')).toBe('240');

    const earnedBadge = card.querySelector('[data-testid="ach-earned-badge"]')!;
    expect(earnedBadge.textContent).toContain('✓ 2026-10-18');
    expect(earnedBadge.textContent).toContain('EARNED');

    const lore = card.querySelector('[data-testid="ach-back-lore"]')!;
    expect(lore.textContent).toContain('RELIC INSCRIPTION · TIER I');
    expect(lore.textContent).toContain('grading blade');

    const nft = card.querySelector('[data-testid="ach-nft-status"]')!;
    expect(nft.textContent).toBe('Recorded (mock)');

    const share = card.querySelector<HTMLAnchorElement>('[data-testid="ach-share-btn"]')!;
    expect(share.href).toContain('https://x.com/intent/tweet?');
    expect(decodeURIComponent(share.href)).toContain('Groundbreaker');
  });

  it('renders locked card with -locked.svg art, progress bar, hides front description when not next tier, and provides unique lore across all 60 achievements', () => {
    const ach = makeW12AchievementsFixture();
    const silverNext = ach.achievements.find((a) => a.id === 'groundbreaker-2')!;
    const goldLater = ach.achievements.find((a) => a.id === 'groundbreaker-3')!;

    const nextCard = renderAchievementCard(silverNext, 1, true);
    expect(nextCard.querySelector<HTMLImageElement>('[data-testid="ach-card-art"]')?.src).toContain(
      '/img/achievements/groundbreaker-2-locked.svg',
    );
    expect(nextCard.querySelector('[data-testid="ach-front-desc"]')?.textContent).toContain('1 000');
    expect(nextCard.querySelector('[data-testid="ach-progress-bar"]')?.textContent).toBe(
      '800 / 1 000 (80%)',
    );
    expect(nextCard.querySelector('[data-testid="ach-back-lore"]')?.textContent).toContain(
      'RELIC INSCRIPTION · TIER II',
    );

    const laterCard = renderAchievementCard(goldLater, 2, false);
    expect(laterCard.querySelector('[data-testid="ach-front-desc"]')).toBeNull();
    expect(laterCard.querySelector('[data-testid="ach-back-desc"]')).not.toBeNull();
    expect(laterCard.querySelector('[data-testid="ach-back-lore"]')?.textContent).toContain(
      'RELIC INSCRIPTION · TIER III',
    );

    const uniqueLores = new Set(ACHIEVEMENTS.map((def) => getAchievementLore(def)));
    expect(uniqueLores.size).toBe(60);
  });

  it('renders coming_soon card with Coming soon label and no progress bar', () => {
    const ach = makeW12AchievementsFixture(new Set(['warlord']));
    const warlord = ach.achievements.find((a) => a.id === 'warlord')!;
    const card = renderAchievementCard(warlord, 0, false);

    expect(card.classList.contains('is-coming_soon')).toBe(true);
    expect(card.querySelector('[data-testid="ach-coming-soon"]')?.textContent).toBe('Coming soon');
    expect(card.querySelector('[data-testid="ach-progress-bar"]')).toBeNull();
  });
});
