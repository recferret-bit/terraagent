import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  MARKET_TOKENS, fromChainUnits, marketOrderRef, toChainUnits, type MarketTokenKey, type SimCommandV1,
} from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { expect } from 'vitest';
import { createApp } from '../../src/app.js';
import type { PlanetEventOf } from '../../src/bus/channels.js';
import { EventBus } from '../../src/bus/event-bus.js';
import { GamePlanets } from '../../src/game/game-planets.service.js';
import { MarketBooks } from '../../src/market/book/market-books.js';
import { MarketFaucetService } from '../../src/market/dev/market-faucet.service.js';
import { OrderRelease } from '../../src/market/orders/cancel-order.service.js';
import { OrderExpirySweep } from '../../src/market/orders/expiry-sweep.js';
import { MarketColonies } from '../../src/market/orders/market-colonies.js';
import { MarketPolicyProvider } from '../../src/market/orders/market-policy.provider.js';
import type { NearMarketCommandBusEvent } from '../../src/market/orders/market-sim-gateway.js';
import { OrderFunds } from '../../src/market/orders/order-funds.js';
import { PlaceOrderService } from '../../src/market/orders/place-order.service.js';
import { PriceBoardService } from '../../src/market/board/price-board.service.js';
import { IntentTradeRepository } from '../../src/market/settlement/intent-trade.repository.js';
import { TradeRecovery } from '../../src/market/settlement/trade-recovery.service.js';
import { TradeSettlement, type MarketTradeBusEvent } from '../../src/market/settlement/trade-settlement.service.js';
import { TradeSimPort } from '../../src/market/trade/trade-sim.port.js';
import { OutboxRelayService } from '../../src/near/application/outbox/outbox.module.js';
import { IntentsPort } from '../../src/near/application/ports/intents.port.js';
import type { MockIntentsAdapter } from '../../src/near/infrastructure/adapters/mock/intents.adapter.js';
import { mockChainControls } from '../../src/near/infrastructure/mock/mock-controls.js';
import { devPlayerId } from '../../src/ws/session-verifier.js';

export { mockChainControls };
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const tokenId = (k: MarketTokenKey): string => MARKET_TOKENS[k].verifierId;
export const PLATFORM = 'platform.terraagent.mock';

export interface Reply<T = any> { status: number; body: T }
export type Body = Record<string, unknown>;

/** The sell/buy body of a trade API order: `total` is the quote atomic of the WHOLE order. */
export const ord = (side: 'buy' | 'sell', amount: number, total: bigint | number | string, over: Body = {}): Body => ({
  side, resource: 'bio.water', amount, price: { token: 'USDC', amount: String(total) }, ttlS: 3600, ...(side === 'buy' ? { maxStallFeeBp: 100 } : {}), ...over,
});

export interface Actor {
  readonly kind: 'player' | 'bot';
  readonly name: string;
  readonly ownerId: string;
  readonly idx: number;
  readonly colonyId: string;
  readonly accountId: string;
  readonly planetId: string;
  readonly secret?: string;
  readonly keyId?: string;
  req<T = any>(method: string, path: string, o?: { body?: unknown; idem?: string; auth?: string | null }): Promise<Reply<T>>;
  place(body: Body, idem?: string): Promise<Reply>;
  cancel(orderId: string, idem?: string): Promise<Reply>;
  bal(token: MarketTokenKey): Promise<bigint>;
  fund(token: MarketTokenKey, atomic: bigint): Promise<void>;
}

export interface World {
  readonly planetId: string;
  bot(o?: { name?: string; fund?: Partial<Record<MarketTokenKey, string>>; allowance?: Body; scopes?: string[]; stallBp?: number }): Promise<Actor>;
  player(o?: { name?: string; stallBp?: number }): Promise<Actor>;
}

const SEATS = Array.from({ length: 600 }, (_, i) => i);

