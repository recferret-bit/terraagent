import { ServerMessage, type ServerMessageOf } from '@terra/contracts';
import { getColonyStock, snapshot, StepError, type BalanceOverrides, type SimHost } from '@terra/sim';
import { describe, expect, it, vi } from 'vitest';
import type { LedgerReply } from '../../net/devServer';
import { ReplicaCore } from '../replica/ReplicaCore';
import { LocalHostController } from './LocalHostController';
import { LocalDevError, LocalHostCore, MAX_STEP_RESTORES, type LocalHostDeps } from './LocalHostCore';
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

describe('LocalHostCore reject details and failing steps (GP-31, BE-12)', () => {
  const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
  /** The next `step` of `host` really runs (its outcomes go to the listeners), then throws like a system bug would. */
  const throwOnNextStep = (host: SimHost) => {
    const real = host.step.bind(host);
    vi.spyOn(host, 'step').mockImplementationOnce((dt: number) => {
      const res = real(dt);
      throw new StepError(new Error('boom'), res.stats.tick, res.outcomes, [], []);
    });
  };

  it("a handler's { code, detail } reaches the client's cmd.reject", async () => {
    const r = rig(memorySnapshotStore(), { scenario: 'w01' });
    const core = await r.create();
    core.handle(join);
    core.handle(cmd('cm_land', 'dev.land'));
    r.advance(400);
    core.handle(cmd('cm_hub', 'placeBuilding', { building: 'commandHub', q: 500, r: 0 }));
    r.advance(200);
    const rej = r.servers().find((m): m is ServerMessageOf<'cmd.reject'> => m.t === 'cmd.reject' && m.d.id === 'cm_hub');
    expect(rej?.d.code).toBe('site_blocked');
    expect(rej?.d.detail).toMatch(/\S/);
    expect(ServerMessage.safeParse(rej).success).toBe(true);
    core.stop();
  });

  it('a step that throws rejects its commands internal (no ack), restores the last snapshot and re-welcomes', async () => {
    const r = rig();
    const core = await r.create();
    core.handle(join);
    r.advance(1);
    await core.save();
    const savedTick = core.tick;
    const broken = core.simHost;
    r.advance(400);
    throwOnNextStep(broken);
    core.handle(cmd('cm_x', 'dev.ping'));
    r.advance(200);
    core.handle(cmd('cm_y', 'dev.ping')); // while the planet is down
    await settle();
    const msgs = r.servers();
    const answers = msgs.flatMap((m) => (m.t === 'cmd.ack' ? [[m.d.id, 'ack']] : m.t === 'cmd.reject' ? [[m.d.id, m.d.code]] : []));
    expect(answers).toEqual([['cm_x', 'internal'], ['cm_y', 'host_unavailable']]);
    expect(r.out.flatMap((m) => (m.t === 'error' ? [m.message] : []))).toEqual(['step failed: step to tick ' + (savedTick + 3) + ' failed: boom; restoring the last snapshot']);
    expect(core.simHost).not.toBe(broken);
    expect(core.tick).toBe(savedTick);
    expect(msgs.filter((m): m is ServerMessageOf<'welcome'> => m.t === 'welcome').map((m) => m.d.reason)).toEqual(['join', 'resync']);
    r.advance(1000);
    expect(core.tick).toBe(savedTick + 6); // stepping again: a slot due at once, then 5 per second
    core.stop();
  });

  it(`after ${MAX_STEP_RESTORES} restores a failing planet stays down; saves never persist it`, async () => {
    const store = memorySnapshotStore();
    const r = rig(store);
    const core = await r.create();
    core.handle(join);
    r.advance(1);
    await core.save();
    const saved = store.map.get('terra-local:w00')!.tick;
    for (let i = 0; i <= MAX_STEP_RESTORES; i++) {
      throwOnNextStep(core.simHost);
      r.advance(200);
      await settle();
    }
    const down = core.tick;
    expect(r.out.flatMap((m) => (m.t === 'error' ? [m.message] : [])).at(-1)).toMatch(new RegExp(`planet down \\(restored ${MAX_STEP_RESTORES}×\\)$`));
    r.advance(1000);
    expect(core.tick).toBe(down);
    expect(down).toBeGreaterThan(saved); // the broken planet ran past the snapshot before it failed for good
    await core.stop();
    expect(store.map.get('terra-local:w00')?.tick).toBe(saved);
  });
});

