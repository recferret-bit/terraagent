import { Registry } from 'prom-client';
import { describe, expect, it } from 'vitest';
import type { ColonyRecord } from '../../src/core/home/home.repository';
import type { CommandContext } from '../../src/ws/command-ingress';
import { SimCommandIngress } from '../../src/ws/sim-command-ingress';

const row = (colonyIndex: number) => ({ id: `col_${colonyIndex}x`, colonyIndex, status: 'ACTIVE' }) as ColonyRecord;
const cmd = (i: number, kind = 'dev.ping') => ({ v: 1, t: 'cmd', id: `cm_${i}`, d: { kind, args: kind === 'moveUnit' ? { entityId: 1, q: 0, r: 0 } : {} } }) as never;

type Outcome = { ok: true; commandId: string; appliedAtTick: number } | { ok: false; commandId: string; code: string; detail?: string };

function ingressWith(lookup: (playerId: string, planetId: string) => Promise<ColonyRecord | null>, scenario = false, outcome?: (commandId: string) => Outcome) {
  const submitted: Array<{ commandId: string; colonyIndex: number | null; source: string }> = [];
  const planets = {
    isScenarioColonyPlanet: () => scenario,
    submit: async (_p: string, c: { commandId: string; colonyIndex: number | null; source: string }): Promise<Outcome> => {
      submitted.push({ commandId: c.commandId, colonyIndex: c.colonyIndex, source: c.source });
      return outcome?.(c.commandId) ?? { ok: true, commandId: c.commandId, appliedAtTick: 1 };
    },
  };
  let lookups = 0;
  const ingress = new SimCommandIngress({
    planets: planets as never, flags: { gate: () => null }, registry: new Registry(), production: false,
    homeRepo: { findColonyByPlayerAndPlanet: (p, pl) => { lookups++; return lookup(p, pl); } },
  });
  return { ingress, submitted, lookups: () => lookups };
}

const ctx = (extra: Partial<CommandContext> = {}, replies: object[] = []): CommandContext => ({ playerId: 'pr_a', planetId: 'pl_s', reply: (m) => replies.push(m), ...extra });

describe('ingress colony resolution', () => {
  it('submits one player\'s commands in arrival order even when an earlier lookup answers last (BE-09)', async () => {
    let n = 0;
    const delays = [30, 0, 10];
    const { ingress, submitted } = ingressWith(() => new Promise((r) => setTimeout(() => r(row(2)), delays[n++] ?? 0)));
    await Promise.all([0, 1, 2].map((i) => ingress.handle(ctx(), cmd(i))));
    expect(submitted.map((s) => s.commandId)).toEqual(['cm_0', 'cm_1', 'cm_2']);
    expect(submitted.every((s) => s.colonyIndex === 2)).toBe(true);
  });

  it('remembers a miss for the socket\'s lifetime on that planet: one lookup, not one per command (BE-09)', async () => {
    const { ingress, lookups } = ingressWith(async () => null);
    const memo = {};
    for (let i = 0; i < 3; i++) await ingress.handle(ctx({ memo }), cmd(i));
    expect(lookups()).toBe(1);
    await ingress.handle(ctx({ memo, planetId: 'pl_other' }), cmd(9));
    expect(lookups()).toBe(2); // another planet: asked again
  });

  it('colony 0 of a scenario planet only for a dev session; a JWT session without a row commands nothing (BE-07)', async () => {
    const { ingress, submitted } = ingressWith(async () => null, true);
    const replies: object[] = [];
    await ingress.handle(ctx({ dev: true }), cmd(1, 'moveUnit'));
    await ingress.handle(ctx({ dev: false }, replies), cmd(2, 'moveUnit'));
    expect(submitted.map((s) => [s.commandId, s.colonyIndex, s.source])).toEqual([['cm_1', 0, 'player']]);
    expect(replies).toEqual([{ v: 1, t: 'cmd.reject', d: { id: 'cm_2', code: 'not_own_colony' } }]);
  });

  it('a failing lookup is rejected internal, and the player\'s next command still goes through', async () => {
    let fail = true;
    const { ingress, submitted } = ingressWith(async () => { if (fail) { fail = false; throw new Error('db down'); } return row(1); });
    const replies: object[] = [];
    await ingress.handle(ctx({}, replies), cmd(1));
    await ingress.handle(ctx(), cmd(2));
    expect(replies).toEqual([{ v: 1, t: 'cmd.reject', d: { id: 'cm_1', code: 'internal', detail: 'colony lookup failed' } }]);
    expect(submitted.map((s) => s.commandId)).toEqual(['cm_2']);
  });

  it('passes the sim\'s reject detail to the client, cut to 200 characters; an unregistered code goes out as internal (GP-31)', async () => {
    const answers: Record<string, Outcome> = {
      cm_1: { ok: false, commandId: 'cm_1', code: 'site_blocked', detail: 'trees on 2 tiles' },
      cm_2: { ok: false, commandId: 'cm_2', code: 'site_blocked', detail: 'x'.repeat(250) },
      cm_3: { ok: false, commandId: 'cm_3', code: 'planet_not_loaded' },
    };
    const { ingress } = ingressWith(async () => row(1), false, (id) => answers[id]!);
    const replies: object[] = [];
    for (const i of [1, 2, 3]) await ingress.handle(ctx({}, replies), cmd(i));
    await new Promise((r) => setTimeout(r, 5));
    expect(replies).toEqual([
      { v: 1, t: 'cmd.reject', d: { id: 'cm_1', code: 'site_blocked', detail: 'trees on 2 tiles' } },
      { v: 1, t: 'cmd.reject', d: { id: 'cm_2', code: 'site_blocked', detail: 'x'.repeat(200) } },
      { v: 1, t: 'cmd.reject', d: { id: 'cm_3', code: 'internal', detail: 'planet_not_loaded' } },
    ]);
  });
});
