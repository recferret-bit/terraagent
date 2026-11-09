import { expect } from './harness';
import type { TradeStepsCtx } from './w13-trade';

/** Shared HTTP / SSE helpers of the W13 bot-API suite (`w13-bots*.ts`): everything goes over the real REST surface of the running stack. */
/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed JSON replies */
export interface Reply { status: number; json: any; headers: Headers }
export interface CallOpts { as?: 'a' | 'b'; key?: string; body?: unknown; idem?: string; raw?: string; headers?: Record<string, string> }
export interface Bot { name: string; ownerId: string; key: string; keyId: string; colonyIndex: number }
export type Who = Bot | 'a' | 'b';
export interface Tok { total: bigint; reserved: bigint; free: bigint }
export interface OrderRow { orderId: string; state: string; side: string; filled: number; amount: number; actorKind: string }

export interface World { ba: Bot; bb: Bot; bc: Bot; bd: Bot; ba2: Bot }

export class BotApi {
  private worldP: Promise<World> | null = null;
  constructor(readonly ctx: TradeStepsCtx) {}

  usdc = (whole: string): string => this.ctx.usdc(whole);
  get pair(): string { return `${this.ctx.water}/USDC`; }
  get pairUrl(): string { return encodeURIComponent(this.pair); }

  async call(method: string, url: string, o: CallOpts = {}): Promise<Reply> {
    const sep = url.includes('?') ? '&' : '?';
    const res = await fetch(`${this.ctx.app}${url}${o.as ? `${sep}as=${o.as}` : ''}`, {
      method,
      headers: { 'content-type': 'application/json', ...(o.key ? { authorization: `Bearer ${o.key}` } : {}), ...(o.idem ? { 'idempotency-key': o.idem } : {}), ...o.headers },
      ...(o.raw !== undefined ? { body: o.raw } : o.body === undefined ? {} : { body: JSON.stringify(o.body) }),
    });
    return { status: res.status, json: await res.json().catch(() => ({})), headers: res.headers };
  }

  trade = (method: string, path: string, o: CallOpts = {}): Promise<Reply> => this.call(method, `/v1/trade${path}`, o);
  dev = (name: string, body: unknown): Promise<Reply> => this.call('POST', `/v1/dev/commands/${name}`, { body });
  fault = (rule: Record<string, unknown>): Promise<Reply> => this.dev('near.mock.fault', rule);
  faultReset = (): Promise<Reply> => this.dev('near.mock.fault', { kind: 'reset' });

  /** A bot with its own API key on sim colony `colonyIndex` (fixture funding in whole tokens). Same name = same owner. */
  async bot(name: string, colonyIndex: number, o: { fund?: Record<string, string>; allowance?: Record<string, unknown>; scopes?: string[] } = {}): Promise<Bot> {
    const r = await this.call('POST', '/v1/dev/trade/bots', { body: { name, planetId: this.ctx.planetId(), colonyIndex, ...(o.fund ? { fund: o.fund } : {}), ...(o.allowance ? { allowance: o.allowance } : {}), ...(o.scopes ? { scopes: o.scopes } : {}) } });
    expect(r.status, `dev bot ${name}: ${JSON.stringify(r.json)}`).toBe(201);
    return { name, ownerId: r.json.ownerId, key: r.json.secret, keyId: r.json.keyId, colonyIndex };
  }

  order(side: 'buy' | 'sell', amount: number, usdcWhole: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { side, resource: this.ctx.water, amount, price: { token: 'USDC', amount: this.usdc(usdcWhole) }, ttlS: 3600, ...(side === 'buy' ? { maxStallFeeBp: 100 } : {}), ...extra };
  }

  private seq = 0;
  idem = (tag: string): string => `bots-${tag}-${Date.now().toString(36)}-${++this.seq}`;

  place = (who: Who, body: Record<string, unknown>, tag = 'o'): Promise<Reply> =>
    typeof who === 'string' ? this.trade('POST', '/orders', { as: who, body: { planetId: this.ctx.planetId(), ...body }, idem: this.idem(tag) }) : this.trade('POST', '/orders', { key: who.key, body, idem: this.idem(tag) });

  mine = (who: Who): CallOpts => (typeof who === 'string' ? { as: who } : { key: who.key });
  private pq = (who: Who, first: boolean): string => (typeof who === 'string' ? `${first ? '?' : '&'}planetId=${this.ctx.planetId()}` : '');

  async balances(who: Who): Promise<{ quote: Record<string, { free: string; reserved: string; total: string }>; inOrbit: Record<string, { free: string; reserved: string; total: string }> }> {
    const r = await this.trade('GET', `/balances${this.pq(who, true)}`, this.mine(who));
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    return r.json;
  }

  /** Total / reserved / free of one token (quote or resource) on the colony of `who`. */
  async tok(who: Who, token: string): Promise<Tok> {
    const b = await this.balances(who);
    const t = b.quote[token] ?? b.inOrbit[token];
    return { total: BigInt(t?.total ?? '0'), reserved: BigInt(t?.reserved ?? '0'), free: BigInt(t?.free ?? '0') };
  }

  async orders(who: Who, query = ''): Promise<OrderRow[]> {
    const r = await this.trade('GET', `/orders?limit=200${query}${this.pq(who, false)}`, this.mine(who));
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    return r.json.orders;
  }

