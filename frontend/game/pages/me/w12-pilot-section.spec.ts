// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderPilotSection } from './sections/PilotSection';
import { makeW12ProfileFixture } from './testFixtures';

describe('W12-14 Pilot section renderer', () => {
  it('renders avatar + frame, handle + rename link, Pilot ID, pilot since, Level 4, XP bar 1 120 / 1 500, and title Surveyor', () => {
    const profile = makeW12ProfileFixture('w12');
    const node = renderPilotSection(profile);

    expect(node.querySelector('[data-testid="me-pilot-avatar"]')?.getAttribute('data-frame')).toBe('surveyor');
    expect(node.querySelector('[data-testid="me-pilot-handle"]')?.textContent).toBe('w12');
    expect(node.querySelector('[data-testid="me-pilot-rename"]')?.textContent).toBe('Rename');
    expect(node.querySelector('[data-testid="me-pilot-id"]')?.textContent).toBe('w12.terraagent.mock');
    expect(node.querySelector('[data-testid="me-pilot-since"]')?.textContent).toContain('Pilot since 2026-10-01');
    expect(node.querySelector('[data-testid="me-pilot-level"]')?.textContent).toBe('Level 4');
    expect(node.querySelector('[data-testid="me-pilot-xp-bar"]')?.textContent).toBe('1 120 / 1 500');
    expect(node.querySelector('[data-testid="me-pilot-title"]')?.textContent).toBe('Surveyor');
  });
});
