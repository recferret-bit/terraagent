import { ServerMessage, type ServerMessageOf } from '@terra/contracts';
import { snapshot, type BalanceOverrides } from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { ReplicaCore } from '../replica/ReplicaCore';
import { LocalHostController } from './LocalHostController';
import { LocalDevError, LocalHostCore, type LocalHostDeps } from './LocalHostCore';
import type { FromLocalHost, LocalHostOptions } from './protocol';
import { memorySnapshotStore } from './snapshotStore';

/** Fake clock + one timer slot per scheduled fn; `advance(ms)` fires due timers in order. */
function rig(store = memorySnapshotStore(), opts: LocalHostOptions = { scenario: 'w00' }) {
  let now = 0;
  const timers: Array<{ at: number; fn: () => void; live: boolean }> = [];
  const out: FromLocalHost[] = [];
  const deps: LocalHostDeps = {
    now: () => now, wallMs: () => 1_700_000_000_000 + now,
    schedule: (fn, d) => { const t = { at: now + d, fn, live: true }; timers.push(t); return () => { t.live = false; }; },
    store,
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = timers.filter((t) => t.live && t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      due.live = false; now = Math.max(now, due.at); due.fn();
    }
    now = end;
  };
  const servers = () => out.flatMap((m) => (m.t === 'server' ? [m.msg] : []));
  const create = (o = opts) => LocalHostCore.create(o, deps, (m) => out.push(m));
  return { deps, out, advance, servers, create, store };
}
const cmd = (id: string, kind: string, args: unknown = {}) => ({ t: 'client', msg: { t: 'cmd', id, d: { kind, args } } }) as const;
const join = { t: 'client', msg: { t: 'join', d: { planetId: 'local' } } } as const;

describe('LocalHostCore', () => {
  it('steps at 5 TPS and sends one delta per 200 ms; warp x10 gives 50 TPS', async () => {
    const r = rig();
    const core = await r.create();
    core.handle(join);
    r.advance(1); // the first slot is due at once
    const t0 = core.tick;
    r.advance(1000);
    expect(core.tick - t0).toBe(5);
    expect(r.servers().filter((m) => m.t === 'delta')).toHaveLength(6); // the first slot plus 5 in the second
    await core.devCommand('warp', { k: 10 });
    const t1 = core.tick;
    r.advance(1000);
    expect(core.tick - t1).toBe(50);
    expect(core.warp).toBe(10);
    await core.devCommand('warp', { k: 1 });
    const t2 = core.tick;
    r.advance(1000);
    expect(core.tick - t2).toBe(5);
    core.stop();
  });

  it('every message it sends is a valid ServerMessage; welcome carries state, versions, flags and warp', async () => {
    const r = rig();
    const core = await r.create();
    core.handle({ t: 'client', msg: { t: 'hello' } });
    core.handle(join);
    await core.devCommand('warp', { k: 4 });
    core.handle(cmd('cm_01J0000000000000000000000A', 'dev.ping'));
    core.handle({ t: 'client', msg: { t: 'ping', d: { clientTimeMs: 5 } } });
    r.advance(600);
    const msgs = r.servers();
    for (const m of msgs) expect(ServerMessage.safeParse(m).success, JSON.stringify(m).slice(0, 200)).toBe(true);
    expect(msgs.map((m) => m.t)).toEqual(expect.arrayContaining(['ready', 'welcome', 'delta', 'event', 'cmd.ack', 'pong']));
    const w = msgs.find((m): m is ServerMessageOf<'welcome'> => m.t === 'welcome')!;
    expect(w.d.flags).toEqual(['W00']);
    expect(w.d.state.byteLength).toBeGreaterThan(100);
    expect(w.d.dataHash).toBeTruthy();
    core.stop();
  });

  it('acks applied commands and rejects unknown kinds, bad args and disabled waves like the server', async () => {
    const r = rig();
    const core = await r.create();
    core.handle(join);
    core.handle(cmd('cm_a', 'dev.spawn', { q: 1, r: 1 }));
    core.handle(cmd('cm_b', 'nope.nothing'));
    core.handle(cmd('cm_c', 'dev.spawn', { q: 'x' }));
    core.handle(cmd('cm_d', 'dev.nudge', { id: 99999 }));
    r.advance(200);
    const res = Object.fromEntries(r.servers().flatMap((m) => (m.t === 'cmd.ack' ? [[m.d.id, 'ack']] : m.t === 'cmd.reject' ? [[m.d.id, m.d.code]] : [])));
    expect(res).toEqual({ cm_a: 'ack', cm_b: 'unknown_kind', cm_c: 'invalid_args', cm_d: 'unknown_entity' });
    core.stop();
  });

  it('a replica fed with welcome + deltas (+ commands, warp) deep-equals the authority', async () => {
    const r = rig();
    const core = await r.create();
    core.handle(join);
    const msgs = r.servers();
    const w = msgs.find((m): m is ServerMessageOf<'welcome'> => m.t === 'welcome')!;
    const replica = new ReplicaCore();
    expect(replica.welcome({ state: w.d.state, tick: w.d.tick, flags: w.d.flags, dataHash: w.d.dataHash, simVersion: w.d.simVersion, overrides: w.d.overrides as BalanceOverrides })).toEqual({ ok: true });
    core.handle(cmd('cm_s', 'dev.spawn', { q: 2, r: -1 }));
    r.advance(400);
    await core.devCommand('warp', { k: 10 });
    core.handle(cmd('cm_t', 'dev.spawn', { q: 3, r: 0 }));
    r.advance(1000);
    for (const m of r.servers()) {
      if (m.t !== 'delta') continue;
      const res = replica.delta({ fromTick: m.d.fromTick, toTick: m.d.toTick, diff: m.d.diff });
      expect(res.ok, JSON.stringify(res)).toBe(true);
    }
    expect(replica.tick).toBe(core.tick);
    expect(Buffer.from(snapshot(replica.state)).equals(Buffer.from(core.simHost.snapshot()))).toBe(true);
    core.stop();
  });

});

