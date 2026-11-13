/**
 * Pinned on 2026-11-04 for Node 24 (W16-28). pg-boss 12 requires Node >= 22.12.
 * Remote MCP discovery, sampling, elicitation, and resource subscriptions stay off (AI §2).
 * NEAR AI Cloud z-ai/glm-5.3-flash tool and usage behavior is verified in the live eval (W16-48).
 */
export const DIRECTOR_LIBRARIES = {
  ai: '7.0.162',
  openaiCompatible: '3.0.84',
  aiSdkMcp: '2.0.90',
  mcpSdk: '1.32.2',
  pgBoss: '12.38.0',
} as const;

export const DIRECTOR_UNSUPPORTED = [
  'mcp.sampling',
  'mcp.elicitation',
  'mcp.resource-subscriptions',
  'mcp.remote-discovery',
  'provider.silent-model-fallback',
] as const;
