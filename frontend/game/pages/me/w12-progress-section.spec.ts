// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderProgressSection } from './sections/ProgressSection';
import { makeW12ProfileFixture } from './testFixtures';

describe('W12-15 Progress section renderer', () => {
  it('lights S0..S4 on the 11-segment stage track and renders 3 next achievement progress bars', () => {
    const profile = makeW12ProfileFixture();
    const node = renderProgressSection(profile);

    const allSegments = node.querySelectorAll('[data-stage]');
    expect(allSegments).toHaveLength(11);

    for (let s = 0; s <= 10; s++) {
      const seg = node.querySelector(`[data-testid="me-stage-segment-${s}"]`);
      expect(seg?.getAttribute('data-lit')).toBe(s <= 4 ? 'true' : 'false');
    }

    expect(node.querySelector('[data-testid="me-stage-next-condition"]')?.textContent).toContain(
      'Construct Research Uplink',
    );

    const nextCards = node.querySelectorAll('[data-testid="me-next-achievement"]');
    expect(nextCards).toHaveLength(3);
    expect(nextCards[0]?.textContent).toContain('800 / 1 000');
  });
});
