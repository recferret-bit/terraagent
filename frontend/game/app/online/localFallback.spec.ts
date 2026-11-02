import type { ServerMessage, ServerMessageOf } from '@terra/contracts';
import { StepError } from '@terra/sim';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LedgerReply } from '../../net/devServer';
import { WorldStore } from '../../store/WorldStore';
import { createLocalBootFallback } from './bootOnline';

/** FA-07: the dev fallback host is the `LocalHostCore` of `?host=local`, run in-process on the page. */
const fallback = () => {
  const host = createLocalBootFallback('device-secret-0123456789abcdef').localHost!;
  const msgs: ServerMessage[] = [];
  host.onMessage((m) => msgs.push(m));
  const answers = () => msgs.flatMap((m) => (m.t === 'cmd.ack' ? [[m.d.id, 'ack']] : m.t === 'cmd.reject' ? [[m.d.id, m.d.code]] : []));
  return { host, msgs, answers };
};
const cmd = (id: string, kind: string, args: unknown = {}) => ({ t: 'cmd', id, d: { kind, args } }) as const;
const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

afterEach(() => { vi.restoreAllMocks(); });

describe('in-process fallback host (FA-07, FA-33)', () => {
  it('a step that throws rejects its commands internal (no ack), answers host_unavailable while down, then restores the seated planet and re-welcomes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { host, msgs, answers } = fallback();
    const broken = host.sim;
    const real = broken.step.bind(broken);
    vi.spyOn(broken, 'step').mockImplementationOnce((dt: number) => {
      const res = real(dt);
      throw new StepError(new Error('boom'), res.stats.tick, res.outcomes, [], []);
    });
    host.send(cmd('cm_x', 'dev.ping'));
    expect(() => host.step(3)).not.toThrow(); // before FA-07 the StepError escaped the page's setInterval
    host.send(cmd('cm_y', 'dev.ping'));
    expect(answers()).toEqual([['cm_x', 'internal'], ['cm_y', 'host_unavailable']]);
    expect(warn).toHaveBeenCalledWith('[local host]', expect.stringMatching(/^step failed: .*boom; restoring the last snapshot$/));

    await settle();
    expect(host.sim).not.toBe(broken);
    expect(msgs.filter((m): m is ServerMessageOf<'welcome'> => m.t === 'welcome').map((m) => m.d.reason)).toEqual(['resync']);
    expect(host.state.colonies?.[0]?.id).toBe('col_0'); // no snapshot yet: a fresh dev planet with colony 0 seated again
    host.send(cmd('cm_z', 'dev.ping'));
    host.step(1);
    expect(answers().at(-1)).toEqual(['cm_z', 'ack']);
  });

  it('commands pass the same precheck as the server: page-sent system kinds are unknown_kind, bad args invalid_args', () => {
    const { host, answers } = fallback();
    host.send(cmd('cm_sys', 'system.spawnColony', { colonyId: 'col_9', colonyIndex: 9, name: 'x', q: 0, r: 0 }));
    host.send(cmd('cm_bad', 'moveUnit', { entityId: 'nope' }));
    host.step(1);
    expect(answers()).toEqual([['cm_sys', 'unknown_kind'], ['cm_bad', 'invalid_args']]);
  });

  it('the dev console talks to the in-process core: warp event, tune, ledger, local.reset; server-only commands are host_unavailable', async () => {
    const { host, msgs } = fallback();
    expect(await host.devServer('warp', { k: 4 })).toMatchObject({ k: 4 });
    expect(msgs.some((m) => m.t === 'event' && m.d.kind === 'dev.warp')).toBe(true);
    await expect(host.devServer('warp', { k: 0 })).rejects.toMatchObject({ code: 'invalid_args' });
    await expect(host.devServer('chain.ping', {})).rejects.toMatchObject({ code: 'host_unavailable' });
    const ledger = (await host.devServer('ledger', { account: 'colony:0', limit: 5 })) as LedgerReply;
    expect(ledger.balances['metals.t1']).toBeGreaterThan(0); // the seated colony's landing cargo is journalled
    expect(host.ledger.view('pl_dev', 'colony:0', 5).balances).toEqual(ledger.balances);
    host.step(5);
    const before = host.sim;
    expect(await host.devServer('local.reset', {})).toEqual({ planetId: 'pl_dev' });
    expect([host.sim === before, host.tick, host.state.colonies?.[0]?.id]).toEqual([false, 1, 'col_0']);
  });

  it('bound stores get the authoritative view on every delta; tile layers only when a tile changed', () => {
    const { host } = fallback();
    const store = new WorldStore({ send() {}, onMessage: () => () => {} });
    host.bindStore(store);
    expect(store.latest?.tick).toBe(host.tick);
    expect(store.latestTiles).not.toBeNull();
    const views: Array<{ tick: number; tiles: boolean }> = [];
    store.onView((v) => views.push({ tick: v.tick, tiles: Boolean(v.tiles) }));
    const t0 = host.tick;
    host.step(2);
    expect(views).toEqual([{ tick: t0 + 2, tiles: false }]);
    expect(host.sync(true).tiles).toBeDefined();
  });
});
