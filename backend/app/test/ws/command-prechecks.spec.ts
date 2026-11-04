import { Registry } from 'prom-client';
import { describe, expect, it } from 'vitest';
import { CommandPrechecks } from '../../src/core/command-prechecks';
import type { ColonyRecord } from '../../src/core/home/home.repository';
import type { CommandContext } from '../../src/ws/command-ingress';
import { SimCommandIngress } from '../../src/ws/sim-command-ingress';

const ORDER = { side: 'buy', resource: 'bio.water', amount: 300, price: { token: 'USDC', amount: '10000000' }, ttlS: 3600 };
const cmd = (i: number, kind = 'market.placeOrder', args: object = ORDER) => ({ v: 1, t: 'cmd', id: `cm_${i}`, d: { kind, args } }) as never;

function setup(prechecks: CommandPrechecks) {
  const submitted: string[] = [];
  const planets = {
    isScenarioColonyPlanet: () => false,
    submit: async (_p: string, c: { commandId: string }) => { submitted.push(c.commandId); return { ok: true, commandId: c.commandId, appliedAtTick: 1 }; },
  };
  const ingress = new SimCommandIngress({
    planets: planets as never, flags: { gate: () => null }, registry: new Registry(), production: false, prechecks,
    homeRepo: { findColonyByPlayerAndPlanet: async () => ({ id: 'co_1', colonyIndex: 1, status: 'ACTIVE' }) as ColonyRecord },
  });
  return { ingress, submitted };
}
const ctx = (replies: object[]): CommandContext => ({ playerId: 'pr_a', planetId: 'pl_s', reply: (m) => replies.push(m) });

describe('server command prechecks (W13-01)', () => {
  it('a registered precheck rejects before the sim and sees the colony and parsed args', async () => {
    const prechecks = new CommandPrechecks();
    const seen: unknown[] = [];
    prechecks.register('market.placeOrder', (input) => { seen.push(input); return { code: 'insufficient_cargo', detail: 'needs 10.20 USDC' }; });
    const { ingress, submitted } = setup(prechecks);
    const replies: object[] = [];
    await ingress.handle(ctx(replies), cmd(1));
    expect(submitted).toEqual([]);
    expect(replies).toEqual([{ v: 1, t: 'cmd.reject', d: { id: 'cm_1', code: 'insufficient_cargo', detail: 'needs 10.20 USDC' } }]);
    expect(seen[0]).toMatchObject({ kind: 'market.placeOrder', playerId: 'pr_a', planetId: 'pl_s', colony: { id: 'co_1', colonyIndex: 1 }, args: ORDER });
  });

  it('passing prechecks submit; kinds without one skip it; a throwing precheck is internal; order is kept', async () => {
    const prechecks = new CommandPrechecks();
    let n = 0;
    const off = prechecks.register('market.placeOrder', () => new Promise((r) => setTimeout(() => r(null), n++ === 0 ? 20 : 0)));
    const { ingress, submitted } = setup(prechecks);
    await Promise.all([ingress.handle(ctx([]), cmd(1)), ingress.handle(ctx([]), cmd(2)), ingress.handle(ctx([]), cmd(3, 'dev.ping', {}))]);
    expect(submitted).toEqual(['cm_1', 'cm_2', 'cm_3']);
    off();
    prechecks.register('market.placeOrder', () => { throw new Error('db'); });
    const replies: object[] = [];
    await ingress.handle(ctx(replies), cmd(4));
    expect(replies).toEqual([{ v: 1, t: 'cmd.reject', d: { id: 'cm_4', code: 'internal', detail: 'precheck failed' } }]);
  });
});
