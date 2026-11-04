import { describe, expect, it } from 'vitest';
import { callTool } from '../src/tools.js';

describe('W16-33 MCP tools', () => {
  it('rejects shell and unknown tools and accepts an empty brief read', () => {
    const shell = callTool('shell.exec', {});
    const files = callTool('files.read', { path: '/etc/passwd' });
    const brief = callTool('colony.readBrief', {});
    const ssrf = callTool('colony.readBrief', { url: 'http://169.254.169.254' });
    expect(shell.ok).toBe(false);
    expect(files.ok).toBe(false);
    if (!shell.ok) expect(shell.code).toBe('unauthorized');
    expect(brief).toEqual({ ok: true, name: 'colony.readBrief' });
    expect(ssrf.ok).toBe(false);
    if (!ssrf.ok) expect(ssrf.code).toBe('invalid');
  });
});
