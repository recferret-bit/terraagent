import { describe, expect, it } from 'vitest';
import { marketOrderRef, parseWaves } from '@terra/contracts';
import {
  applyDiff, compileData, createRegistryPipeline, createState, diffSince, ensureColonyCargoState, ensureColonyLedger,
  ENTITY_KIND, ENTITY_STATE, ensureColonyMarketState, insertRow, restore, snapshot, step,
  type PlanetState, type SimCommand, type SimEvent,
} from '../../src';

const REF = marketOrderRef('col_0', 1);

function spawn(state: PlanetState, kind: number, owner: number, q: number, r: number, entityState: number = ENTITY_STATE.active, size = 2, hp = 650): void {
  const row = insertRow(state.entities, state.meta.nextEntityId++, 0);
  const c = state.entities.cols;
  c.kind[row] = kind; c.owner[row] = owner; c.tier[row] = 1; c.q[row] = q; c.r[row] = r;
  c.footprintW[row] = size; c.footprintD[row] = size; c.hp[row] = hp; c.hpMax[row] = hp; c.state[row] = entityState;
}

function setup(opts: { hub?: boolean; hubState?: number; water?: number } = {}): PlanetState {
  const state = createState({ planetId: 'p-market', planetType: 'temperate', seed: 'w13-10', radius: 10 });
  state.colonies[0] = { index: 0, id: 'col_0', name: 'Port A', color: 0xff6b00, status: 'active', changedAt: 0, playerId: 'pr_a' };
  ensureColonyLedger(state.colonies[0]);
  spawn(state, ENTITY_KIND.commandHub, 0, 0, 0, ENTITY_STATE.active, 3, 1500);
  spawn(state, ENTITY_KIND.solar, 0, 3, 0);
  spawn(state, ENTITY_KIND.solar, 0, 0, 3);
  if (opts.hub !== false) spawn(state, ENTITY_KIND.tradeHub, 0, -3, 0, opts.hubState);
  ensureColonyCargoState(state.colonies[0]).inOrbit = { 'bio.water': opts.water ?? 300 };
  return state;
}

const pipe = (flags = '..13') => createRegistryPipeline({ flags: parseWaves(flags), data: compileData(parseWaves(flags)) });
let seq = 0;
const player = (kind: string, args: Record<string, unknown>): SimCommand =>
  ({ commandId: `cm_${seq++}`, kind, colonyIndex: 0, source: 'player', playerId: 'pr_a', args }) as SimCommand;
const module_ = (kind: string, args: Record<string, unknown>): SimCommand =>
  ({ commandId: `cm_${seq++}`, kind, colonyIndex: null, source: 'system', args: { colonyId: 'col_0', ...args } }) as SimCommand;

function run(state: PlanetState, cmd: SimCommand, flags = '..13'): { code?: string; events: SimEvent[] } {
  const res = step(state, [cmd], 1, pipe(flags));
  return { code: res.outcomes[0]?.code, events: res.events };
}

const sell = (over: Record<string, unknown> = {}) => player('market.placeOrder', {
  side: 'sell', resource: 'bio.water', amount: 300, price: { token: 'metals.t1', amount: '120' }, ttlS: 3600, ...over,
});
const trade = (over: Record<string, unknown> = {}) => ({
  base: 'bio.water', amount: 300, quote: 'metals.t1', notional: '120', platformFee: '1', stallFee: '1', stallFeeBp: 100, makerSide: 'sell', ...over,
});
const settleArgs = (over: Record<string, unknown> = {}) => ({
  tradeId: 'tr_1', ref: REF, role: 'seller', deltas: { 'bio.water': -300, 'metals.t1': 120 }, released: { 'bio.water': 300 }, trade: trade(), ...over,
});
const market = (s: PlanetState) => ensureColonyMarketState(s.colonies[0]!);

