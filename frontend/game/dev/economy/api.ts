export type TokenKind = 'read' | 'edit' | 'activate';
export const DEV_TOKENS: Readonly<Record<TokenKind, string>> = { read: 'dev-economy-reader', edit: 'dev-economy-operator', activate: 'dev-economy-activator' };
const KEY = (k: TokenKind) => `ta.economy.token.${k}`;

/** Tokens live in `sessionStorage` (per tab); storage can throw (private mode), so every access has a memory fallback. */
export class TokenStore {
  private readonly mem = new Map<TokenKind, string>();

  get(kind: TokenKind): string {
    try { const v = sessionStorage.getItem(KEY(kind)); if (v !== null) return v; } catch { /* use memory */ }
    return this.mem.get(kind) ?? '';
  }

  set(kind: TokenKind, value: string): void {
    this.mem.set(kind, value);
    try { sessionStorage.setItem(KEY(kind), value); } catch { /* memory only */ }
  }
}

export interface ApiResult { readonly status: number; readonly json: any }

/** Calls `/v1/economy/*`. `use` lists the token kinds that may authorise the call, best first; the first one that is set is sent. */
export class EconomyApi {
  private n = 0;

  constructor(readonly tokens: TokenStore, private readonly fetchImpl: typeof fetch = (...a) => fetch(...a)) {}

  requestId(): string { return `ui-${Date.now().toString(36)}-${++this.n}`; }

  async call(method: string, path: string, body?: unknown, use: readonly TokenKind[] = ['read', 'edit', 'activate']): Promise<ApiResult> {
    const token = use.map((k) => this.tokens.get(k)).find((t) => t !== '');
    const res = await this.fetchImpl(`/v1/economy${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let json: unknown = null;
    try { json = await res.json(); } catch { /* empty body */ }
    return { status: res.status, json };
  }
}

/** Structured errors from a failed call: `error.details.errors` (422/409), or a single synthetic one for 401/403/other. */
export function errorsOf(r: ApiResult): { code: string; path?: string; message: string }[] {
  const list = r.json?.error?.details?.errors as { code: string; path?: string; message: string }[] | undefined;
  if (list?.length) return list;
  const code = r.status === 401 ? 'unauthorized' : r.status === 403 ? 'forbidden' : `http_${r.status}`;
  return [{ code, message: r.json?.error?.message ?? r.json?.message ?? `request failed (${r.status})` }];
}
