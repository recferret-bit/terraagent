import { describe, expect, it } from 'vitest';
import { marketOrderRef, parseWaves } from '@terra/contracts';
import {
  compileData, createRegistryPipeline, createState, ensureColonyCargoState, ensureColonyLedger, ensureColonyMarketState,
  ENTITY_KIND, ENTITY_STATE, insertRow, step, type PlanetState, type SimCommand, type SimEvent,
} from '../../src';

function spawn(state: PlanetState, kind: number, q: number, r: number, entityState: number = ENTITY_STATE.active, size = 2, hp = 650): number {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, 0);
  const c = state.entities.cols;
  c.kind[row] = kind; c.owner[row] = 0; c.tier[row] = 1; c.q[row] = q; c.r[row] = r;
  c.footprintW[row] = size; c.footprintD[row] = size; c.hp[row] = hp; c.hpMax[row] = hp; c.state[row] = entityState;
  return id;
}

interface Opts { hubs?: number[]; water?: number; metals?: number }
function setup(opts: Opts = {}): { s: PlanetState; hubIds: number[] } {
  const s = createState({ planetId: 'p-exch', planetType: 'temperate', seed: 'exch-1', radius: 10 });
  s.colonies[0] = { index: 0, id: 'col_0', name: 'Port A', color: 0xff6b00, status: 'active', changedAt: 0, playerId: 'pr_a' };
  ensureColonyLedger(s.colonies[0]);
  spawn(s, ENTITY_KIND.commandHub, 0, 0, ENTITY_STATE.active, 3, 1500);
  spawn(s, ENTITY_KIND.solar, 3, 0);
  spawn(s, ENTITY_KIND.solar, 0, 3);
  const states = opts.hubs ?? [ENTITY_STATE.active];
  const hubIds = states.map((st, i) => spawn(s, ENTITY_KIND.tradeHub, -3, -3 * i, st));
  ensureColonyCargoState(s.colonies[0]).inOrbit = { 'bio.water': opts.water ?? 300, 'metals.t1': opts.metals ?? 0 };
  return { s, hubIds };
}

const pipe = createRegistryPipeline({ flags: parseWaves('..13'), data: compileData(parseWaves('..13')) });
let seq = 0;
const cmd = (args: unknown, over: Partial<SimCommand> = {}): SimCommand =>
  ({ commandId: `cx_${seq++}`, kind: 'market.placeOrder', colonyIndex: 0, source: 'player', playerId: 'pr_a', args, ...over }) as SimCommand;
const mod = (kind: string, args: Record<string, unknown>): SimCommand =>
  ({ commandId: `cx_${seq++}`, kind, colonyIndex: null, source: 'system', args: { colonyId: 'col_0', ...args } }) as SimCommand;
function run(s: PlanetState, c: SimCommand): { code?: string; events: SimEvent[] } {
  const res = step(s, [c], 1, pipe);
  return { code: res.outcomes[0]?.code, events: res.events };
}
const sellArgs = (over: Record<string, unknown> = {}) => ({
  side: 'sell', resource: 'bio.water', amount: 10, price: { token: 'metals.t1', amount: '50' }, ttlS: 3600, ...over,
});
const buyArgs = (over: Record<string, unknown> = {}) => ({
  side: 'buy', resource: 'bio.water', amount: 10, price: { token: 'metals.t1', amount: '1000' }, ttlS: 3600, ...over,
});
const reqEvents = (r: { events: SimEvent[] }) => r.events.filter((e) => e.kind === 'marketOrderRequested');
const mkt = (s: PlanetState) => ensureColonyMarketState(s.colonies[0]!);

