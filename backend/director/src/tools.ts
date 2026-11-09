import { MCP_TOOL_NAMES, parseToolArgs, type McpToolName } from '@terra/contracts';

export type ToolCallResult =
  | { ok: true; name: McpToolName }
  | { ok: false; code: 'unauthorized' | 'invalid' };

const ALLOWED = new Set<string>(MCP_TOOL_NAMES);

/** Allowlisted tools only. Shell, HTTP, and unknown names are unauthorized (AI §6). */
export function callTool(name: string, args: unknown): ToolCallResult {
  if (!ALLOWED.has(name)) return { ok: false, code: 'unauthorized' };
  const parsed = parseToolArgs(name, args);
  if (!parsed.success) return { ok: false, code: parsed.code === 'unknown_tool' ? 'unauthorized' : 'invalid' };
  return { ok: true, name: parsed.name };
}
