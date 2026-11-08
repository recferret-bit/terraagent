import type { IncomingMessage } from 'node:http';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Req, Res, UseFilters, UseGuards } from '@nestjs/common';
import {
  AgentQuoteQuery, CreateTradeKeyRequest, TradeFillsQuery, TradeBookQuery, TradeBookOrdersQuery, ListTradeOrdersQuery, PlaceTradeOrderRequest, PutTradeStallRequest, TradeAllowanceUpdate, TradeStallQuery,
  type AgentQuoteResponse, type CancelTradeOrderResponse, type CreateTradeKeyResponse, type PlaceTradeOrderResponse, type RevokeTradeKeyResponse, type TradeBalancesResponse,
  type TradeBoardResponse, type TradeBookOrdersResponse, type TradeBookResponse, type TradeFillsResponse, type TradeKeyListResponse, type TradeKeyView, type TradeOrdersResponse,
  type TradeOverviewResponse, type TradePairsResponse, type TradePolicyResponse, type TradeStallResponse,
} from '@terra/contracts';
import type { ZodType } from 'zod';
import type { HttpRes } from '../../core/logging/request-id.js';
import { TradeInputGuard } from './trade-input.guard.js';
import { TradeAuth, type TradePrincipal } from './trade-auth.js';
import { TradeError, TradeErrorFilter } from './trade-error.js';
import { TradeKeysService } from './trade-keys.service.js';
import { TradeOrdersService, type HttpResult } from './trade-orders.service.js';
import { TradeReadService } from './trade-read.service.js';
import { TradeAgentService } from './trade-agent.service.js';
import { TradeStallService } from './trade-stall.service.js';
import { TradeStreamService } from './trade-stream.service.js';

