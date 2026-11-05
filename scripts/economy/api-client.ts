import { ECONOMY_EXIT_CODES, type EconomyExitCode } from '@terra/contracts';

/** What an HTTP call to `/v1/economy/*` needs; tests pass the app's URL and `fetch`. */
export interface ApiContext {
  readonly base: string;
  readonly editToken: string;
  readonly activateToken: string;
  readonly fetch: typeof fetch;
}

export class CliError extends Error {
  constructor(readonly exitCode: EconomyExitCode, readonly kind: string, message: string, readonly details?: unknown) {
    super(message);
  }
}

/**
 * Exit code of an HTTP status (ECONOMY §6): 2 invalid input for every 4xx, including 401/403 (a missing role is a request
 * the caller must change, like a bad path); 4 execution failure for 5xx and an unreachable API.
 */
export const exitCodeOfStatus = (status: number): EconomyExitCode => (status >= 400 && status < 500 ? ECONOMY_EXIT_CODES.invalidInput : ECONOMY_EXIT_CODES.executionFailure);

export type Role = 'edit' | 'activate';

export async function api(ctx: ApiContext, method: string, path: string, opts: { body?: unknown; query?: Record<string, string | undefined>; role?: Role } = {}): Promise<unknown> {
  const q = Object.entries(opts.query ?? {}).filter((e): e is [string, string] => e[1] !== undefined);
  const url = `${ctx.base.replace(/\/$/, '')}/v1/economy${path}${q.length ? `?${new URLSearchParams(q)}` : ''}`;
  const token = opts.role === 'activate' ? ctx.activateToken : ctx.editToken;
  let res: Response;
  try {
    res = await ctx.fetch(url, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }) });
  } catch (e) {
    throw new CliError(ECONOMY_EXIT_CODES.executionFailure, 'api_unreachable', `cannot reach ${url}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const text = await res.text();
  let json: unknown = text;
  try { json = text ? JSON.parse(text) : null; } catch { /* keep the text */ }
  if (!res.ok) {
    type Body = { code?: string; message?: string; details?: unknown };
    const j = json as ({ error?: Body | string } & Body) | null;
    const e: Body = typeof j?.error === 'object' && j.error ? j.error : (j ?? {});
    throw new CliError(exitCodeOfStatus(res.status), e.code ?? `http_${res.status}`, e.message ?? `HTTP ${res.status} ${method} ${path}`, e.details ?? json);
  }
  return json;
}