/** Boots the real app on a throwaway Postgres (or reboots it on the same database) with the fake planet sim in front of the trade API. */
export class Exchange {
  db!: TestDatabase;
  app!: INestApplication;
  url!: string;
  cmds: NearMarketCommandBusEvent[] = [];
  pushes: MarketTradeBusEvent[] = [];
  simCmds: SimCommandV1[] = [];
  /** Stall fee the stand-in sim attaches to orders of a colony index (default 100 bp). */
  stallBp = new Map<number, number>();
  /** Emulates the sim version that echoes the command id in `marketOrderRequested`. */
  echoCommandId = false;
  private nextIdx = 1;
  private readonly planets: string[] = [];
  private readonly orderSeq = new Map<string, number>();
  private envExtra: Record<string, string> = {};

  static async boot(env: Record<string, string> = {}): Promise<Exchange> {
    const ex = new Exchange();
    ex.envExtra = env;
    ex.db = await createTestDatabase();
    await ex.start();
    return ex;
  }

  async start(): Promise<void> {
    const { app } = await createApp({
      source: {
        NODE_ENV: 'test', LOG_LEVEL: 'silent', SIM_THREADS: '1', SNAPSHOTS: 'off', DATABASE_URL: this.db.url, OUTBOX_RELAY_ENABLED: 'false',
        MOCK_LATENCY_MIN_MS: '0', MOCK_LATENCY_MAX_MS: '0', ...this.envExtra,
      },
    });
    this.app = app;
    // listeners first: boot recovery (module init) already sends notifications
    const bus = app.get(EventBus);
    bus.on('near.market.command', (c) => this.cmds.push(c), { module: 'exchange-test' });
    bus.on('market.trade', (p) => this.pushes.push(p), { module: 'exchange-test' });
    await app.init();
    for (const p of this.planets) app.get(GamePlanets).markScenarioColonyPlanet(p, SEATS);
    app.get(TradeSimPort).override = (planetId, cmd) => this.fakeSim(planetId, cmd);
    await app.listen(0, '127.0.0.1');
    this.url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    await (this.get(IntentsPort) as unknown as MockIntentsAdapter).testRegisterSigner(PLATFORM);
  }