describe('exchange place-order: invalid_args variants', () => {
  const bad: [string, Record<string, unknown>][] = [
    ['side missing', { side: undefined }],
    ['side unknown', { side: 'swap' }],
    ['side uppercase', { side: 'BUY' }],
    ['resource unknown', { resource: 'unobtainium' }],
    ['resource not a string', { resource: 5 }],
    ['resource is a cash token', { resource: 'USDC' }],
    ['amount zero', { amount: 0 }],
    ['amount negative', { amount: -5 }],
    ['amount fractional', { amount: 1.5 }],
    ['amount NaN', { amount: Number.NaN }],
    ['amount Infinity', { amount: Number.POSITIVE_INFINITY }],
    ['amount numeric string', { amount: '10' }],
    ['amount missing', { amount: undefined }],
    ['price missing', { price: undefined }],
    ['price null', { price: null }],
    ['price amount negative', { price: { token: 'metals.t1', amount: '-5' } }],
    ['price amount fractional', { price: { token: 'metals.t1', amount: '1.5' } }],
    ['price amount empty', { price: { token: 'metals.t1', amount: '' } }],
    ['price amount exponent', { price: { token: 'metals.t1', amount: '1e3' } }],
    ['price amount hex', { price: { token: 'metals.t1', amount: '0x10' } }],
    ['price amount padded', { price: { token: 'metals.t1', amount: ' 5' } }],
    ['price amount number', { price: { token: 'metals.t1', amount: 5 } }],
    ['price token missing', { price: { amount: '5' } }],
    ['base == quote', { price: { token: 'bio.water', amount: '50' } }],
    ['ttl not an option', { ttlS: 123 }],
    ['ttl zero', { ttlS: 0 }],
    ['ttl negative', { ttlS: -3600 }],
    ['ttl string', { ttlS: '3600' }],
    ['ttl missing', { ttlS: undefined }],
  ];
  for (const [name, over] of bad) {
    it(`rejects: ${name}`, () => {
      const { s } = setup();
      const r = run(s, cmd(sellArgs(over)));
      expect(r.code).toBe('invalid_args');
      expect(reqEvents(r)).toHaveLength(0);
      expect(mkt(s).orderSeq).toBe(0);
      expect(Object.keys(mkt(s).requested)).toHaveLength(0);
    });
  }
  it('null / missing args reject, not crash', () => {
    const { s } = setup();
    expect(run(s, cmd(null)).code).toBe('invalid_args');
    expect(run(s, cmd(undefined)).code).toBe('invalid_args');
    expect(run(s, cmd({})).code).toBe('invalid_args');
  });
  it('every ttl option is accepted', () => {
    for (const ttlS of [900, 3600, 21600, 86400]) {
      const { s } = setup();
      expect(run(s, cmd(sellArgs({ ttlS }))).code).toBeUndefined();
    }
  });
});