describe('host-side resource ledger', () => {
  const nonZero = (stock: Record<string, number>) => Object.fromEntries(Object.entries(stock).filter(([, v]) => v !== 0));

  /** A `w01` planet with landing cargo and a 50-metal grant, saved and stopped; `r.store` holds its snapshot. */
  async function grantedPlanet() {
    const r = rig(memorySnapshotStore(), { scenario: 'w01' });
    const core = await r.create();
    core.handle(join);
    core.handle(cmd('cm_land', 'dev.land'));
    r.advance(400);
    core.handle(cmd('cm_grant', 'dev.grant', { resource: 'metals.t1', amount: 50 }));
    r.advance(400);
    const before = (await core.devCommand('ledger', { account: 'colony:0', limit: 100 })) as LedgerReply;
    core.stop();
    await Promise.resolve();
    return { r, before };
  }
  const ledgerOf = async (core: LocalHostCore) => (await core.devCommand('ledger', { account: 'colony:0', limit: 100 })) as LedgerReply;
  const errors = (out: FromLocalHost[]) => out.flatMap((m) => (m.t === 'error' ? [m.message] : []));

  it('journals every posting in the worker, answers `ledger` like the server route', async () => {
    const store = memorySnapshotStore();
    const r = rig(store, { scenario: 'w01' });
    const core = await r.create();
    core.handle(join);
    core.handle(cmd('cm_land', 'dev.land'));
    r.advance(400);
    core.handle(cmd('cm_grant', 'dev.grant', { resource: 'metals.t1', amount: 50 }));
    r.advance(400);
    const stock = nonZero(getColonyStock(core.simHost.state, 0));
    const live = (await core.devCommand('ledger', { account: 'colony:0', limit: 100 })) as LedgerReply;
    expect(live).toMatchObject({ planetId: core.planetId, account: 'colony:0' });
    expect(live.balances).toEqual(stock);
    expect(stock['metals.t1']).toBeGreaterThanOrEqual(50);
    // a fresh scenario replays its setup postings: the journal starts with the real landing cargo, not an opening
    expect(live.entries[0]).toMatchObject({ seq: 1, reason: 'landing.cargo', actor: 'system:landing' });
    expect(live.entries.at(-1)).toMatchObject({ reason: 'dev.grant', actor: 'dev:console' });
    expect((await core.devCommand('ledger', { account: 'colony:0', limit: 1 }) as LedgerReply).entries).toHaveLength(1);
    core.stop();
    await Promise.resolve();
    // the journal is saved with the snapshot, captured at the same tick
    const saved = store.map.get('terra-local:w01')!;
    expect(saved.journal?.seq).toBe(live.entries.at(-1)!.seq);
  });

  it('a resumed snapshot continues its saved journal: history survives the reload and seq goes on', async () => {
    const { r, before } = await grantedPlanet();
    const resumed = await r.create();
    const after = await ledgerOf(resumed);
    expect(after.entries).toEqual(before.entries);
    expect(after.entries[0]).toMatchObject({ reason: 'landing.cargo', actor: 'system:landing' });
    expect(after.balances).toEqual(nonZero(getColonyStock(resumed.simHost.state, 0)));
    resumed.handle(join);
    resumed.handle(cmd('cm_more', 'dev.grant', { resource: 'metals.t1', amount: 5 }));
    r.advance(400);
    expect((await ledgerOf(resumed)).entries.at(-1)).toMatchObject({ seq: before.entries.at(-1)!.seq + 1, reason: 'dev.grant' });
    expect(errors(r.out)).toEqual([]);
    resumed.stop();
  });

  it('a snapshot without a journal opens its balances by system:resume, quietly', async () => {
    const { r } = await grantedPlanet();
    const { journal: _dropped, ...older } = r.store.map.get('terra-local:w01')!;
    r.store.map.set('terra-local:w01', older);
    const resumed = await r.create();
    const opened = await ledgerOf(resumed);
    expect(opened.balances).toEqual(nonZero(getColonyStock(resumed.simHost.state, 0)));
    expect(opened.entries).toEqual([expect.objectContaining({ seq: 1, reason: 'ledger.opening', actor: 'system:resume' })]);
    expect(errors(r.out)).toEqual([]);
    resumed.stop();
  });

  it('a saved journal that does not reconcile (or is malformed) falls back to opening and reports why', async () => {
    const { r } = await grantedPlanet();
    const snap = r.store.map.get('terra-local:w01')!;
    // one metal moved from sys:dev to colony:0 in balances and opening alike: internally consistent, but not col.stock
    const tampered = structuredClone(snap.journal!);
    const shift = (sheet: Record<string, Record<string, number>>, account: string, d: number) => {
      sheet[account] = { ...sheet[account], 'metals.t1': (sheet[account]?.['metals.t1'] ?? 0) + d };
    };
    for (const sheet of [tampered.balances, tampered.opening]) { shift(sheet, 'colony:0', 1); shift(sheet, 'sys:dev', -1); }
    r.store.map.set('terra-local:w01', { ...snap, journal: tampered });
    const resumed = await r.create();
    const opened = await ledgerOf(resumed);
    expect(opened.entries).toEqual([expect.objectContaining({ reason: 'ledger.opening', actor: 'system:resume' })]);
    expect(opened.balances).toEqual(nonZero(getColonyStock(resumed.simHost.state, 0)));
    expect(errors(r.out)).toEqual([expect.stringMatching(/saved ledger journal does not match.*colony:0 metals\.t1: journal \d+, stock \d+/)]);
    resumed.stop();
    // a structurally broken journal is refused the same way (the planet itself still resumes)
    r.store.map.set('terra-local:w01', { ...snap, journal: { ...snap.journal!, journal: [{ seq: 99 }] } as never });
    const broken = await r.create();
    expect(broken.planetId).toBe(resumed.planetId);
    expect((await ledgerOf(broken)).entries[0]).toMatchObject({ reason: 'ledger.opening', actor: 'system:resume' });
    expect(errors(r.out)).toHaveLength(2);
    broken.stop();
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
