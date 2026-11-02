import 'reflect-metadata';
import { newId } from '@terra/contracts';
import { DEV_PLANET_SEED, DEV_PLANET_TYPE, snapshot } from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { CoreException } from '../../src/core/errors';
import { DevLedgerController, parseLimit } from '../../src/game/ledger/dev-ledger.controller';
import { PlanetHost } from '../../src/game/thread/planet-host';
import type { FromThread } from '../../src/game/thread/protocol';

const view = { planetId: 'pl_A', account: 'colony:0', balances: { 'metals.t1': 3 }, entries: [] };
const calls: unknown[][] = [];
const ledger = { view: async (...a: unknown[]) => { calls.push(a); return a[0] === 'pl_A' ? view : null; } } as never;
const status = async (p: Promise<unknown>) => p.then(() => 200, (e: unknown) => (e as CoreException).status);

describe('DevLedgerController GET /v1/dev/planets/:planetId/ledger', () => {
  it('returns { planetId, account, balances, entries } with account default colony:0 and limit default 10', async () => {
    const c = new DevLedgerController(ledger);
    expect(await c.get('pl_A')).toEqual(view);
    expect(await c.get('pl_A', 'sys:construction', '3')).toEqual(view);
    expect(calls).toEqual([['pl_A', 'colony:0', 10], ['pl_A', 'sys:construction', 3]]);
  });
  it('404 for a planet that is not loaded, 400 for a bad account (production: DevOnlyGuard)', async () => {
    const dev = new DevLedgerController(ledger);
    expect(await status(dev.get('pl_B'))).toBe(404);
    expect(await status(dev.get('pl_A', '__proto__'))).toBe(400);
  });
  it('clamps limit to 1..1000', () => {
    expect([parseLimit(undefined), parseLimit('x'), parseLimit('0'), parseLimit('50'), parseLimit('99999')]).toEqual([10, 10, 1, 50, 1000]);
  });
});

describe('PlanetHost ledger messages', () => {
  it('posts each step\'s postings (unsubscribed too) and reports colony stocks in `loaded`', () => {
    const out: FromThread[] = [];
    const host = new PlanetHost(0, ['W00', 'W01'], (m) => out.push(m));
    host.handle({ t: 'load', planetId: 'pl_L', params: { type: DEV_PLANET_TYPE, seed: DEV_PLANET_SEED, radius: 56, capacity: 5 } });
    expect(out[0]).toMatchObject({ t: 'loaded', planetId: 'pl_L', tick: 0, restored: false, genesis: false, stocks: [] });
    host.handle({
      t: 'cmd', planetId: 'pl_L',
      cmd: { colonyIndex: 0, source: 'system', commandId: newId('cm'), kind: 'system.spawnColony', args: { colonyId: 'col_l', colonyIndex: 0, playerId: 'p_l', handle: 'L', name: 'L', color: 0, slotIndex: 0 } },
    } as never);
    host.stepPlanet('pl_L', 1);
    const ledgerMsgs = out.filter((m): m is Extract<FromThread, { t: 'ledger' }> => m.t === 'ledger');
    expect(ledgerMsgs).toHaveLength(1);
    expect(ledgerMsgs[0]!.tick).toBe(1);
    expect(ledgerMsgs[0]!.postings.length).toBeGreaterThan(0);
    expect(ledgerMsgs[0]!.postings.every((p) => p.at === 1 && p.legs.some((l) => l.account === 'colony:0'))).toBe(true);
    expect(out.findIndex((m) => m.t === 'ledger')).toBeLessThan(out.findIndex((m) => m.t === 'ack'));

    // a restore reports the colonies' stock, the input of the ledger reconcile
    const again: FromThread[] = [];
    new PlanetHost(1, ['W00', 'W01'], (m) => again.push(m)).handle({ t: 'load', planetId: 'pl_L', snapshot: snapshot(host.planets.get('pl_L')!.state) });
    expect(again[0]).toMatchObject({ t: 'loaded', tick: 1, restored: true, genesis: false });
    const loaded = again[0] as Extract<FromThread, { t: 'loaded' }>;
    expect(loaded.stocks).toHaveLength(1);
    expect(loaded.stocks![0]!['metals.t1']).toBeGreaterThan(0);
  });
});