  /** Stops the app but keeps the database (a process kill). The next `start()` runs boot recovery. */
  async stop(): Promise<void> {
    mockChainControls.reset();
    await this.app.close();
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  async close(): Promise<void> {
    mockChainControls.reset();
    await this.app?.close();
    await this.db?.drop();
  }

  get<T>(token: abstract new (...a: never[]) => T): T {
    return this.app.get(token as never, { strict: false });
  }
  get intents(): MockIntentsAdapter { return this.get(IntentsPort) as unknown as MockIntentsAdapter; }
  get relay(): OutboxRelayService { return this.get(OutboxRelayService); }
  get settlement(): TradeSettlement { return this.get(TradeSettlement); }
  get recovery(): TradeRecovery { return this.get(TradeRecovery); }
  get trades(): IntentTradeRepository { return this.get(IntentTradeRepository); }
  get release(): OrderRelease { return this.get(OrderRelease); }
  get books(): MarketBooks { return this.get(MarketBooks); }
  get funds(): OrderFunds { return this.get(OrderFunds); }
  get place(): PlaceOrderService { return this.get(PlaceOrderService); }
  get sweep(): OrderExpirySweep { return this.get(OrderExpirySweep); }
  get board(): PriceBoardService { return this.get(PriceBoardService); }
  get policy(): MarketPolicyProvider { return this.get(MarketPolicyProvider); }
  get prisma(): TestDatabase['prisma'] { return this.db.prisma; }

  // --- the stand-in planet sim ------------------------------------------------------------------------------------
  /** Validates like the sim's `market.placeOrder` (lot, TTL options, fee range, min notional) and emits the event the sim emits. */
  private async fakeSim(planetId: string, cmd: SimCommandV1) {
    const reject = (code: string, detail: string) => ({ ok: false, code, detail }) as never;
    const colonyId = `col_${cmd.colonyIndex}`;
    const cfg = this.policy.current();
    if (cmd.kind === 'market.placeOrder') {
      const a = cmd.args as { side: string; resource: string; amount: number; price: { token: MarketTokenKey; amount: string }; ttlS: number; maxStallFeeBp?: number };
      if (!Number.isInteger(a.amount) || a.amount <= 0 || a.amount % cfg.baseLotUnits !== 0) return reject('invalid_args', 'amount must be a positive multiple of the lot');
      if (!cfg.ttlOptionsS.includes(a.ttlS)) return reject('invalid_args', 'ttlS is not one of the policy options');
      if (a.maxStallFeeBp !== undefined && (a.maxStallFeeBp < cfg.stallFeeMinBp || a.maxStallFeeBp > cfg.stallFeeMaxBp)) return reject('fee_out_of_range', 'maxStallFeeBp out of range');
      const pair = cfg.pairs.find((p) => p.pair === `${a.resource}/${a.price.token}`);
      if (pair && BigInt(a.price.amount) < BigInt(pair.minNotionalAtomic)) return reject('order_too_small', `below the minimum notional (${pair.minNotionalAtomic})`);
      const orderSeq = (this.orderSeq.get(`${planetId}${colonyId}`) ?? 0) + 1;
      this.orderSeq.set(`${planetId}${colonyId}`, orderSeq);
      this.get(EventBus).emit('planet.event', {
        planetId, tick: 1, kind: 'marketOrderRequested', severity: 'info', colonyIds: [colonyId],
        data: { ref: marketOrderRef(colonyId, orderSeq), orderSeq, colonyId, colonyIndex: cmd.colonyIndex, ...a, stallFeeBp: this.stallBp.get(cmd.colonyIndex ?? 0) ?? 100, hubEntityId: 3, ...(this.echoCommandId ? { commandId: cmd.commandId } : {}) },
      } as unknown as PlanetEventOf<'marketOrderRequested'>);
    } else if (cmd.kind === 'market.cancelOrder') {
      this.get(EventBus).emit('planet.event', {
        planetId, tick: 2, kind: 'marketCancelRequested', severity: 'info', colonyIds: [colonyId],
        data: { colonyId, colonyIndex: cmd.colonyIndex, orderId: (cmd.args as { orderId: string }).orderId },
      } as unknown as PlanetEventOf<'marketCancelRequested'>);
    } else if (cmd.kind === 'market.setHubFee') {
      const bp = (cmd.args as { bp: number }).bp;
      if ((cmd.source as string) !== 'player') return { ok: false, code: 'not_authorized' } as never;
      if (bp < cfg.stallFeeMinBp || bp > cfg.stallFeeMaxBp) return reject('fee_out_of_range', 'stall fee out of range');
      const previousBp = this.stallBp.get(cmd.colonyIndex ?? 0) ?? 100;
      this.stallBp.set(cmd.colonyIndex ?? 0, bp);
      this.get(EventBus).emit('planet.event', {
        planetId, tick: 3, kind: 'marketHubFeeSet', severity: 'info', colonyIds: [colonyId],
        data: { colonyId, colonyIndex: cmd.colonyIndex, hubEntityId: 3, bp, previousBp },
      } as unknown as PlanetEventOf<'marketHubFeeSet'>);
    }
    this.simCmds.push(cmd);
    return { ok: true, commandId: cmd.commandId, appliedAtTick: 1 } as never;
  }

  // --- worlds and actors ---------------------------------------------------------------------------------------------
  world(): World {
    const planetId = `px${randomUUID().slice(0, 8)}`;
    this.planets.push(planetId);
    this.app.get(GamePlanets).markScenarioColonyPlanet(planetId, SEATS);
    const w: World = {
      planetId,
      bot: (o = {}) => this.makeBot(planetId, o),
      player: (o = {}) => this.makePlayer(planetId, o),
    };
    return w;
  }

  private async call<T>(method: string, path: string, o: { body?: unknown; idem?: string; auth?: string | null; as?: string } = {}): Promise<Reply<T>> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (o.auth) headers.authorization = `Bearer ${o.auth}`;
    if (o.idem) headers['idempotency-key'] = o.idem;
    const q = o.as ? `${path.includes('?') ? '&' : '?'}as=${o.as}` : '';
    const r = await fetch(`${this.url}/v1${path}${q}`, { method, headers, ...(o.body === undefined ? {} : { body: typeof o.body === 'string' ? o.body : JSON.stringify(o.body) }) });
    const text = await r.text();
    let body: unknown = {};
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    return { status: r.status, body: body as T };
  }

