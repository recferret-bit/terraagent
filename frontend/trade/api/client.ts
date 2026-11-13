import type {
  AgentQuoteResponse, TradeStallResponse, OrderSide, TradeBookOrdersResponse, CancelTradeOrderResponse, CreateTradeKeyRequest, CreateTradeKeyResponse, PlaceTradeOrderRequest, PlaceTradeOrderResponse,
  RevokeTradeKeyResponse, TradeAllowanceUpdate, TradeBalancesResponse, TradeBoardResponse, TradeBookResponse, TradeFillsResponse, TradeKeyListResponse,
  TradeKeyView, TradeOrdersResponse, TradeOverviewResponse, TradePairsResponse, TradePolicyResponse,
} from '@terra/contracts';

/** Stable error of the trade API (`{ error: { code, message, details? } }`) or a transport failure (`network`). */
export class TradeApiFailure extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: Record<string, unknown>) {
    super(message);
  }
}

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

const newKey = (): string => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const enc = encodeURIComponent;

/** Typed client of `/v1/trade/*` for a session / dev identity. Every mutation carries a fresh `Idempotency-Key`. */
export class TradeClient {
  private planetsPromise: Promise<string[]> | null = null;

  constructor(readonly token: string, private readonly doFetch: FetchFn = (i, init) => fetch(i, init)) {}

  authHeaders(): Record<string, string> { return { authorization: `Bearer ${this.token}` }; }

  private async call<T>(method: string, path: string, body?: unknown, idempotent = false): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json', ...this.authHeaders() };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (idempotent) headers['idempotency-key'] = newKey();
    let res: Response;
    try {
      res = await this.doFetch(`/v1/trade${path}`, { method, headers, credentials: 'include', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    } catch (err) {
      throw new TradeApiFailure(0, 'network', err instanceof Error ? err.message : 'Network error');
    }
    const json = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null;
    // placement answers 422 with a body that still carries `status: rejected`: surface it as data, not as a throw
    if (!res.ok && !(json && 'status' in json && 'requestId' in json)) {
      const e = json?.error;
      throw new TradeApiFailure(res.status, e?.code ?? `http_${res.status}`, e?.message ?? `Request failed (${res.status})`, e?.details);
    }
    return json as T;
  }

  pairs = (): Promise<TradePairsResponse> => this.call('GET', '/pairs');
  policy = (): Promise<TradePolicyResponse> => this.call('GET', '/policy');
  overview = (planetId: string): Promise<TradeOverviewResponse> => this.call('GET', `/overview/${enc(planetId)}`);
  book = (planetId: string, pair: string, levels = 20): Promise<TradeBookResponse> => this.call('GET', `/book/${enc(planetId)}/${enc(pair)}?levels=${levels}`);
  board = (planetId: string): Promise<TradeBoardResponse> => this.call('GET', `/board/${enc(planetId)}`);
  orders = (planetId: string, limit = 200): Promise<TradeOrdersResponse> => this.call('GET', `/orders?planetId=${enc(planetId)}&limit=${limit}`);
  fills = (planetId: string): Promise<TradeFillsResponse> => this.call('GET', `/fills?planetId=${enc(planetId)}&limit=100`);
  /** `GET /v1/trade/balances`: the caller's quote tokens and in-orbit cargo (free / reserved / total, same numbers as `/v1/market/:planet`). */
  tradeBalances = (planetId: string): Promise<TradeBalancesResponse> => this.call('GET', `/balances?planetId=${enc(planetId)}`);
  /** Public: every resting order of a pair (best price first per side). With a session `mine` marks the caller's own. */
  bookOrders = (planetId: string, pair: string, side: OrderSide | null, limit = 200): Promise<TradeBookOrdersResponse> =>
    this.call('GET', `/book/${enc(planetId)}/${enc(pair)}/orders?limit=${limit}${side ? `&side=${side}` : ''}`);

  /** `GET /v1/trade/stall`: own hub fee, allowed range, earned fees (session or `?as=` only). */
  getStall = (planetId: string): Promise<TradeStallResponse> => this.call('GET', `/stall?planetId=${enc(planetId)}`);
  /** `PUT /v1/trade/stall`: set the own hub fee in basis points (422 `fee_out_of_range`, 403 `forbidden_scope` for keys). */
  setStall = (planetId: string, bp: number): Promise<TradeStallResponse> => this.call('PUT', '/stall', { bp, planetId }, true);
  place = (req: PlaceTradeOrderRequest): Promise<PlaceTradeOrderResponse> => this.call('POST', '/orders', req, true);
  cancel = (orderId: string): Promise<CancelTradeOrderResponse> => this.call('DELETE', `/orders/${enc(orderId)}`, undefined, true);
  agentQuote = (q: Record<string, string>): Promise<AgentQuoteResponse> => this.call('GET', `/agent/quote?${new URLSearchParams(q)}`);
  keys = (): Promise<TradeKeyListResponse> => this.call('GET', '/keys');
  createKey = (req: CreateTradeKeyRequest): Promise<CreateTradeKeyResponse> => this.call('POST', '/keys', req);
  allowance = (keyId: string, patch: TradeAllowanceUpdate): Promise<TradeKeyView> => this.call('PATCH', `/keys/${enc(keyId)}/allowance`, patch);
  revoke = (keyId: string): Promise<RevokeTradeKeyResponse> => this.call('DELETE', `/keys/${enc(keyId)}`);

  /** Lists planets for the picker: `/v1/dev/planets` in dev, falling back to the pilot's `/v1/me/profile` colonies + `/v1/planets` in production. */
  devPlanets(): Promise<string[]> {
    this.planetsPromise ??= this.loadDevPlanetsList();
    return this.planetsPromise;
  }

  private async loadDevPlanetsList(): Promise<string[]> {
    try {
      const res = await this.doFetch('/v1/dev/planets');
      if (res.ok) {
        const ids = ((await res.json()) as { planets: Array<{ id: string }> }).planets.map((p) => p.id);
        if (ids.length > 0) return ids;
      }
    } catch { /* fallback below */ }
    const out: string[] = [];
    try {
      const profRes = await this.doFetch('/v1/me/profile', { headers: { accept: 'application/json', ...this.authHeaders() }, credentials: 'include' });
      if (profRes.ok) {
        const prof = (await profRes.json()) as { currentColonies?: Array<{ planetId?: string }> };
        for (const c of prof.currentColonies ?? []) {
          if (c.planetId && !out.includes(c.planetId)) out.push(c.planetId);
        }
      }
    } catch { /* ignore */ }
    try {
      const pubRes = await this.doFetch('/v1/planets');
      if (pubRes.ok) {
        const pub = (await pubRes.json()) as { planets?: Array<{ planetId?: string; id?: string }> };
        for (const p of pub.planets ?? []) {
          const id = p.planetId ?? p.id;
          if (id && !out.includes(id)) out.push(id);
        }
      }
    } catch { /* ignore */ }
    return out;
  }

  streamUrl(planetId: string): string { return `/v1/trade/stream?planetId=${enc(planetId)}`; }
  fetchFn(): FetchFn { return this.doFetch; }
}
