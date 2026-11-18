import { z } from 'zod';
import { negotiateAgentQuote, type NegotiationResult } from '../colony-agent/agent-commerce.js';

export const HOSTED_MCP_TOOLS = [
  {
    name: 'list_planets',
    description: 'List active planets hosting live NEP-245 / NEAR Intents commodity orderbooks.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_pairs',
    description: 'List active colony trading pairs and settlement lot constraints.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_orderbook',
    description: 'Read live orderbook depth and organic VWAP reference price for a planet pair.',
    inputSchema: {
      type: 'object',
      properties: {
        planetId: { type: 'string' },
        pair: { type: 'string' },
        levels: { type: 'number' },
      },
      required: ['planetId', 'pair'],
    },
  },
  {
    name: 'quote_swap',
    description: 'Compute deterministic sim bid/ask quote and ready-to-submit order bodies.',
    inputSchema: {
      type: 'object',
      properties: {
        planetId: { type: 'string' },
        resource: { type: 'string' },
        quote: { type: 'string' },
      },
      required: ['resource', 'quote'],
    },
  },
  {
    name: 'get_balances',
    description: 'Inspect free, reserved, and total NEP-245 cargo & quote balances for the caller colony.',
    inputSchema: { type: 'object', properties: { planetId: { type: 'string' } } },
  },
  {
    name: 'place_order',
    description: 'Submit a limit order on the NEAR Intents CLOB (subject to bot key allowance & daily budget).',
    inputSchema: {
      type: 'object',
      properties: {
        planetId: { type: 'string' },
        side: { type: 'string', enum: ['buy', 'sell'] },
        resource: { type: 'string' },
        amount: { type: 'number' },
        price: { type: 'object', properties: { token: { type: 'string' }, amount: { type: 'string' } }, required: ['token', 'amount'] },
        ttlS: { type: 'number' },
        idempotencyKey: { type: 'string' },
      },
      required: ['side', 'resource', 'amount', 'price'],
    },
  },
  {
    name: 'cancel_order',
    description: 'Cancel an open resting order owned by the authenticated caller.',
    inputSchema: {
      type: 'object',
      properties: { orderId: { type: 'string' }, idempotencyKey: { type: 'string' } },
      required: ['orderId'],
    },
  },
  {
    name: 'negotiate_rfq',
    description: 'Run deterministic 1-round RFQ negotiation against seller ask, walk-away price, and remaining budget.',
    inputSchema: {
      type: 'object',
      properties: {
        itemOrService: { type: 'string' },
        quantity: { type: 'number' },
        currency: { type: 'string', enum: ['USDC', 'NEAR'] },
        plannedUnitPrice: { type: 'number' },
        walkAwayUnitPrice: { type: 'number' },
        sellerInitialAsk: { type: 'number' },
        sellerFloorPrice: { type: 'number' },
        remainingBudget: { type: 'number' },
        buyerFeeBp: { type: 'number' },
        benchmarkNote: { type: 'string' },
      },
      required: ['itemOrService', 'quantity', 'sellerInitialAsk', 'plannedUnitPrice', 'walkAwayUnitPrice', 'remainingBudget'],
    },
  },
] as const;

export const RfqNegotiationSchema = z.object({
  itemOrService: z.string().min(1).max(120),
  quantity: z.number().positive(),
  currency: z.enum(['USDC', 'NEAR']).default('USDC'),
  plannedUnitPrice: z.number().positive(),
  walkAwayUnitPrice: z.number().positive(),
  sellerInitialAsk: z.number().positive(),
  sellerFloorPrice: z.number().positive().optional(),
  remainingBudget: z.number().nonnegative(),
  buyerFeeBp: z.number().int().min(0).max(2000).optional(),
  benchmarkNote: z.string().max(240).optional(),
});

export function runDeterministicRfq(raw: unknown): NegotiationResult {
  const input = RfqNegotiationSchema.parse(raw ?? {});
  return negotiateAgentQuote({
    itemOrService: input.itemOrService,
    quantity: input.quantity,
    currency: input.currency,
    plannedUnitPrice: input.plannedUnitPrice,
    walkAwayUnitPrice: input.walkAwayUnitPrice,
    sellerInitialAsk: input.sellerInitialAsk,
    sellerFloorPrice: input.sellerFloorPrice ?? Math.min(input.sellerInitialAsk, input.walkAwayUnitPrice),
    remainingBudget: input.remainingBudget,
    buyerFeeBp: input.buyerFeeBp,
    benchmarkNote: input.benchmarkNote ?? 'TerraAgent live book benchmark',
  });
}