describe('W13-10 market mirror: acceptance', () => {
  it('place sell -> reserve -> settled', () => {
    const s = setup();
    const placed = run(s, sell());
    expect(placed.code).toBeUndefined();
    const req = placed.events.find((e) => e.kind === 'marketOrderRequested')!;
    expect(req.data).toMatchObject({ ref: REF, orderSeq: 1, colonyId: 'col_0', colonyIndex: 0, side: 'sell', resource: 'bio.water',
      amount: 300, stallFeeBp: 100, stallName: 'Port A', playerId: 'pr_a', price: { token: 'metals.t1', amount: '120' } });
    expect(typeof req.data.hubEntityId).toBe('number');
    expect(market(s).reservedInOrbit).toEqual({});

    expect(run(s, module_('market.reserve', { ref: REF, deltas: { 'bio.water': 300 } })).code).toBeUndefined();
    expect(market(s).reservedInOrbit['bio.water']).toBe(300);
    expect(market(s).openOrders[REF]).toMatchObject({ side: 'sell', resource: 'bio.water', amount: 300 });
    expect(run(s, sell()).code).toBe('insufficient_cargo'); // all 300 reserved

    const settled = run(s, module_('market.settled', settleArgs()));
    expect(settled.code).toBeUndefined();
    expect(market(s).reservedInOrbit['bio.water'] ?? 0).toBe(0);
    const orbit = ensureColonyCargoState(s.colonies[0]!).inOrbit;
    expect(orbit['metals.t1']).toBe(120);
    expect(orbit['bio.water'] ?? 0).toBe(0);
    expect(settled.events.find((e) => e.kind === 'tradeSettled')!.data).toMatchObject({ tradeId: 'tr_1', role: 'seller', base: 'bio.water', amount: 300, quote: 'metals.t1', ref: REF });
    expect(market(s).openOrders[REF]).toBeUndefined();
  });

  it('replayed settled is idempotent', () => {
    const s = setup();
    run(s, module_('market.reserve', { ref: REF, deltas: { 'bio.water': 300 } }));
    run(s, module_('market.settled', settleArgs()));
    const again = run(s, module_('market.settled', settleArgs()));
    expect(again.events.filter((e) => e.kind === 'tradeSettled')).toHaveLength(0);
    expect(ensureColonyCargoState(s.colonies[0]!).inOrbit['metals.t1']).toBe(120);
  });

  it('stall role emits feeEarned only', () => {
    const s = setup();
    const r = run(s, module_('market.settled', { tradeId: 'tr_2', role: 'stall', deltas: {}, trade: trade({ quote: 'USDC', stallFee: '1000', stallFeeBp: 50 }) }));
    expect(r.events.filter((e) => e.kind === 'tradeSettled')).toHaveLength(0);
    expect(r.events.filter((e) => e.kind === 'feeEarned')).toHaveLength(1);
    expect(r.events.find((e) => e.kind === 'feeEarned')!.data).toMatchObject({ token: 'USDC', amount: '1000', bp: 50, colonyId: 'col_0' });
  });

  it('release: rejected emits event and clamps; non-filled drops the order', () => {
    const s = setup();
    run(s, sell());
    run(s, module_('market.reserve', { ref: REF, deltas: { 'bio.water': 300 } }));
    const r = run(s, module_('market.release', { ref: REF, deltas: { 'bio.water': 500 }, reason: 'rejected', code: 'order_limit', detail: 'x' }));
    expect(market(s).reservedInOrbit['bio.water'] ?? 0).toBe(0);
    expect(market(s).openOrders[REF]).toBeUndefined();
    expect(r.events.find((e) => e.kind === 'marketOrderRejected')!.data).toMatchObject({ colonyId: 'col_0', colonyIndex: 0, ref: REF, code: 'order_limit', detail: 'x' });
    const c = run(s, module_('market.release', { ref: 'nope', deltas: {}, reason: 'cancelled' }));
    expect(c.events).toHaveLength(0);
  });

  it('release: settlement_failed emits marketSettlementFailed (W13-24 contract-failed toast)', () => {
    const s = setup();
    run(s, sell());
    run(s, module_('market.reserve', { ref: REF, deltas: { 'bio.water': 300 } }));
    const r = run(s, module_('market.release', { ref: REF, deltas: { 'bio.water': 300 }, reason: 'settlement_failed' }));
    expect(r.events.find((e) => e.kind === 'marketSettlementFailed')!.data).toMatchObject({ colonyId: 'col_0', colonyIndex: 0, ref: REF });
  });

});

