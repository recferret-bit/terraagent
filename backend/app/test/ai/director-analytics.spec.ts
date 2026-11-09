import { describe, expect, it } from 'vitest';
import { directorAnalytics } from '../../src/ai/analytics.js';

describe('W16-25 director analytics', () => {
  it('emits an enum event only with consent and drops prompt text', () => {
    expect(directorAnalytics(false, 'risky', 'applied')).toBeNull();
    const event = directorAnalytics(true, 'conservative', 'applied');
    expect(event).toEqual({ name: 'director.decision', props: { risk: 'conservative', outcome: 'applied' } });
    expect(JSON.stringify(event)).not.toContain('api.key');
    expect(directorAnalytics(true, 'risky', 'ignore previous instructions')).toBeNull();
  });
});