  /** Raw call for tests that hit the API without an actor (public reads, forged keys). */
  api = <T = any>(method: string, path: string, o: { body?: unknown; idem?: string; auth?: string | null; as?: string } = {}): Promise<Reply<T>> => this.call<T>(method, path, o);

  private actor(base: { kind: 'player' | 'bot'; name: string; ownerId: string; idx: number; accountId: string; planetId: string; secret?: string; keyId?: string }): Actor {
    const ex = this;
    const auth = base.kind === 'bot' ? base.secret! : null;
    const req = <T = any>(method: string, path: string, o: { body?: unknown; idem?: string; auth?: string | null } = {}) =>
      ex.call<T>(method, path, { ...o, auth: o.auth === undefined ? auth : o.auth, ...(base.kind === 'player' && o.auth === undefined ? { as: base.name } : {}) });
    const a: Actor = {
      ...base, colonyId: `col_${base.idx}`, req,
      place: (body, idem) => req('POST', '/trade/orders', { body: { planetId: base.planetId, ...body }, idem: idem ?? randomUUID() }),
      cancel: (orderId, idem) => req('DELETE', `/trade/orders/${orderId}`, idem ? { idem } : {}),
      async bal(token) {
        const row = await ex.prisma.mockChainIntentsBalance.findUnique({ where: { accountId_tokenId: { accountId: base.accountId, tokenId: tokenId(token) } } });
        return row ? fromChainUnits(token, row.amount.toFixed()) : 0n;
      },
      async fund(token, atomic) { await ex.get(MarketFaucetService).fund(base.accountId, token, atomic); },
    };
    return a;
  }