  async openOf(who: Who): Promise<OrderRow[]> { return (await this.orders(who)).filter((o) => ['OPEN', 'PARTIAL'].includes(o.state)); }

  async cancelAll(who: Who): Promise<void> {
    for (const o of await this.openOf(who)) await this.trade('DELETE', `/orders/${o.orderId}`, this.mine(who));
    await expect.poll(async () => (await this.openOf(who)).length, { timeout: 20_000, message: 'resting orders cancelled' }).toBe(0);
  }

  async fills(who: Who): Promise<Array<Record<string, any>>> {
    return (await this.trade('GET', `/fills?limit=200${this.pq(who, false)}`, this.mine(who))).json.fills ?? [];
  }

  /** Funded bot parties on the two scenario colonies: `ba`/`bc` on col_0 (A), `bb`/`bd` on col_1 (B), `ba2` is `ba`'s owner on col_1. Only two sim colonies exist, so bots share the human accounts. */
  world(): Promise<World> {
    return (this.worldP ??= (async () => {
      const fund = { USDC: '300', [this.ctx.water]: '300' };
      return { ba: await this.bot('ba', 0, { fund }), bb: await this.bot('bb', 1, { fund }), bc: await this.bot('bc', 0, { fund }), bd: await this.bot('bd', 1, { fund }), ba2: await this.bot('ba', 1, { fund }) };
    })());
  }

  /** Clean slate: faults off, no open order on either colony (a human session can cancel every order of its colony), no reservation left. */
  async reset(): Promise<void> {
    await this.faultReset();
    for (const who of ['a', 'b'] as const) await this.cancelAll(who);
    await expect.poll(async () => [(await this.tok('a', 'USDC')).reserved, (await this.tok('a', this.ctx.water)).reserved, (await this.tok('b', 'USDC')).reserved, (await this.tok('b', this.ctx.water)).reserved].join(), { timeout: 20_000, message: 'reservations released' }).toBe('0,0,0,0');
  }

  /** Waits until `who` has a fill for `orderId` in `state`; returns it. */
  async waitFill(who: Who, orderId: string, state = 'FINAL', timeout = 60_000): Promise<Record<string, any>> {
    let hit: Record<string, any> | undefined;
    await expect.poll(async () => (hit = (await this.fills(who)).find((f) => f.orderId === orderId && f.state === state)) !== undefined, { timeout, message: `fill of ${orderId} reaches ${state}` }).toBe(true);
    return hit!;
  }

  /** `sell` rests, `buy` crosses it: both orders accepted; returns their ids. */
  async cross(seller: Who, buyer: Who, amount: number, usdcWhole: string): Promise<{ sell: string; buy: string }> {
    const s = await this.place(seller, this.order('sell', amount, usdcWhole), 'xs');
    expect([201, 202], JSON.stringify(s.json)).toContain(s.status);
    const b = await this.place(buyer, this.order('buy', amount, usdcWhole), 'xb');
    expect([201, 202], JSON.stringify(b.json)).toContain(b.status);
    const orderId = async (who: Who, r: Reply, side: string): Promise<string> => {
      if (r.json.order?.orderId) return r.json.order.orderId as string;
      let id = '';
      await expect.poll(async () => (id = (await this.orders(who)).find((o) => o.side === side && o.amount === amount)?.orderId ?? ''), { timeout: 10_000 }).not.toBe('');
      return id;
    };
    return { sell: await orderId(seller, s, 'sell'), buy: await orderId(buyer, b, 'buy') };
  }

  /** The public market snapshot (board rows, recent trades). */
  market(as: 'a' | 'b' = 'a'): Promise<Reply> { return this.call('GET', `/v1/market/${this.ctx.planetId()}`, { as }); }
}

export interface Sse { events: Array<Record<string, any>>; status: number; close(): void; done: Promise<void>; waitFor(pred: (e: Record<string, any>) => boolean, ms?: number): Promise<Record<string, any>> }

/** Opens `/v1/trade/stream` and collects its `data:` events. */
export async function openSse(api: BotApi, o: { key?: string; as?: 'a' | 'b'; query?: string }): Promise<Sse> {
  const ac = new AbortController();
  const q = [o.query, o.as ? `as=${o.as}` : ''].filter(Boolean).join('&');
  const res = await fetch(`${api.ctx.app}/v1/trade/stream${q ? `?${q}` : ''}`, { headers: o.key ? { authorization: `Bearer ${o.key}` } : {}, signal: ac.signal });
  const events: Sse['events'] = [];
  const s: Sse = {
    events, status: res.status, close: () => ac.abort(), done: Promise.resolve(),
    waitFor: async (pred, ms = 30_000) => {
      const until = Date.now() + ms;
      for (;;) {
        const hit = events.find(pred);
        if (hit) return hit;
        if (Date.now() > until) throw new Error(`SSE: no matching event within ${ms} ms; got ${JSON.stringify(events.map((e) => e.type))}`);
        await new Promise((r) => setTimeout(r, 50));
      }
    },
  };
  if (!res.ok || !res.body) { events.push({ type: 'http_error', body: await res.text().catch(() => '') }); return s; }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  s.done = (async () => {
    let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += dec.decode(value, { stream: true });
        for (let i = buf.indexOf('\n\n'); i >= 0; i = buf.indexOf('\n\n')) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (chunk.startsWith('data: ')) events.push(JSON.parse(chunk.slice(6)));
        }
      }
    } catch { /* aborted */ }
  })();
  return s;
}
