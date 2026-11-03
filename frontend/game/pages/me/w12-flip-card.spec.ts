// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderAchievementCard } from './sections/achievementCard';
import { makeW12AchievementsFixture } from './testFixtures';

describe('W12-21 Flip card mechanics and PA-02 keyboard / tap accessibility', () => {
  it('toggles .flip / .is-flipped and aria-expanded on click, Enter, and Space', () => {
    const ach = makeW12AchievementsFixture();
    const entry = ach.achievements[0]!;
    const card = renderAchievementCard(entry, 1, false);

    expect(card.getAttribute('aria-expanded')).toBe('false');
    expect(card.classList.contains('flip')).toBe(false);
    expect(card.style.getPropertyValue('--i')).toBe('1');
    expect(card.style.getPropertyValue('--tier')).toBe('#C8844A');

    card.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(card.getAttribute('aria-expanded')).toBe('true');
    expect(card.classList.contains('flip')).toBe(true);
    expect(card.classList.contains('is-flipped')).toBe(true);

    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(card.getAttribute('aria-expanded')).toBe('false');
    expect(card.classList.contains('flip')).toBe(false);

    card.click();
    expect(card.getAttribute('aria-expanded')).toBe('true');
    expect(card.classList.contains('flip')).toBe(true);
  });
});