describe('exchange place-order: fee, size, caller', () => {
  it('maxStallFeeBp boundaries 0 and 100 pass, -1 and 101 are fee_out_of_range', () => {
    for (const bp of [0, 100]) expect(run(setup().s, cmd(sellArgs({ maxStallFeeBp: bp }))).code).toBeUndefined();
    for (const bp of [-1, 101, 10_000]) expect(run(setup().s, cmd(sellArgs({ maxStallFeeBp: bp }))).code).toBe('fee_out_of_range');
  });
  // BUG (it.fails): place-order.ts validateFeeAndSize compares with < and >, so NaN and numeric strings pass, and a
  // fractional value reaches BigInt() in checkCargo and throws a StepError for the whole tick.
  it.fails('maxStallFeeBp NaN is rejected', () => {
    const r = run(setup().s, cmd(sellArgs({ maxStallFeeBp: Number.NaN })));
    expect(['fee_out_of_range', 'invalid_args']).toContain(r.code);
  });
  it.fails('maxStallFeeBp as a string is rejected', () => {
    const r = run(setup().s, cmd(sellArgs({ maxStallFeeBp: '50' })));
    expect(['fee_out_of_range', 'invalid_args']).toContain(r.code);
  });
  it.fails('maxStallFeeBp fractional is rejected (barter buy would otherwise BigInt(50.5))', () => {
    const { s } = setup({ metals: 100_000 });
    let r: { code?: string; events: SimEvent[] } | undefined;
    expect(() => { r = run(s, cmd(buyArgs({ maxStallFeeBp: 50.5 }))); }).not.toThrow();
    expect(['fee_out_of_range', 'invalid_args']).toContain(r?.code);
  });
  it('minimum notional boundary per quote token: min-1 reject, min and min+1 pass', () => {
    const cases: [string, bigint][] = [['USDC', 100_000n], ['NEAR', 10_000_000_000_000_000_000_000n], ['metals.t1', 1n]];
    for (const [token, min] of cases) {
      const lo = run(setup().s, cmd(sellArgs({ price: { token, amount: (min - 1n).toString() } })));
      expect(lo.code).toBe('order_too_small');
      for (const n of [min, min + 1n]) expect(run(setup().s, cmd(sellArgs({ price: { token, amount: n.toString() } }))).code).toBeUndefined();
    }
  });
  it('huge notional (beyond 2^64) is accepted for a sell', () => {
    const amt = (2n ** 80n).toString();
    expect(run(setup().s, cmd(sellArgs({ price: { token: 'USDC', amount: amt } }))).code).toBeUndefined();
  });
  it('base lot: any positive integer is a multiple of lot 1 (and the min lot passes)', () => {
    expect(run(setup().s, cmd(sellArgs({ amount: 1 }))).code).toBeUndefined();
  });
  it('non-player sources are not_authorized', () => {
    for (const source of ['system', 'bot', 'admin']) {
      const { s } = setup();
      expect(run(s, cmd(sellArgs(), { source } as Partial<SimCommand>)).code).toBe('not_authorized');
      expect(mkt(s).orderSeq).toBe(0);
    }
  });
  it('wrong colonyId, wrong player and missing colony are not_own_colony', () => {
    expect(run(setup().s, cmd(sellArgs({ colonyId: 'col_9' }))).code).toBe('not_own_colony');
    expect(run(setup().s, cmd(sellArgs(), { playerId: 'pr_evil' } as Partial<SimCommand>)).code).toBe('not_own_colony');
    expect(run(setup().s, cmd(sellArgs(), { colonyIndex: 5 })).code).toBe('not_own_colony');
    expect(run(setup().s, cmd(sellArgs(), { colonyIndex: -1 })).code).toBe('not_own_colony');
    const { s } = setup();
    s.colonies[0]!.status = 'eliminated';
    expect(run(s, cmd(sellArgs())).code).toBe('not_own_colony');
  });
  it('matching colonyId passes', () => {
    expect(run(setup().s, cmd(sellArgs({ colonyId: 'col_0' }))).code).toBeUndefined();
  });
});

describe('exchange place-order: hub rules', () => {
  it('no hub -> no_trade_hub', () => {
    expect(run(setup({ hubs: [] }).s, cmd(sellArgs())).code).toBe('no_trade_hub');
  });
  it('only unpowered hubs -> hub_offline', () => {
    expect(run(setup({ hubs: [ENTITY_STATE.offlineUnpowered] }).s, cmd(sellArgs())).code).toBe('hub_offline');
  });
  it('stallId picks a specific online hub; unknown, offline-hub and non-numeric stallId are rejected', () => {
    const hubs = [ENTITY_STATE.offlineUnpowered, ENTITY_STATE.active, ENTITY_STATE.active];
    const { s, hubIds } = setup({ hubs });
    const ok = run(s, cmd(sellArgs({ stallId: String(hubIds[2]) })));
    expect(ok.code).toBeUndefined();
    expect(reqEvents(ok)[0]!.data.hubEntityId).toBe(hubIds[2]);
    // a step re-evaluates power, so every reject case gets a fresh colony
    const fresh = setup({ hubs });
    expect(run(fresh.s, cmd(sellArgs({ stallId: String(fresh.hubIds[0]) }))).code).toBe('invalid_args');
    expect(run(setup({ hubs }).s, cmd(sellArgs({ stallId: '999999' }))).code).toBe('invalid_args');
    expect(run(setup({ hubs }).s, cmd(sellArgs({ stallId: 'abc' }))).code).toBe('invalid_args');
  });
  it('without stallId the first online hub is used even when an earlier hub is offline', () => {
    const { s, hubIds } = setup({ hubs: [ENTITY_STATE.offlineUnpowered, ENTITY_STATE.active] });
    expect(reqEvents(run(s, cmd(sellArgs())))[0]!.data.hubEntityId).toBe(hubIds[1]);
  });
});