describe('W13-10 market mirror: rejects and commands', () => {
  it('place-order reject codes', () => {
    expect(run(setup({ hub: false }), sell()).code).toBe('no_trade_hub');
    expect(run(setup({ hubState: ENTITY_STATE.offlineUnpowered }), sell()).code).toBe('hub_offline');
    const s = setup();
    expect(run(s, sell({ ttlS: 123 })).code).toBe('invalid_args');
    expect(run(s, sell({ amount: 0 })).code).toBe('invalid_args');
    expect(run(s, sell({ maxStallFeeBp: 101 })).code).toBe('fee_out_of_range');
    expect(run(s, sell({ price: { token: 'USDC', amount: '99999' } })).code).toBe('order_too_small');
    expect(run(s, sell({ price: { token: 'USDC', amount: '100000' } })).code).toBeUndefined();
    expect(run(s, sell({ amount: 301 })).code).toBe('insufficient_cargo');
    // barter buy: 1000 metals + 1% + 1% fees needs 1020 in orbit
    ensureColonyCargoState(s.colonies[0]!).inOrbit['metals.t1'] = 1019;
    const buy = (a: string) => player('market.placeOrder', { side: 'buy', resource: 'bio.water', amount: 10, price: { token: 'metals.t1', amount: a }, ttlS: 900 });
    expect(run(s, buy('1000')).code).toBe('insufficient_cargo');
    ensureColonyCargoState(s.colonies[0]!).inOrbit['metals.t1'] = 1020;
    expect(run(s, buy('1000')).code).toBeUndefined();
    // USDC buy: funds are the server's business
    expect(run(s, player('market.placeOrder', { side: 'buy', resource: 'bio.water', amount: 10, price: { token: 'USDC', amount: '5000000' }, ttlS: 900 })).code).toBeUndefined();
  });

  it('order_limit at the policy limit', () => {
    const s = setup();
    for (let i = 1; i <= 20; i++) run(s, module_('market.reserve', { ref: marketOrderRef('col_0', i), deltas: {} }));
    expect(run(s, sell({ amount: 1 })).code).toBe('order_limit');
  });

  it('cancel: unknown_order, then accepted by ref or orderId', () => {
    const s = setup();
    expect(run(s, player('market.cancelOrder', { orderId: REF })).code).toBe('unknown_order');
    run(s, module_('market.reserve', { ref: REF, orderId: 'ord_9', deltas: { 'bio.water': 5 } }));
    const byRef = run(s, player('market.cancelOrder', { orderId: REF }));
    expect(byRef.code).toBeUndefined();
    expect(byRef.events[0]).toMatchObject({ kind: 'marketCancelRequested' });
    expect(byRef.events[0].data).toMatchObject({ orderId: REF, colonyIndex: 0 });
    expect(run(s, player('market.cancelOrder', { orderId: 'ord_9' })).code).toBeUndefined();
    expect(market(s).reservedInOrbit['bio.water']).toBe(5); // no state change
  });

  it('setHubFee: range, hub, event; new orders carry the fee', () => {
    expect(run(setup({ hub: false }), player('market.setHubFee', { bp: 10 })).code).toBe('no_trade_hub');
    const s = setup();
    expect(run(s, player('market.setHubFee', { bp: 101 })).code).toBe('fee_out_of_range');
    const r = run(s, player('market.setHubFee', { bp: 25 }));
    expect(r.events[0].data).toMatchObject({ bp: 25, previousBp: 100, colonyIndex: 0 });
    expect(market(s).hubFeeBp).toBe(25);
    const req = run(s, sell({ amount: 10 })).events.find((e) => e.kind === 'marketOrderRequested')!;
    expect(req.data.stallFeeBp).toBe(25);
  });

  it('module commands reject players; player commands are wave-gated', () => {
    const s = setup();
    const asPlayer = { ...module_('market.reserve', { ref: REF, deltas: {} }), source: 'player' } as SimCommand;
    expect(run(s, asPlayer).code).toBe('not_authorized');
    for (const c of [sell(), player('market.cancelOrder', { orderId: REF }), player('market.setHubFee', { bp: 1 }),
      module_('market.reserve', { ref: REF, deltas: {} }), module_('market.release', { ref: REF, deltas: {}, reason: 'expired' }),
      module_('market.settled', settleArgs())]) {
      expect(run(setup(), c, '..12').code).toBe('wave_disabled');
    }
  });

});

describe('W13-10 market mirror: persistence', () => {
  it('market state survives snapshot/restore and reaches clients via the diff', () => {
    const s = setup();
    run(s, sell());
    run(s, module_('market.reserve', { ref: REF, orderId: 'ord_1', deltas: { 'bio.water': 300 } }));
    run(s, module_('market.settled', settleArgs({ role: 'buyer' })));
    const back = restore(snapshot(s));
    expect(back.colonies[0]!.market).toEqual(s.colonies[0]!.market);
    expect((back.colonies[0]!.market as { orderSeq: number }).orderSeq).toBe(1);

    const client = restore(snapshot(setup()));
    applyDiff(client, diffSince(s, 0));
    expect(client.colonies[0]!.market).toEqual(s.colonies[0]!.market);
  });
});
