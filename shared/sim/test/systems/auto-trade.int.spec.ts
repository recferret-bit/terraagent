import { describe, expect, it } from 'vitest';
import { AutoTradeLimitSchema, AutoTradeOrderSchema, parseWaves } from '@terra/contracts';
import { createPlanet, SimHost, type SimCommand } from '../../src';
import { restore, snapshot } from '../../src/codec/snapshot';
import { withinAutoTrade } from '../../src/systems/away/auto-trade';
import { readAutoTradeLimits } from '../../src/systems/trade/autotrade';

describe('W09-13 withinAutoTrade through the contract', () => {
  it('a parsed 200-metal give against a max of 100 is false', () => {
    const limit = AutoTradeLimitSchema.parse({ maxPerTrade: 100, maxPerSession: 500, minStock: 0, partners: 'anyone' });
    const order = AutoTradeOrderSchema.parse({
      resource: 'metals.t1', give: 200, stock: 400, sessionSpent: 0, partner: 'guild',
    });
    expect(withinAutoTrade(limit, order)).toBe(false);
  });

  it('a parsed give that lands on the floor is true, and one under it is false', () => {
    const limit = AutoTradeLimitSchema.parse({ maxPerTrade: 100, maxPerSession: 500, minStock: 40, partners: 'anyone' });
    const onFloor = AutoTradeOrderSchema.parse({
      resource: 'metals.t1', give: 10, stock: 50, sessionSpent: 0, partner: 'anyone',
    });
    const under = AutoTradeOrderSchema.parse({
      resource: 'metals.t1', give: 11, stock: 50, sessionSpent: 0, partner: 'anyone',
    });
    expect(withinAutoTrade(limit, onFloor)).toBe(true);
    expect(withinAutoTrade(limit, under)).toBe(false);
  });
});

const METALS = {
  maxPerTrade: 300, maxPerSession: 600, minStock: 200, partners: 'guild' as const, sellAboveStoragePct: 80, buyBelowStock: 40,
};

function trade(id: string, limits: unknown): SimCommand {
  return { colonyIndex: 0, source: 'player', commandId: id, kind: 'setAutoTrade', args: { limits } };
}

describe('W15-19 setAutoTrade persistence', () => {
  it('stores limits, reads them after another step, and keeps them across a snapshot', () => {
    const sim = new SimHost({ flags: parseWaves('..15') });
    sim.load(createPlanet({ type: 'flat', seed: 'w15-19', radius: 4 }));
    sim.submit(trade('cm_at_1', { 'metals.t1': METALS }));
    expect(sim.step(1).outcomes[0]?.code).toBeUndefined();
    const first = readAutoTradeLimits(sim.state, 0);
    expect(first?.['metals.t1']).toMatchObject(METALS);
    sim.step(1);
    expect(readAutoTradeLimits(sim.state, 0)).toEqual(first);
    expect(readAutoTradeLimits(restore(snapshot(sim.state)), 0)).toEqual(first);
  });

  it('rejects partner nope and truce while W18 is off, and does not replace a stored row', () => {
    const sim = new SimHost({ flags: parseWaves('..15') });
    sim.load(createPlanet({ type: 'flat', seed: 'w15-19-reject', radius: 4 }));
    sim.submit(trade('cm_at_ok', { 'metals.t1': METALS }));
    expect(sim.step(1).outcomes[0]?.code).toBeUndefined();
    sim.submit(trade('cm_at_nope', { 'metals.t1': { ...METALS, partners: 'nope' } }));
    sim.submit(trade('cm_at_truce', { 'bio.water': { ...METALS, partners: 'truce' } }));
    const step = sim.step(1);
    expect(step.outcomes.map((o) => o.code)).toEqual(['invalid_args', 'invalid_args']);
    expect(readAutoTradeLimits(sim.state, 0)?.['metals.t1']?.partners).toBe('guild');
    expect(readAutoTradeLimits(sim.state, 0)?.['bio.water']).toBeUndefined();
  });

  it('rejects setAutoTrade with wave_disabled below W15 and writes nothing', () => {
    const sim = new SimHost({ flags: parseWaves('..14') });
    sim.load(createPlanet({ type: 'flat', seed: 'w15-19-off', radius: 4 }));
    sim.submit(trade('cm_at_off', { 'metals.t1': METALS }));
    expect(sim.step(1).outcomes[0]?.code).toBe('wave_disabled');
    expect(sim.state.blobs.autoTrade).toBeUndefined();
    expect(readAutoTradeLimits(sim.state, 0)).toBeUndefined();
  });

  it('stores a truce partner when W18 is on', () => {
    const sim = new SimHost({ flags: parseWaves('..18') });
    sim.load(createPlanet({ type: 'flat', seed: 'w15-19-truce', radius: 4 }));
    sim.submit(trade('cm_at_truce_on', { 'bio.water': { ...METALS, partners: 'truce' } }));
    expect(sim.step(1).outcomes[0]?.code).toBeUndefined();
    expect(readAutoTradeLimits(sim.state, 0)?.['bio.water']?.partners).toBe('truce');
  });
});
