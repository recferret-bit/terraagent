import { describe, expect, it } from 'vitest';
import { ZAI_KEY_MISSING, usageFrom, zaiKey, ZaiLlmAdapter } from '../../src/ai/adapters/zai-llm.adapter.js';

describe('W16-03 Z.ai adapter', () => {
  it('refuses to start a call without a key and does not echo a secret', async () => {
    const secret = 'super-secret-key';
    expect(() => zaiKey({})).toThrow(ZAI_KEY_MISSING);
    try {
      await new ZaiLlmAdapter().complete({ system: 's', messages: [], maxTokens: 8 }, { OTHER_SECRET: secret });
      throw new Error('complete should have thrown');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      expect(message).toBe(ZAI_KEY_MISSING);
      expect(message).not.toContain(secret);
    }
  });

  it('requires numeric usage and keeps both token counts', () => {
    expect(usageFrom({ inputTokens: 3, outputTokens: 4 })).toEqual({ inputTokens: 3, outputTokens: 4 });
    expect(() => usageFrom(undefined)).toThrow(/usage missing/);
  });
});
