// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderAchievementCard } from './sections/achievementCard';
import { makeW12AchievementsFixture } from './testFixtures';

describe('W12-21 Flip card mechanics, directional sheen, and PA-02 keyboard / tap accessibility', () => {
  it('toggles .flip / .is-flipped, aria-expanded, and data-flip-dir on click, Enter, Space, and hover', () => {
    const ach = makeW12AchievementsFixture();
    const entry = ach.achievements[0]!;
    const card = renderAchievementCard(entry, 1, false);

    expect(card.getAttribute('aria-expanded')).toBe('false');
    expect(card.classList.contains('flip')).toBe(false);
    expect(card.dataset.flipDir).toBe('to-front');
    expect(card.style.getPropertyValue('--i')).toBe('1');
    expect(card.style.getPropertyValue('--tier')).toBe('#C8844A');
    expect(card.querySelector('[data-testid="ach-flip-sheen-front"]')).not.toBeNull();
    expect(card.querySelector('[data-testid="ach-flip-sheen-back"]')).not.toBeNull();

    card.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(card.dataset.flipDir).toBe('to-back');

    card.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    expect(card.dataset.flipDir).toBe('to-front');

    card.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(card.getAttribute('aria-expanded')).toBe('true');
    expect(card.classList.contains('flip')).toBe(true);
    expect(card.classList.contains('is-flipped')).toBe(true);
    expect(card.dataset.flipDir).toBe('to-back');

    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(card.getAttribute('aria-expanded')).toBe('false');
    expect(card.classList.contains('flip')).toBe(false);
    expect(card.dataset.flipDir).toBe('to-front');

    card.click();
    expect(card.getAttribute('aria-expanded')).toBe('true');
    expect(card.classList.contains('flip')).toBe(true);
    expect(card.dataset.flipDir).toBe('to-back');

    card.click();
    expect(card.getAttribute('aria-expanded')).toBe('false');
    expect(card.classList.contains('flip')).toBe(false);
    expect(card.dataset.flipDir).toBe('to-front');
  });

  it('keeps 3D flip faces visible via backface-visibility instead of delayed visibility:hidden', () => {
    const css = readFileSync(resolve(__dirname, 'sections/flip-card.css'), 'utf8');
    const [motionCss = ''] = css.split('@media (prefers-reduced-motion: reduce)');

    expect(motionCss).not.toMatch(/(?<![a-z-])visibility\s*:\s*hidden/);
    expect(motionCss).not.toMatch(/transition\s*:[^;]*(?<![a-z-])visibility/);
    expect(motionCss).toMatch(/\.flip-sheen\s*\{[^}]*backface-visibility\s*:\s*hidden/s);
    expect(motionCss).toMatch(/\.flip-card\.flip\s+\.flip-front[\s\S]*pointer-events\s*:\s*none/);
    expect(motionCss).toMatch(/\.flip-card\.flip\s+\.flip-back[\s\S]*pointer-events\s*:\s*auto/);
  });
});
