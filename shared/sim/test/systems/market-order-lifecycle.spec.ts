import { describe, expect, it } from 'vitest';
import { marketOrderRef, parseWaves } from '@terra/contracts';
import {
  compileData, createRegistryPipeline, createState, ensureColonyCargoState, ensureColonyLedger, ensureColonyMarketState,
  ENTITY_KIND, ENTITY_STATE, insertRow, step, type PlanetState, type SimCommand,
} from '../../src';

function spawn(state: PlanetState, kind: number, q: number, r: number, size = 2, hp = 650): void {
  const row = insertRow(state.entities, state.meta.nextEntityId++, 0);
  const c = state.entities.cols;
  c.kind[row] = kind; c.owner[row] = 0; c.tier[row] = 1; c.q[row] = q; c.r[row] = r;
  c.footprintW[row] = size; c.footprintD[row] = size; c.hp[row] = hp; c.hpMax[row] = hp; c.state[row] = ENTITY_STATE.active;
}

function setup(): PlanetState {
  const state = createState({ planetId: 'p-life', planetType: 'temperate', seed: 'w13-life', radius: 10 });
  state.colonies[0] = { index: 0, id: 'col_0', name: 'Port A', color: 0xff6b00, status: 'active', changedAt: 0, playerId: 'pr_a' };
  ensureColonyLedger(state.colonies[0]);
  spawn(state, ENTITY_KIND.commandHub, 0, 0, 3, 1500);
  spawn(state, ENTITY_KIND.solar, 3, 0);
  spawn(state, ENTITY_KIND.solar, 0, 3);
  spawn(state, ENTITY_KIND.tradeHub, -3, 0);
  ensureColonyCargoState(state.colonies[0]).inOrbit = { 'bio.water': 1000 };
  return state;
}

const pipe = createRegistryPipeline({ flags: parseWaves('..13'), data: compileData(parseWaves('..13')) });
let seq = 0;
const mod = (kind: string, args: Record<string, unknown>): SimCommand =>
  ({ commandId: `cl_${seq++}`, kind, colonyIndex: null, source: 'system', args: { colonyId: 'col_0', ...args } }) as SimCommand;
const run = (s: PlanetState, cmd: SimCommand) => step(s, [cmd], 1, pipe).outcomes[0]?.code;
const place = (side: 'buy' | 'sell', amount = 1): SimCommand => ({
  commandId: `cl_${seq++}`, kind: 'market.placeOrder', colonyIndex: 0, source: 'player', playerId: 'pr_a',
  args: { side, resource: 'bio.water', amount, price: { token: 'USDC', amount: '1000000' }, ttlS: 3600 },
}) as SimCommand;
const market = (s: PlanetState) => ensureColonyMarketState(s.colonies[0]!);
const trade = (amount: number) => ({ base: 'bio.water', amount, quote: 'USDC', notional: '1', platformFee: '0', stallFee: '0', stallFeeBp: 100, makerSide: 'sell' });

/** place + reserve (a USDC-paid buy reserves no resource: deltas {}) */
function openUsdcBuy(s: PlanetState, n: number, amount = 1): string {
  expect(run(s, place('buy', amount))).toBeUndefined();
  const ref = marketOrderRef('col_0', n);
  expect(run(s, mod('market.reserve', { ref, orderId: `o${n}`, deltas: {} }))).toBeUndefined();
  return ref;
}
const fill = (s: PlanetState, ref: string, n: number, amount: number) =>
  run(s, mod('market.settled', { tradeId: `t${n}-${seq}`, ref, role: 'buyer', deltas: { 'bio.water': amount }, trade: trade(amount) }));

describe('W13 order lifecycle: open-order slot', () => {
  it('22 filled USDC buys never exhaust the limit (SIM-LEAK)', () => {
    const s = setup();
    for (let n = 1; n <= 22; n++) {
      const ref = openUsdcBuy(s, n);
      expect(fill(s, ref, n, 1)).toBeUndefined();
      expect(Object.keys(market(s).openOrders)).toHaveLength(0);
    }
  });

  it('a partially filled order keeps its slot until complete', () => {
    const s = setup();
    const ref = openUsdcBuy(s, 1, 5);
    fill(s, ref, 1, 2);
    expect(market(s).openOrders[ref]?.filled).toBe(2);
    fill(s, ref, 2, 3);
    expect(market(s).openOrders[ref]).toBeUndefined();
  });

  it('cancel / expire free the slot exactly once and keep reservation accounting', () => {
    const s = setup();
    const a = marketOrderRef('col_0', 1);
    run(s, place('sell', 10));
    run(s, mod('market.reserve', { ref: a, deltas: { 'bio.water': 10 } }));
    const b = openUsdcBuy(s, 2);
    expect(market(s).reservedInOrbit).toEqual({ 'bio.water': 10 });
    run(s, mod('market.release', { ref: a, deltas: { 'bio.water': 10 }, reason: 'cancelled' }));
    run(s, mod('market.release', { ref: b, deltas: {}, reason: 'expired' }));
    expect(market(s).openOrders).toEqual({});
    expect(market(s).reservedInOrbit).toEqual({});
    run(s, mod('market.release', { ref: b, deltas: {}, reason: 'expired' })); // replay: no-op
    expect(market(s).openOrders).toEqual({});
  });

  it('self-heals leaked legacy refs (no filled counter) only when the limit is hit', () => {
    const s = setup();
    const m = market(s);
    for (let i = 0; i < 20; i++) m.openOrders[`legacy${i}`] = { side: 'buy', resource: 'bio.water', amount: 1, reserved: {} };
    expect(run(s, place('buy'))).toBeUndefined();
    expect(Object.keys(m.openOrders)).toHaveLength(19);
    // fresh orders (with `filled`) are never healed away
    for (const k of Object.keys(m.openOrders)) delete m.openOrders[k];
    for (let i = 0; i < 20; i++) m.openOrders[`fresh${i}`] = { side: 'buy', resource: 'bio.water', amount: 1, reserved: {}, filled: 0 };
    expect(run(s, place('buy'))).toBe('order_limit');
  });
});