describe('exchange place-order: cargo and limits', () => {
  it('sell needs the full base; exactly enough passes, one short rejects', () => {
    expect(run(setup({ water: 10 }).s, cmd(sellArgs({ amount: 10 }))).code).toBeUndefined();
    expect(run(setup({ water: 9 }).s, cmd(sellArgs({ amount: 10 }))).code).toBe('insufficient_cargo');
    expect(run(setup({ water: 0 }).s, cmd(sellArgs({ amount: 1 }))).code).toBe('insufficient_cargo');
  });
  it('already reserved sell units are not free', () => {
    const { s } = setup({ water: 300 });
    run(s, mod('market.reserve', { ref: marketOrderRef('col_0', 1), deltas: { 'bio.water': 295 } }));
    expect(run(s, cmd(sellArgs({ amount: 5 }))).code).toBeUndefined();
    expect(run(s, cmd(sellArgs({ amount: 6 }))).code).toBe('insufficient_cargo');
  });
  it('barter buy needs price + 1% + 1% (ceil) in the quote resource; boundary 1019/1020', () => {
    expect(run(setup({ metals: 1019 }).s, cmd(buyArgs())).code).toBe('insufficient_cargo');
    expect(run(setup({ metals: 1020 }).s, cmd(buyArgs())).code).toBeUndefined();
  });
  it('barter buy fee reservation rounds UP: 101 at 1%+1% needs 101+2+2', () => {
    const buy = cmd(buyArgs({ price: { token: 'metals.t1', amount: '101' } }));
    expect(run(setup({ metals: 104 }).s, buy).code).toBe('insufficient_cargo');
    expect(run(setup({ metals: 105 }).s, cmd(buyArgs({ price: { token: 'metals.t1', amount: '101' } }))).code).toBeUndefined();
  });
  it('barter buy uses the explicit maxStallFeeBp for the reservation (0 bp: needs price + 1%)', () => {
    expect(run(setup({ metals: 1009 }).s, cmd(buyArgs({ maxStallFeeBp: 0 }))).code).toBe('insufficient_cargo');
    expect(run(setup({ metals: 1010 }).s, cmd(buyArgs({ maxStallFeeBp: 0 }))).code).toBeUndefined();
  });
  it('barter buy counts already reserved quote units as unavailable', () => {
    const { s } = setup({ metals: 2040 });
    run(s, mod('market.reserve', { ref: marketOrderRef('col_0', 1), deltas: { 'metals.t1': 1020 } }));
    expect(run(s, cmd(buyArgs())).code).toBeUndefined();
    ensureColonyCargoState(s.colonies[0]!).inOrbit['metals.t1'] = 2039;
    expect(run(s, cmd(buyArgs())).code).toBe('insufficient_cargo');
  });
  it('buy with USDC/NEAR quote skips the cargo check (server funds)', () => {
    expect(run(setup({ metals: 0 }).s, cmd(buyArgs({ price: { token: 'USDC', amount: '5000000' } }))).code).toBeUndefined();
    expect(run(setup({ metals: 0 }).s, cmd(buyArgs({ price: { token: 'NEAR', amount: '20000000000000000000000' } }))).code).toBeUndefined();
  });
  it('order_limit at 20 open orders; 19 still passes; requested orders do not count', () => {
    const s19 = setup().s;
    for (let i = 1; i <= 19; i++) run(s19, mod('market.reserve', { ref: marketOrderRef('col_0', i), deltas: {} }));
    expect(run(s19, cmd(sellArgs({ amount: 1 }))).code).toBeUndefined();
    const s20 = setup().s;
    for (let i = 1; i <= 20; i++) run(s20, mod('market.reserve', { ref: marketOrderRef('col_0', i), deltas: {} }));
    expect(run(s20, cmd(sellArgs({ amount: 1 }))).code).toBe('order_limit');
  });
  it('check order: invalid_args before hub, hub before fee/size, size before limit and cargo', () => {
    expect(run(setup({ hubs: [] }).s, cmd(sellArgs({ amount: 0 }))).code).toBe('invalid_args');
    expect(run(setup({ hubs: [] }).s, cmd(sellArgs({ maxStallFeeBp: 500 }))).code).toBe('no_trade_hub');
    expect(run(setup({ water: 0 }).s, cmd(sellArgs({ maxStallFeeBp: 500 }))).code).toBe('fee_out_of_range');
    expect(run(setup({ water: 0 }).s, cmd(sellArgs({ price: { token: 'USDC', amount: '1' } }))).code).toBe('order_too_small');
  });
});

