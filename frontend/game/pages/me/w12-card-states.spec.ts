// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderAchievementCard } from './sections/achievementCard';
import { makeW12AchievementsFixture } from './testFixtures';

describe('W12-22 Achievement card states: earned, locked (next vs later), coming_soon, and Share-to-X', () => {
  it('renders earned card with ✓ date, EARNED badge, Recorded (mock), and Share-to-X intent link', () => {
    const ach = makeW12AchievementsFixture();
    const earnedEntry = ach.achievements.find((a) => a.id === 'groundbreaker')!;
    const card = renderAchievementCard(earnedEntry, 0, false);

    expect(card.classList.contains('is-earned')).toBe(true);
    const art = card.querySelector<HTMLImageElement>('[data-testid="ach-card-art"]')!;
    expect(art.src).toContain('/img/achievements/groundbreaker.svg');

    const earnedBadge = card.querySelector('[data-testid="ach-earned-badge"]')!;
    expect(earnedBadge.textContent).toContain('✓ 2026-10-18');
    expect(earnedBadge.textContent).toContain('EARNED');

    const nft = card.querySelector('[data-testid="ach-nft-status"]')!;
    expect(nft.textContent).toBe('Recorded (mock)');

    const share = card.querySelector<HTMLAnchorElement>('[data-testid="ach-share-btn"]')!;
    expect(share.href).toContain('https://x.com/intent/tweet?');
    expect(decodeURIComponent(share.href)).toContain('Groundbreaker');
  });

  it('renders locked card with -locked.svg art, progress bar, and hides front description when not next tier', () => {
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

    const laterCard = renderAchievementCard(goldLater, 2, false);
    expect(laterCard.querySelector('[data-testid="ach-front-desc"]')).toBeNull();
    expect(laterCard.querySelector('[data-testid="ach-back-desc"]')).not.toBeNull();
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
