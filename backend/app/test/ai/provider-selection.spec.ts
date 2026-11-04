import { describe, expect, it } from 'vitest';
import { aiProvider } from '../../src/ai/ai-selection.js';

describe('W16-04 fail-closed provider selection', () => {
  it('does not echo an unknown provider value that might be a secret', () => {
    const secret = 'sk-live-DO-NOT-LOG';
    const kind = aiProvider({ AI_PROVIDER: secret });
    expect(kind).toBe('unknown');
    expect(kind).not.toContain(secret);
    expect(kind).not.toContain('DO-NOT-LOG');
  });

  it('refuses non-production zai until AI_LIVE=1', () => {
    expect(aiProvider({ AI_PROVIDER: 'zai', NODE_ENV: 'development' })).toBe('zai-needs-live');
    expect(aiProvider({ AI_PROVIDER: 'zai', NODE_ENV: 'test', AI_LIVE: '1' })).toBe('zai');
  });
});
