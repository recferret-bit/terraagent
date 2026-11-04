import { createMCPClient } from '@ai-sdk/mcp';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { generateText } from 'ai';
import { PgBoss } from 'pg-boss';
import { describe, expect, it } from 'vitest';
import { DIRECTOR_LIBRARIES, DIRECTOR_UNSUPPORTED } from '../../src/ai/versions.js';

describe('W16-28 library smoke', () => {
  it('loads the pinned MCP, AI SDK, and pg-boss exports', () => {
    expect(typeof generateText).toBe('function');
    expect(typeof createOpenAICompatible).toBe('function');
    expect(typeof createMCPClient).toBe('function');
    expect(typeof McpServer).toBe('function');
    expect(typeof PgBoss).toBe('function');
    expect(DIRECTOR_LIBRARIES.pgBoss).toBe('12.38.0');
    expect(DIRECTOR_UNSUPPORTED).toContain('mcp.sampling');
    expect(DIRECTOR_UNSUPPORTED).toContain('provider.silent-model-fallback');
  });
});
