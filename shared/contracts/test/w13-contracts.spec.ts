import { describe, expect, it } from 'vitest';
import {
  COMMAND_KINDS,
  EVENT_KINDS,
  MARKET_TOKENS,
  MarketSnapshotResponse,
  REJECT_CODES,
  ServerMessage,
  commandDef,
  eventDef,
  fromChainUnits,
  marketOrderRef,
  marketTradeOpId,
  pairId,
  parseCommandArgs,
  parsePairId,
  toChainUnits,
  type CommandKind,
  type EventKind,
  type RejectCode,
} from '../src';

const ORDER = { side: 'sell', resource: 'bio.water', amount: 300, price: { token: 'USDC', amount: '10000000' }, ttlS: 3600 };

describe('W13-01 contracts: market commands, events, errors, pushes, flag W13', () => {
  it('registers client and module-only market commands on W13', () => {
    const client: CommandKind[] = ['market.placeOrder', 'market.cancelOrder', 'market.setHubFee'];
    const moduleOnly: CommandKind[] = ['market.reserve', 'market.release', 'market.settled'];
    for (const k of [...client, ...moduleOnly]) {
      expect(COMMAND_KINDS).toContain(k);
      expect(commandDef(k).wave).toBe('W13');
    }
    for (const k of client) expect(commandDef(k).origin).toBe('client');
    for (const k of moduleOnly) expect(commandDef(k).origin).toBe('module');
  });

  it('validates market.placeOrder args strictly (atomic strings, base ≠ quote)', () => {
    expect(parseCommandArgs('market.placeOrder', ORDER).success).toBe(true);
    expect(parseCommandArgs('market.placeOrder', { ...ORDER, price: { token: 'metals.t1', amount: '120' } }).success).toBe(true);
    expect(parseCommandArgs('market.placeOrder', { ...ORDER, price: { token: 'bio.water', amount: '1' } }).success).toBe(false);
    expect(parseCommandArgs('market.placeOrder', { ...ORDER, price: { token: 'USDC', amount: '10.5' } }).success).toBe(false);
    expect(parseCommandArgs('market.placeOrder', { ...ORDER, price: { token: 'USDC', amount: 10 } }).success).toBe(false);
    expect(parseCommandArgs('market.placeOrder', { ...ORDER, amount: 0 }).success).toBe(false);
    expect(parseCommandArgs('market.placeOrder', { ...ORDER, extra: 1 }).success).toBe(false);
    expect(parseCommandArgs('market.placeOrder', { ...ORDER, resource: 'energy' }).success).toBe(false);
    expect(parseCommandArgs('market.setHubFee', { bp: 100 }).success).toBe(true);
    expect(parseCommandArgs('market.cancelOrder', { orderId: marketOrderRef('col_0', 1) }).success).toBe(true);
  });

  it('module commands carry whole-unit resource deltas only (no USDC in the sim)', () => {
    const ok = parseCommandArgs('market.reserve', { ref: 'market-order:col_0:1', deltas: { 'bio.water': 300 } });
    expect(ok.success).toBe(true);
    expect(parseCommandArgs('market.reserve', { ref: 'r', deltas: { USDC: 10 } }).success).toBe(false);
    expect(parseCommandArgs('market.release', { ref: 'r', deltas: {}, reason: 'rejected', code: 'insufficient_cargo' }).success).toBe(true);
    const settled = parseCommandArgs('market.settled', {
      tradeId: 'tr_1', role: 'buyer', deltas: { 'bio.water': 300 },
      trade: { base: 'bio.water', amount: 300, quote: 'USDC', notional: '10000000', platformFee: '100000', stallFee: '100000', stallFeeBp: 100, makerSide: 'sell' },
    });
    expect(settled.success).toBe(true);
  });

  it('registers market events on W13', () => {
    const events: EventKind[] = ['tradeSettled', 'feeEarned', 'marketOrderRequested', 'marketCancelRequested', 'marketHubFeeSet', 'marketOrderRejected'];
    for (const k of events) {
      expect(EVENT_KINDS).toContain(k);
      expect(eventDef(k).wave).toBe('W13');
    }
    expect(eventDef('marketOrderRequested').audience).toBe('server');
    expect(eventDef('tradeSettled').audience).toBe('player');
  });

  it('adds the W13 reject codes', () => {
    const codes: RejectCode[] = ['no_trade_hub', 'hub_offline', 'insufficient_cargo', 'fee_out_of_range', 'order_limit', 'order_too_small', 'market_unavailable', 'unknown_order'];
    for (const c of codes) expect(REJECT_CODES).toContain(c);
  });

  it('parses market.book and market.trade pushes and the REST snapshot', () => {
    const trade = {
      tradeId: 'tr_1', pair: 'bio.water/USDC', base: 'bio.water', quote: 'USDC', amount: 300, notional: '10000000',
      platformFee: '100000', stallFee: '100000', stallFeeBp: 100, makerSide: 'sell', state: 'FINAL', atMs: 1,
    };
    const book = { planetId: 'pl_1', pair: 'bio.water/USDC', bids: [], asks: [{ num: '10000000', den: 300, amount: 300, orders: 1 }], seq: 1 };
    expect(ServerMessage.safeParse({ v: 1, t: 'market.book', d: book }).success).toBe(true);
    expect(ServerMessage.safeParse({ v: 1, t: 'market.trade', d: { planetId: 'pl_1', trade } }).success).toBe(true);
    expect(MarketSnapshotResponse.safeParse({ planetId: 'pl_1', books: [book], board: [], recentTrades: [trade] }).success).toBe(true);
  });

  it('defines token metadata, pair ids and exact chain-unit conversion', () => {
    expect(MARKET_TOKENS['bio.water'].verifierId).toBe('nep245:res.terraagent.mock:bio.water');
    expect(MARKET_TOKENS.USDC).toMatchObject({ verifierId: 'nep141:usdc.mock', decimals: 6 });
    expect(MARKET_TOKENS.NEAR.verifierId).toBe('native:near');
    expect(Object.keys(MARKET_TOKENS)).toHaveLength(12);
    expect(toChainUnits('bio.water', 300n)).toBe(300n * 10n ** 18n);
    expect(fromChainUnits('bio.water', 300n * 10n ** 18n + 5n)).toBe(300n);
    expect(toChainUnits('USDC', '10200000')).toBe(10_200_000n);
    expect(pairId('bio.water', 'USDC')).toBe('bio.water/USDC');
    expect(parsePairId('bio.water/metals.t1')).toEqual({ base: 'bio.water', quote: 'metals.t1' });
    expect(parsePairId('bio.water/bio.water')).toBeNull();
    expect(marketTradeOpId('tr_1')).toBe('trade:tr_1');
  });
});