describe('exchange place-order: success payload', () => {
  it('emits one marketOrderRequested with the exact payload and bumps orderSeq', () => {
    const { s, hubIds } = setup();
    const r = run(s, cmd(sellArgs({ maxStallFeeBp: 40 })));
    expect(r.code).toBeUndefined();
    const ev = reqEvents(r);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.data).toEqual({
      ref: marketOrderRef('col_0', 1), orderSeq: 1, colonyId: 'col_0', colonyIndex: 0, playerId: 'pr_a', side: 'sell', resource: 'bio.water',
      amount: 10, price: { token: 'metals.t1', amount: '50' }, ttlS: 3600, stallFeeBp: 100, maxStallFeeBp: 40, hubEntityId: hubIds[0], stallName: 'Port A',
    });
    expect(mkt(s).orderSeq).toBe(1);
    expect(mkt(s).requested[marketOrderRef('col_0', 1)]).toEqual({ side: 'sell', resource: 'bio.water', amount: 10 });
    expect(ev[0]!.colonyIds).toEqual(['col_0']);
  });
  it('omits maxStallFeeBp when not given and strips unknown price fields', () => {
    const { s } = setup();
    const r = run(s, cmd(sellArgs({ price: { token: 'metals.t1', amount: '50', evil: 'x' } })));
    const d = reqEvents(r)[0]!.data;
    expect('maxStallFeeBp' in d).toBe(false);
    expect(d.price).toEqual({ token: 'metals.t1', amount: '50' });
  });
  it('two accepted orders get consecutive refs; rejects burn no sequence number', () => {
    const { s } = setup();
    run(s, cmd(sellArgs({ amount: 0 })));
    const a = reqEvents(run(s, cmd(sellArgs())))[0]!.data.ref;
    run(s, cmd(sellArgs({ ttlS: 5 })));
    const b = reqEvents(run(s, cmd(sellArgs())))[0]!.data.ref;
    expect([a, b]).toEqual([marketOrderRef('col_0', 1), marketOrderRef('col_0', 2)]);
  });
  it('stall name is truncated to 64 characters', () => {
    const { s } = setup();
    s.colonies[0]!.name = 'N'.repeat(200);
    expect((reqEvents(run(s, cmd(sellArgs())))[0]!.data.stallName as string).length).toBe(64);
  });
  it('accepting an order does not move cargo (the module reserves)', () => {
    const { s } = setup();
    run(s, cmd(sellArgs()));
    expect(ensureColonyCargoState(s.colonies[0]!).inOrbit['bio.water']).toBe(300);
    expect(mkt(s).reservedInOrbit).toEqual({});
  });
  it('the mirror of requested orders stays bounded', () => {
    const { s } = setup({ water: 1_000_000 });
    for (let i = 0; i < 120; i++) run(s, cmd(sellArgs({ amount: 1 })));
    expect(Object.keys(mkt(s).requested).length).toBeLessThanOrEqual(80);
  });
});
