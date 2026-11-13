import { describe, expect, it } from 'vitest';
import { reportMarkdown } from '../../src/ai/live-once.js';

describe('W16-48 live report', () => {
  it('records usage and latency and does not include a key', () => {
    const text = reportMarkdown({
      ok: true,
      model: 'z-ai/glm-5.3-flash',
      latencyMs: 1763,
      inputTokens: 21,
      outputTokens: 16,
      error: null,
    });
    expect(text).toContain('model: z-ai/glm-5.3-flash');
    expect(text).toContain('inputTokens: 21');
    expect(text).toContain('outputTokens: 16');
    expect(text).not.toContain('NEAR_AI_API_KEY');
  });
});
