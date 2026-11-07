import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  authorizeMarketActor, compileData, createRegistryPipeline, createState, ensureColonyCargoState, ensureColonyLedger, ensureColonyMarketState,
  ENTITY_KIND, ENTITY_STATE, insertRow, isModuleSource, step, type PlanetState, type SimCommand,
} from '../../src';

function spawn(state: PlanetState, kind: number, q: number, r: number, size = 2, hp = 650): void {
  const row = insertRow(state.entities, state.meta.nextEntityId++, 0);
  const c = state.entities.cols;
  c.kind[row] = kind; c.owner[row] = 0; c.tier[row] = 1; c.q[row] = q; c.r[row] = r;
  c.footprintW[row] = size; c.footprintD[row] = size; c.hp[row] = hp; c.hpMax[row] = hp; c.state[row] = ENTITY_STATE.active;
}

function setup(): PlanetState {
  const state = createState({ planetId: 'p-src', planetType: 'temperate', seed: 'w13-src', radius: 10 });
  state.colonies[0] = { index: 0, id: 'col_0', name: 'Port A', color: 0xff6b00, status: 'active', changedAt: 0, playerId: 'pr_a' };
  ensureColonyLedger(state.colonies[0]);
  spawn(state, ENTITY_KIND.commandHub, 0, 0, 3, 1500);
  spawn(state, ENTITY_KIND.solar, 3, 0);
  spawn(state, ENTITY_KIND.solar, 0, 3);
  spawn(state, ENTITY_KIND.tradeHub, -3, 0);
  ensureColonyCargoState(state.colonies[0]).inOrbit = { 'bio.water': 300 };
  return state;
}

const pipe = () => createRegistryPipeline({ flags: parseWaves('..13'), data: compileData(parseWaves('..13')) });
let seq = 0;
const cmd = (kind: string, source: string, args: Record<string, unknown>, colonyIndex: number | null = 0): SimCommand =>
  ({ commandId: `cs_${seq++}`, kind, colonyIndex, source, playerId: source === 'player' ? 'pr_a' : undefined, args }) as unknown as SimCommand;
const sellArgs = { side: 'sell', resource: 'bio.water', amount: 100, price: { token: 'USDC', amount: '40000000' }, ttlS: 3600 };
const code = (state: PlanetState, c: SimCommand): string | undefined => step(state, [c], 1, pipe()).outcomes[0]?.code;

describe('market.placeOrder command sources (bot API)', () => {
  it('player is accepted', () => {
    expect(code(setup(), cmd('market.placeOrder', 'player', sellArgs))).toBeUndefined();
  });

  it('bot with an explicit colonyIndex is accepted with the same validations', () => {
    const s = setup();
    const res = step(s, [cmd('market.placeOrder', 'bot', sellArgs, 0)], 1, pipe());
    expect(res.outcomes[0]?.code).toBeUndefined();
    expect(res.events.find((e) => e.kind === 'marketOrderRequested')?.data).toMatchObject({ colonyId: 'col_0', side: 'sell', amount: 100 });
  });

  it('bot is still validated: bad args, missing cargo and a foreign colony id are rejected', () => {
    expect(code(setup(), cmd('market.placeOrder', 'bot', { ...sellArgs, amount: 0 }))).toBe('invalid_args');
    expect(code(setup(), cmd('market.placeOrder', 'bot', { ...sellArgs, amount: 301 }))).toBe('insufficient_cargo');
    expect(code(setup(), cmd('market.placeOrder', 'bot', { ...sellArgs, colonyId: 'col_9' }))).toBe('not_own_colony');
    expect(code(setup(), cmd('market.placeOrder', 'bot', sellArgs, 5))).toBe('not_own_colony');
  });

  it('bot without a colonyIndex never falls back to colony 0', () => {
    expect(code(setup(), cmd('market.placeOrder', 'bot', sellArgs, null))).toBe('invalid_args');
    const noIndex = { ...cmd('market.placeOrder', 'bot', sellArgs), colonyIndex: 0.5 } as unknown as SimCommand;
    expect(code(setup(), noIndex)).toBe('invalid_args');
    const negative = { ...cmd('market.placeOrder', 'bot', sellArgs), colonyIndex: -1 } as unknown as SimCommand;
    expect(code(setup(), negative)).toBe('invalid_args');
  });

  it.each(['dev', 'ai', 'system', 'near', 'admin', 'Bot', '', 'player '])('source %j is not authorized', (source) => {
    expect(code(setup(), cmd('market.placeOrder', source, sellArgs))).toBe('not_authorized');
  });
});

describe('other market commands and sources', () => {
  it('a bot may cancel its own order (re-quote) but not change the stall fee', () => {
    const s = setup();
    expect(code(s, cmd('market.cancelOrder', 'bot', { orderId: 'nope' }))).toBe('unknown_order');
    expect(code(s, cmd('market.cancelOrder', 'bot', { orderId: 'nope' }, null))).toBe('invalid_args');
    expect(code(s, cmd('market.cancelOrder', 'dev', { orderId: 'nope' }))).toBe('not_authorized');
    expect(code(s, cmd('market.setHubFee', 'bot', { bp: 50 }))).toBe('not_authorized');
    expect(code(s, cmd('market.setHubFee', 'player', { bp: 50 }))).toBeUndefined();
  });

  it('module commands reject player, bot and ai; module sources pass the source gate', () => {
    for (const source of ['player', 'bot', 'ai', 'x']) {
      const s = setup();
      const c = cmd('market.reserve', source, { colonyId: 'col_0', ref: 'r1', deltas: { 'bio.water': 10 } }, null);
      expect(code(s, c)).toBe('not_authorized');
      expect(ensureColonyMarketState(s.colonies[0]!).reservedInOrbit).toEqual({});
    }
    const s = setup();
    expect(code(s, cmd('market.reserve', 'system', { colonyId: 'col_0', ref: 'r1', deltas: { 'bio.water': 10 } }, null))).toBeUndefined();
  });

  it('source helpers', () => {
    expect(isModuleSource(cmd('x', 'near', {}))).toBe(true);
    expect(isModuleSource(cmd('x', 'bot', {}))).toBe(false);
    expect(authorizeMarketActor(cmd('x', 'bot', {}), false)).toBe('not_authorized');
  });
});
