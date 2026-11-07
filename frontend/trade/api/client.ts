import { isResourceToken, type MarketTokenKey } from '@terra/contracts';
import type {
  AgentQuoteResponse, CancelTradeOrderResponse, CreateTradeKeyRequest, CreateTradeKeyResponse, PlaceTradeOrderRequest, PlaceTradeOrderResponse,
  RevokeTradeKeyResponse, TradeAllowanceUpdate, TradeBalancesResponse, TradeBoardResponse, TradeBookResponse, TradeFillsResponse, TradeKeyListResponse,
  TradeKeyView, TradeOrdersResponse, TradePairsResponse, TradePolicyResponse,
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
  constructor(private readonly token: string, private readonly doFetch: FetchFn = (i, init) => fetch(i, init)) {}

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
  book = (planetId: string, pair: string, levels = 20): Promise<TradeBookResponse> => this.call('GET', `/book/${enc(planetId)}/${enc(pair)}?levels=${levels}`);
  board = (planetId: string): Promise<TradeBoardResponse> => this.call('GET', `/board/${enc(planetId)}`);
  orders = (planetId: string, limit = 200): Promise<TradeOrdersResponse> => this.call('GET', `/orders?planetId=${enc(planetId)}&limit=${limit}`);
  fills = (planetId: string): Promise<TradeFillsResponse> => this.call('GET', `/fills?planetId=${enc(planetId)}&limit=100`);
  /** Raw `GET /v1/trade/balances` (kept for when the backend counts verifier-held cargo; see `balances`). */
  tradeBalances = (planetId: string): Promise<TradeBalancesResponse> => this.call('GET', `/balances?planetId=${enc(planetId)}`);

  /**
   * The caller's balances from the market snapshot (`GET /v1/market/:planet`: free = cargo + verifier - reservations, caller only).
   * `/v1/trade/balances` reads only the cargo ledger, so cargo already deposited at the verifier (a fixture seat, or the part of a
   * resting sell) is missing from it; the snapshot has the right free / reserved. Returns null when the caller has no colony here.
   */
  async balances(planetId: string): Promise<TradeBalancesResponse | null> {
    const res = await this.doFetch(`/v1/market/${enc(planetId)}`, { headers: { accept: 'application/json', ...this.authHeaders() }, credentials: 'include' });
    const json = (await res.json().catch(() => null)) as { balances?: Record<string, string>; reserved?: Record<string, string>; error?: { code?: string; message?: string } } | null;
    if (!res.ok) throw new TradeApiFailure(res.status, json?.error?.code ?? `http_${res.status}`, json?.error?.message ?? `Balances failed (${res.status})`);
    if (!json?.balances) return null;
    const out: TradeBalancesResponse = { planetId, colonyId: 'your colony', quote: {}, inOrbit: {} };
    for (const token of new Set([...Object.keys(json.balances), ...Object.keys(json.reserved ?? {})]) as Set<MarketTokenKey>) {
      const free = BigInt(json.balances[token] ?? '0');
      const reserved = BigInt(json.reserved?.[token] ?? '0');
      const row = { free: free.toString(), reserved: reserved.toString(), total: (free + reserved).toString() };
      if (isResourceToken(token)) (out.inOrbit as Record<string, typeof row>)[token] = row; else (out.quote as Record<string, typeof row>)[token] = row;
    }
    return out;
  }
  place = (req: PlaceTradeOrderRequest): Promise<PlaceTradeOrderResponse> => this.call('POST', '/orders', req, true);
  cancel = (orderId: string): Promise<CancelTradeOrderResponse> => this.call('DELETE', `/orders/${enc(orderId)}`, undefined, true);
  agentQuote = (q: Record<string, string>): Promise<AgentQuoteResponse> => this.call('GET', `/agent/quote?${new URLSearchParams(q)}`);
  keys = (): Promise<TradeKeyListResponse> => this.call('GET', '/keys');
  createKey = (req: CreateTradeKeyRequest): Promise<CreateTradeKeyResponse> => this.call('POST', '/keys', req);
  allowance = (keyId: string, patch: TradeAllowanceUpdate): Promise<TradeKeyView> => this.call('PATCH', `/keys/${enc(keyId)}/allowance`, patch);
  revoke = (keyId: string): Promise<RevokeTradeKeyResponse> => this.call('DELETE', `/keys/${enc(keyId)}`);

  /** Dev only: the planets the app has loaded (no production endpoint lists a player's planets). */
  async devPlanets(): Promise<string[]> {
    try {
      const res = await this.doFetch('/v1/dev/planets');
      if (!res.ok) return [];
      return ((await res.json()) as { planets: Array<{ id: string }> }).planets.map((p) => p.id);
    } catch { return []; }
  }

  streamUrl(planetId: string): string { return `/v1/trade/stream?planetId=${enc(planetId)}`; }
  fetchFn(): FetchFn { return this.doFetch; }
}