  private async makeBot(planetId: string, o: Parameters<World['bot']>[0] = {}): Promise<Actor> {
    const idx = this.nextIdx++;
    const name = o.name ?? `bot${idx}`;
    if (o.stallBp !== undefined) this.stallBp.set(idx, o.stallBp);
    const fund = o.fund ?? { USDC: '1000', 'bio.water': '500' };
    const r = await this.call<{ keyId: string; secret: string; ownerId: string; accountId?: string }>('POST', '/dev/trade/bots', {
      body: { name, planetId, colonyIndex: idx, fund, ...(o.allowance ? { allowance: o.allowance } : {}), ...(o.scopes ? { scopes: o.scopes } : {}) },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const row = await this.prisma.tradeApiKey.findUniqueOrThrow({ where: { keyId: r.body.keyId } });
    return this.actor({ kind: 'bot', name, ownerId: r.body.ownerId, idx, accountId: row.accountId, planetId, secret: r.body.secret, keyId: r.body.keyId });
  }

  private async makePlayer(planetId: string, o: Parameters<World['player']>[0] = {}): Promise<Actor> {
    const idx = this.nextIdx++;
    const name = (o.name ?? `pl${idx}`).toLowerCase();
    if (o.stallBp !== undefined) this.stallBp.set(idx, o.stallBp);
    const ownerId = devPlayerId(name);
    await this.prisma.player.upsert({ where: { id: ownerId }, create: { id: ownerId, handle: name }, update: {} });
    await this.prisma.colony.create({ data: { id: `co_${name}_${idx}`, playerId: ownerId, planetId, colonyIndex: idx, name: `C${idx}` } });
    const colony = await this.get(MarketColonies).resolve(planetId, idx, `co_${name}_${idx}`, ownerId);
    await this.intents.testRegisterSigner(colony.accountId);
    return this.actor({ kind: 'player', name, ownerId, idx, accountId: colony.accountId, planetId });
  }

  /** Places an order straight through `PlaceOrderService` with an explicit actor kind (fixture / subsidy / npc: not reachable over REST). */
  async placeAs(actor: Actor, actorKind: 'fixture' | 'subsidy' | 'npc' | 'guild', over: Body): Promise<void> {
    const orderSeq = (this.orderSeq.get(`${actor.planetId}${actor.colonyId}`) ?? 0) + 1000;
    this.orderSeq.set(`${actor.planetId}${actor.colonyId}`, orderSeq);
    const ev = {
      planetId: actor.planetId, tick: 1, kind: 'marketOrderRequested', severity: 'info', colonyIds: [actor.colonyId],
      data: { ref: marketOrderRef(actor.colonyId, orderSeq), orderSeq, colonyId: actor.colonyId, colonyIndex: actor.idx, resource: 'bio.water', amount: 10, ttlS: 3600, stallFeeBp: 100, hubEntityId: 3, ...over },
    } as unknown as PlanetEventOf<'marketOrderRequested'>;
    await this.place.handle(ev, { actorKind, answerSim: false });
  }

  // --- chain drivers and observers ---------------------------------------------------------------------------------
  /** Runs the relay until nothing is due (every outbox row due now); returns the rows processed. */
  async settle(maxRounds = 40): Promise<number> {
    let total = 0;
    for (let i = 0; i < maxRounds; i++) {
      await this.prisma.$executeRaw`UPDATE chain.chain_outbox SET next_attempt_at = now() WHERE status IN ('PENDING', 'FAILED')`;
      const n = await this.relay.pollOnce();
      total += n;
      if (n === 0) break;
    }
    return total;
  }

  /** Every verifier balance in chain units, `account|tokenId`. */
  async ledger(): Promise<Map<string, bigint>> {
    const m = new Map<string, bigint>();
    for (const r of await this.prisma.mockChainIntentsBalance.findMany()) m.set(`${r.accountId}|${r.tokenId}`, BigInt(r.amount.toFixed()));
    return m;
  }

  /** Per-token total over the verifier ledger plus the cargo FT ledger (chain units): the quantity every trade must conserve. */
  async supply(): Promise<Record<string, bigint>> {
    const out: Record<string, bigint> = {};
    for (const r of await this.prisma.mockChainIntentsBalance.findMany()) out[r.tokenId] = (out[r.tokenId] ?? 0n) + BigInt(r.amount.toFixed());
    for (const r of await this.prisma.mockChainBalance.findMany()) out[`ft:${r.tokenId}`] = (out[`ft:${r.tokenId}`] ?? 0n) + BigInt(r.amount.toFixed());
    return out;
  }

  async balOf(account: string, token: MarketTokenKey): Promise<bigint> {
    const row = await this.prisma.mockChainIntentsBalance.findUnique({ where: { accountId_tokenId: { accountId: account, tokenId: tokenId(token) } } });
    return row ? fromChainUnits(token, row.amount.toFixed()) : 0n;
  }

  tradesOf(planetId: string) { return this.prisma.intentTrade.findMany({ where: { planetId }, orderBy: { id: 'asc' } }); }
  ordersOf(planetId: string) { return this.prisma.marketOrder.findMany({ where: { planetId }, orderBy: { id: 'asc' } }); }
  order(orderId: string) { return this.prisma.marketOrder.findUniqueOrThrow({ where: { orderId } }); }
  settledCmds(tradeId: string) { return this.cmds.filter((c) => c.kind === 'market.settled' && (c.args as { tradeId: string }).tradeId === tradeId); }
  releasesOf(orderId: string) { return this.cmds.filter((c) => c.kind === 'market.release' && (c.args as { orderId?: string }).orderId === orderId); }

  /** Waits until `fn` returns a truthy value (polling), or fails the test. */
  async until<T>(fn: () => Promise<T | false | null | undefined>, ms = 8000, label = 'condition'): Promise<T> {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
      await sleep(40);
    }
  }
}

/** Independent bigint fee math (floor, cumulative): the expectation the settled ledger is compared with. */
export const floorBp = (x: bigint, bp: number): bigint => (x * BigInt(bp)) / 10_000n;
export const notionalOf = (total: bigint, amount: bigint, cumQty: bigint): bigint => (cumQty * total) / amount;
