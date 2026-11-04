export type McpAuth = { ok: true } | { ok: false; code: 'unauthorized' };

/**
 * Private MCP gate (AI §2). A browser Origin is rejected. The bearer must match
 * the worker token exactly. The token is never copied into the result.
 */
export function authorizeMcp(headers: { authorization?: string; origin?: string }, token: string): McpAuth {
  if (headers.origin) return { ok: false, code: 'unauthorized' };
  const header = headers.authorization ?? '';
  const match = /^Bearer (\S+)$/.exec(header);
  if (!match || match[1] !== token || token.length === 0) return { ok: false, code: 'unauthorized' };
  return { ok: true };
}
