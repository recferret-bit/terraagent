import { describe, expect, it } from 'vitest';
import { authorizeMcp } from '../src/mcp-auth.js';

const token = 'worker-token';

describe('W16-32 MCP auth', () => {
  it('rejects a missing token, a wrong token, and a browser origin', () => {
    expect(authorizeMcp({}, token).ok).toBe(false);
    const wrong = authorizeMcp({ authorization: 'Bearer other' }, token);
    const browser = authorizeMcp({ authorization: `Bearer ${token}`, origin: 'http://evil.test' }, token);
    expect(wrong.ok).toBe(false);
    expect(browser.ok).toBe(false);
    if (!wrong.ok) expect(wrong.code).toBe('unauthorized');
    if (!browser.ok) expect(browser.code).toBe('unauthorized');
    const ok = authorizeMcp({ authorization: `Bearer ${token}` }, token);
    expect(ok).toEqual({ ok: true });
    expect(JSON.stringify(ok)).not.toContain(token);
  });
});