describe('LocalHostCore dev server', () => {
  it('scenario / local.reset start a fresh planet and re-welcome; unknown dev commands are host_unavailable', async () => {
    const r = rig();
    const core = await r.create();
    core.handle(join);
    r.advance(1000);
    const before = core.tick;
    const first = core.planetId;
    await core.devCommand('local.reset', {});
    expect(core.tick).toBeLessThan(before);
    expect(core.planetId).not.toBe(first);
    expect(r.servers().filter((m) => m.t === 'welcome').map((m) => (m as ServerMessageOf<'welcome'>).d.reason)).toEqual(['join', 'resync']);
    await expect(core.devCommand('chain.ping', {})).rejects.toMatchObject({ code: 'host_unavailable' });
    await expect(core.devCommand('scenario', { id: 'nope' })).rejects.toBeInstanceOf(LocalDevError);
    core.stop();
  });

  it('tune changes the live numbers, shows in welcome.overrides and survives a resume', async () => {
    const r = rig();
    const core = await r.create();
    core.handle(join);
    const res = (await core.devCommand('tune', { planetId: core.planetId, op: 'set', path: 'dev.probe.nudgeTiles', value: 3 })) as { overrides: BalanceOverrides };
    expect(res.overrides).toEqual({ dev: { probe: { nudgeTiles: 3 } } });
    await expect(core.devCommand('tune', { op: 'set', path: 'bad', value: 1 })).rejects.toMatchObject({ code: 'invalid_args' });
    core.stop();
    await Promise.resolve();
    const again = await r.create();
    again.handle(join);
    const w = r.servers().filter((m): m is ServerMessageOf<'welcome'> => m.t === 'welcome').pop()!;
    expect(w.d.overrides).toEqual({ dev: { probe: { nudgeTiles: 3 } } });
    again.stop();
  });
});

describe('IndexedDB snapshots: save and resume policy', () => {
  it('saves every 10 s and on demand, resumes the tick on the next boot, ignores incompatible snapshots', async () => {
    const store = memorySnapshotStore();
    const r = rig(store);
    const core = await r.create();
    core.handle({ t: 'client', msg: { t: 'hello' } });
    r.advance(10_000);
    await Promise.resolve();
    const saved = store.map.get('terra-local:w00')!;
        expect(saved.tick).toBeGreaterThanOrEqual(49);
    const planet = core.planetId;
    core.stop();
    await Promise.resolve();
    const resumed = await rig(store).create();
    expect(resumed.planetId).toBe(planet);
    expect(resumed.tick).toBeGreaterThanOrEqual(saved.tick);
    resumed.stop();
    // another wave set or a different engine/data identity starts fresh
    store.map.set('terra-local:w00', { ...store.map.get('terra-local:w00')!, dataHash: 'other' });
    const fresh = await rig(store).create();
    expect(fresh.planetId).not.toBe(planet);
    expect(fresh.tick).toBeLessThan(5);
    fresh.stop();
  });

  it('a controller queues messages that arrive before the core is booted', async () => {
    const r = rig();
    const out: FromLocalHost[] = [];
    const ctl = new LocalHostController((m) => out.push(m), r.deps);
    ctl.handle({ t: 'init', opts: { scenario: 'w00' } });
    ctl.handle({ t: 'client', msg: { t: 'hello' } });
    ctl.handle({ t: 'dev', reqId: 1, name: 'chain.ping', args: {} });
    await new Promise((ok) => setTimeout(ok, 0));
    expect(out.map((m) => m.t)).toEqual(['server', 'devResult']);
    expect(out[1]).toMatchObject({ ok: false, code: 'host_unavailable' });
    ctl.handle({ t: 'stop' });
  });
});
