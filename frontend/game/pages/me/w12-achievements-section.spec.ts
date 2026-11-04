// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderAchievementsSection, scrollInitialLadder } from './sections/AchievementsSection';
import { makeW12AchievementsFixture } from './testFixtures';

describe('W12-20 Achievement ladders and family blocks', () => {
  it('renders 20 family blocks in catalogue order with 3 cards each and header 9 / 60', () => {
    const ach = makeW12AchievementsFixture();
    const node = renderAchievementsSection(ach);

    expect(node.querySelector('[data-testid="me-achievements-count"]')?.textContent).toBe(
      'ACHIEVEMENTS · 9 / 60',
    );

    const familyBlocks = node.querySelectorAll('.ta-ach-family-block');
    expect(familyBlocks).toHaveLength(20);

    for (const block of familyBlocks) {
      const cards = block.querySelectorAll('.ta-ach-card');
      expect(cards).toHaveLength(3);
    }

    const gbLadder = node.querySelector<HTMLElement>('[data-testid="ach-ladder-groundbreaker"]')!;
    const gb2 = gbLadder.querySelector<HTMLElement>('[data-testid="ach-card-groundbreaker-2"]')!;
    expect(gb2.getAttribute('data-next')).toBe('true');

    Object.defineProperty(gb2, 'offsetLeft', { value: 260, configurable: true });
    const scrollToSpy = vi.fn();
    gbLadder.scrollTo = scrollToSpy;
    scrollInitialLadder(gbLadder);
    expect(scrollToSpy).toHaveBeenCalledWith({ left: 260, behavior: 'auto' });
  });
});
