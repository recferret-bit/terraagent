import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { AgentQuoteQuery, PlaceTradeOrderRequest } from '@terra/contracts';
import { GamePlanets } from '../../game/game-planets.service.js';
import { TradeAgentService } from '../../market/trade/trade-agent.service.js';
import { TradeAuth, type TradePrincipal } from '../../market/trade/trade-auth.js';
import { TradeOrdersService } from '../../market/trade/trade-orders.service.js';
import { TradeReadService } from '../../market/trade/trade-read.service.js';
import { HOSTED_MCP_TOOLS, runDeterministicRfq } from './mcp-tools.registry.js';

export interface McpJsonRpcResponse {
  readonly jsonrpc: '2.0';
  readonly id: string | number | null;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string; readonly data?: unknown };
}

@Injectable()
export class McpService {
  constructor(
    private readonly auth: TradeAuth,
    private readonly read: TradeReadService,
    private readonly agent: TradeAgentService,
    private readonly orders: TradeOrdersService,
    @Optional() @Inject(GamePlanets) private readonly planets?: GamePlanets,
  ) {}

  async handleJsonRpc(req: IncomingMessage, raw: unknown, asName?: string): Promise<McpJsonRpcResponse> {
    const body = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    const id = (body.id as string | number | null | undefined) ?? null;
    const method = typeof body.method === 'string' ? body.method : '';

    if (body.jsonrpc !== '2.0' || !method) {
      return { jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid JSON-RPC 2.0 request' } };
    }
    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2025-03-26',
          serverInfo: { name: 'terra-agent-mcp', version: '1.0.0' },
          capabilities: { tools: { listChanged: false } },
        },
      };
    }
    if (method === 'tools/list') {
      return { jsonrpc: '2.0', id, result: { tools: HOSTED_MCP_TOOLS } };
    }
    if (method === 'tools/call') {
      return this.executeToolCall(req, id, body.params, asName);
    }
    return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
  }

  private async executeToolCall(
    req: IncomingMessage,
    id: string | number | null,
    paramsRaw: unknown,
    asName?: string,
  ): Promise<McpJsonRpcResponse> {
    const params = typeof paramsRaw === 'object' && paramsRaw !== null ? (paramsRaw as Record<string, unknown>) : {};
    const name = typeof params.name === 'string' ? params.name : '';
    const args = typeof params.arguments === 'object' && params.arguments !== null ? (params.arguments as Record<string, unknown>) : {};
    if (!name) {
      return { jsonrpc: '2.0', id, error: { code: -32602, message: 'tools/call requires params.name' } };
    }
    try {
      const principal = await this.auth.authenticate(req, asName);
      const data = await this.dispatchTool(principal, name, args);
      return {
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data },
      };
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: err instanceof Error ? err.message : 'Tool execution failed' },
      };
    }
  }

  private async dispatchTool(
    p: TradePrincipal,
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (name === 'list_planets' || name === 'get_planets') {
      TradeAuth.require(p, 'read');
      const loaded = this.planets?.loadedIds() ?? [];
      const scoped = p.key?.planetId ? [p.key.planetId] : [];
      const planetIds = [...new Set([...scoped, ...loaded])];
      return { planets: planetIds.length > 0 ? planetIds : ['pl_dev'] };
    }
    if (name === 'list_pairs') {
      TradeAuth.require(p, 'read');
      return this.read.pairs();
    }
    if (name === 'get_orderbook') {
      TradeAuth.require(p, 'read');
      const levels = typeof args.levels === 'number' ? args.levels : undefined;
      return this.read.book(String(args.planetId ?? ''), String(args.pair ?? ''), levels);
    }
    if (name === 'quote_swap' || name === 'request_quote') {
      return this.agent.quote(p, AgentQuoteQuery.parse(args));
    }
    if (name === 'get_balances') {
      return this.read.balances(p, typeof args.planetId === 'string' ? args.planetId : undefined);
    }
    if (name === 'place_order' || name === 'place_signed_intent_order') {
      const { idempotencyKey, ...orderArgs } = args;
      const idem =
        typeof idempotencyKey === 'string' && idempotencyKey.trim()
          ? idempotencyKey.trim()
          : `mcp-${randomUUID().slice(0, 12)}`;
      return (await this.orders.place(p, PlaceTradeOrderRequest.parse({ ttlS: 3600, ...orderArgs }), idem)).body;
    }
    if (name === 'cancel_order') {
      const idem = typeof args.idempotencyKey === 'string' ? args.idempotencyKey : `mcp-${randomUUID().slice(0, 12)}`;
      return (await this.orders.cancel(p, String(args.orderId ?? ''), idem)).body;
    }
    if (name === 'negotiate_rfq') {
      TradeAuth.require(p, 'read');
      return runDeterministicRfq(args);
    }
    throw new Error(`Unknown MCP tool: ${name}`);
  }
}