/** Strict zod parse of a body/query; failures are `invalid_request` with the issue list. */
export function parseBody<T>(schema: ZodType<T>, raw: unknown): T {
  const r = schema.safeParse(raw ?? {});
  if (!r.success) throw new TradeError('invalid_request', 'The request does not match the schema.', { issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
  return r.data;
}

/** `decodeURIComponent` of an already route-decoded param (`%2F` pairs): a malformed escape is a 400, never a thrown URIError (500). */
export function pairParam(raw: string): string {
  try { return decodeURIComponent(raw); } catch { throw new TradeError('invalid_request', 'Malformed pair id.'); }
}

/**
 * The trade API (W13): one controller for humans (session / `?as=` dev identity, actor `player`) and bots (API key bearer,
 * actor `bot`). Routes, schemas and auth are listed in `TRADE_API_ROUTES` (`@terra/contracts`); curl examples in `market/README.md`.
 */
@Controller('trade')
@UseGuards(TradeInputGuard)
@UseFilters(TradeErrorFilter)
export class TradeController {
  constructor(
    private readonly auth: TradeAuth,
    private readonly orders: TradeOrdersService,
    private readonly read: TradeReadService,
    private readonly keys: TradeKeysService,
    private readonly stream: TradeStreamService,
    private readonly agent: TradeAgentService,
    private readonly stall: TradeStallService,
  ) {}

  private who(req: IncomingMessage, as?: string): Promise<TradePrincipal> {
    this.orders.gate();
    return this.auth.authenticate(req, as);
  }

  private static reply<T>(res: HttpRes, r: HttpResult<T>): T {
    res.statusCode = r.status;
    return r.body;
  }

  // --- keys ---------------------------------------------------------------------------------------------------
  @Post('keys')
  @HttpCode(201)
  async createKey(@Req() req: IncomingMessage, @Query('as') as: string | undefined, @Body() body: unknown): Promise<CreateTradeKeyResponse> {
    return this.keys.create(await this.who(req, as), parseBody(CreateTradeKeyRequest, body));
  }

  @Get('keys')
  async listKeys(@Req() req: IncomingMessage, @Query('as') as?: string): Promise<TradeKeyListResponse> {
    return this.keys.list(await this.who(req, as));
  }

  @Patch('keys/:keyId/allowance')
  async allowance(@Req() req: IncomingMessage, @Param('keyId') keyId: string, @Body() body: unknown, @Query('as') as?: string): Promise<TradeKeyView> {
    return this.keys.updateAllowance(await this.who(req, as), keyId, parseBody(TradeAllowanceUpdate, body));
  }

  @Delete('keys/:keyId')
  async revoke(@Req() req: IncomingMessage, @Param('keyId') keyId: string, @Query('as') as?: string): Promise<RevokeTradeKeyResponse> {
    return this.keys.revoke(await this.who(req, as), keyId);
  }

  // --- orders -------------------------------------------------------------------------------------------------
  @Post('orders')
  async place(
    @Req() req: IncomingMessage, @Res({ passthrough: true }) res: HttpRes, @Body() body: unknown, @Query('as') as?: string,
  ): Promise<PlaceTradeOrderResponse> {
    const p = await this.who(req, as);
    const idem = req.headers['idempotency-key'];
    return TradeController.reply(res, await this.orders.place(p, parseBody(PlaceTradeOrderRequest, body), Array.isArray(idem) ? idem[0] : idem));
  }

  @Delete('orders/:orderId')
  async cancel(@Req() req: IncomingMessage, @Res({ passthrough: true }) res: HttpRes, @Param('orderId') orderId: string, @Query('as') as?: string): Promise<CancelTradeOrderResponse> {
    const p = await this.who(req, as);
    const idem = req.headers['idempotency-key'];
    return TradeController.reply(res, await this.orders.cancel(p, orderId, Array.isArray(idem) ? idem[0] : idem));
  }

  @Get('orders')
  async listOrders(@Req() req: IncomingMessage, @Query() query: Record<string, string>, @Query('as') as?: string): Promise<TradeOrdersResponse> {
    return this.read.listOrders(await this.who(req, as), parseBody(ListTradeOrdersQuery, query));
  }

  @Get('fills')
  async fills(@Req() req: IncomingMessage, @Query('planetId') planetId?: string, @Query('limit') limit?: string, @Query('as') as?: string): Promise<TradeFillsResponse> {
    const q = parseBody(TradeFillsQuery, { planetId, limit });
    return this.read.listFills(await this.who(req, as), q.planetId, q.limit);
  }

  @Get('balances')
  async balances(@Req() req: IncomingMessage, @Query('planetId') planetId?: string, @Query('as') as?: string): Promise<TradeBalancesResponse> {
    return this.read.balances(await this.who(req, as), planetId);
  }

  // --- stall (hub fee) ----------------------------------------------------------------------------------------
  @Get('stall')
  async getStall(@Req() req: IncomingMessage, @Query() query: Record<string, string>, @Query('as') as?: string): Promise<TradeStallResponse> {
    const { as: _as, ...rest } = query;
    return this.stall.get(await this.who(req, as), parseBody(TradeStallQuery, rest).planetId);
  }

  @Put('stall')
  async setStall(@Req() req: IncomingMessage, @Body() body: unknown, @Query('as') as?: string): Promise<TradeStallResponse> {
    return this.stall.set(await this.who(req, as), parseBody(PutTradeStallRequest, body));
  }

  /** Deterministic bid/ask + reason codes from the quote library; the order bodies can be POSTed as they are. */
  @Get('agent/quote')
  async agentQuote(@Req() req: IncomingMessage, @Query() query: Record<string, string>, @Query('as') as?: string): Promise<AgentQuoteResponse> {
    return this.agent.quote(await this.who(req, as), parseBody(AgentQuoteQuery, query));
  }

  // --- public market data -------------------------------------------------------------------------------------
  @Get('book/:planetId/:pair')
  book(@Req() req: IncomingMessage, @Param('planetId') planetId: string, @Param('pair') pair: string, @Query('levels') levels?: string): Promise<TradeBookResponse> {
    this.auth.throttlePublic(req);
    return this.read.book(planetId, pairParam(pair), parseBody(TradeBookQuery, { levels }).levels);
  }

  /** Public list of every resting order of the pair; a bearer token / `?as=` identity only adds `mine`. */
  @Get('book/:planetId/:pair/orders')
  async bookOrders(
    @Req() req: IncomingMessage, @Param('planetId') planetId: string, @Param('pair') pair: string, @Query() query: Record<string, string>, @Query('as') as?: string,
  ): Promise<TradeBookOrdersResponse> {
    this.orders.gate();
    this.auth.throttlePublic(req);
    const q = parseBody(TradeBookOrdersQuery, { side: query.side, limit: query.limit });
    const p = req.headers.authorization || as ? await this.auth.authenticate(req, as) : null;
    return this.read.bookOrders(planetId, pairParam(pair), q, p);
  }

  @Get('board/:planetId')
  board(@Req() req: IncomingMessage, @Param('planetId') planetId: string): Promise<TradeBoardResponse> {
    this.auth.throttlePublic(req);
    return this.read.board(planetId);
  }

  /** Every tradable pair's best bid / ask, last and 24 h volume; counts as ONE public request. */
  @Get('overview/:planetId')
  overview(@Req() req: IncomingMessage, @Param('planetId') planetId: string): Promise<TradeOverviewResponse> {
    this.auth.throttlePublic(req);
    return this.read.overview(planetId);
  }

  @Get('pairs')
  pairs(@Req() req: IncomingMessage): TradePairsResponse {
    this.auth.throttlePublic(req);
    return this.read.pairs();
  }

  @Get('policy')
  async policy(@Req() req: IncomingMessage, @Query('as') as?: string): Promise<TradePolicyResponse> {
    this.orders.gate();
    if (!req.headers.authorization) this.auth.throttlePublic(req);
    const p = req.headers.authorization ? await this.auth.authenticate(req, as) : null;
    return this.read.policyView(p);
  }

  // --- push stream --------------------------------------------------------------------------------------------
  @Get('stream')
  async events(@Req() req: IncomingMessage, @Res() res: HttpRes, @Query('planetId') planetId?: string, @Query('pairs') pairs?: string, @Query('as') as?: string): Promise<void> {
    await this.stream.open(await this.who(req, as), res, planetId, pairs ? pairs.split(',').filter(Boolean) : []);
  }
}
