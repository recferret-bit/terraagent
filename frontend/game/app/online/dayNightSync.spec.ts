import { flagsFromList, type ServerMessage } from '@terra/contracts';
import { getDayNightParams, resetDayNightParams, setDayNightParams } from '@terra/render/core/dayNightConfig';
import { compileData, createPlanet, getPlanetTime, setPlanetTime, SIM_VERSION, SimHost } from '@terra/sim';
import { beforeEach, describe, expect, it } from 'vitest';
import { CommandBus } from '../../net/commandBus';
import { Emitter } from '../../net/emitter';
import type { ConnectionState, Outgoing, Transport } from '../../net/types';
import { LocalHostCore, type LocalHostDeps } from '../../store/local/LocalHostCore';
import type { FromLocalHost } from '../../store/local/protocol';
import { memorySnapshotStore } from '../../store/local/snapshotStore';
import { ReplicaCore } from '../../store/replica/ReplicaCore';
import { SimWorkerController } from '../../store/worker/SimWorkerController';
import { WorldStore, type WorkerLike } from '../../store/WorldStore';
import { bindOnlineDayNightSync } from './dayNightSync';

class FakeTransport implements Transport {
  msgs = new Emitter<ServerMessage>();
  sent: Outgoing[] = [];
  state: ConnectionState = { phase: 'streaming', attempt: 0, downSinceMs: null };
  start() {}
  stop() {}
  send(m: Outgoing) { this.sent.push(m); }
  onMessage(fn: (m: ServerMessage) => void) { return this.msgs.on(fn); }
  onState() { return () => {}; }
}

const inProcessWorker = (): WorkerLike => {
  const w: WorkerLike = {
    onmessage: null,
    terminate() {},
    postMessage(msg) { queueMicrotask(() => ctl.handle(msg)); },
  };
  const ctl = new SimWorkerController((m) => queueMicrotask(() => w.onmessage?.({ data: m })), new ReplicaCore());
  return w;
};

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('Online Day/Night Synchronization (dayNightSync)', () => {
  beforeEach(() => {
    resetDayNightParams('sync');
  });

  it('syncs authoritative planet time from server welcome & deltas into dayNightConfig and dispatches setPlanetTime on F8 user edits', async () => {
    const auth = new SimHost({ flags: ['W00', 'W01'] });
    auth.load(createPlanet({ type: 'temperate', seed: 'sync-test', radius: 6 }));
    auth.state.colonies[0] = {
      index: 0, id: 'col_0', name: 'Alpha', color: 0xff8800, status: 'active', changedAt: 0, stock: {},
    };
    setPlanetTime(auth.state, { timeOfDay: 14.5, realHoursPerDay: 0.5, timeScale: 2 }, auth.tick);

    const t = new FakeTransport();
    const now = 1000;
    const store = new WorldStore(t, inProcessWorker, () => now);
    const bus = new CommandBus(
      t,
      5000,
      (id, kind, args) => store.notifySent(id, kind, args),
      (id) => store.notifyTimedOut(id),
    );
    store.start(['W00', 'W01']);

    let hasColony = true;
    const sync = bindOnlineDayNightSync({ store, commandBus: bus, hasColony: () => hasColony });

    t.msgs.emit({
      v: 1,
      t: 'welcome',
      d: {
        reason: 'join',
        colonyId: 'col_0',
        planet: { id: 'pl_sync', type: 'temperate', name: 'Sync' },
        state: auth.snapshot(),
        simVersion: SIM_VERSION,
        dataHash: compileData(flagsFromList(['W00', 'W01'])).hash,
        tick: auth.tick,
        serverTimeMs: 10_000,
        tickMs: 200,
        deltaHz: 5,
        flags: ['W00', 'W01'],
      },
    } as never);
    await flush();

    sync.syncFrame();
    expect(getDayNightParams().timeOfDay).toBeCloseTo(14.5, 3);
    expect(getDayNightParams().dayLengthHours).toBeCloseTo(0.5, 4);
    expect(getDayNightParams().timeScale).toBeCloseTo(2, 4);

    // User adjusts timeOfDay and dayLengthHours in F8 Visual Shader Lab -> sends setPlanetTime command
    setDayNightParams({ timeOfDay: 6.25, dayLengthHours: 1.0, timeScale: 3 }, 'user');
    const cmdMsg = t.sent.find((m) => m.t === 'cmd');
    expect(cmdMsg).toBeDefined();
    if (cmdMsg?.t === 'cmd') {
      expect(cmdMsg.d.kind).toBe('setPlanetTime');
      expect(cmdMsg.d.args).toEqual({ timeOfDay: 6.25, realHoursPerDay: 1.0, timeScale: 3 });

      const from = auth.tick;
      auth.submit({ colonyIndex: 0, source: 'player', commandId: cmdMsg.id, kind: cmdMsg.d.kind, args: cmdMsg.d.args });
      auth.step(1);
      t.msgs.emit({ v: 1, t: 'cmd.ack', d: { id: cmdMsg.id, appliedAtTick: auth.tick } } as never);
      await flush();
      // Even after cmd.ack resolves (inFlight == 0) and scrub hold expires, syncFrame waits until delta reaches appliedAtTick
      sync.syncFrame(performance.now() + 600);
      expect(getDayNightParams().timeOfDay).toBeCloseTo(6.25, 3);

      t.msgs.emit({ v: 1, t: 'delta', d: { fromTick: from, toTick: auth.tick, diff: auth.diffSince(from) } } as never);
    }
    await flush();
    expect(getPlanetTime(auth.state).realHoursPerDay).toBe(1.0);
    expect(getPlanetTime(auth.state).timeScale).toBe(3);

    // High-latency link (?lag=300 -> 600ms RTT > 450ms USER_SCRUB_HOLD_MS): in-flight command prevents snap-back
    hasColony = false;
    t.sent.length = 0;
    setDayNightParams({ timeOfDay: 22.0 }, 'user');
    sync.syncFrame(performance.now() + 600);
    expect(getDayNightParams().timeOfDay).toBeCloseTo(22.0, 3);

    // User RESET in F8 sets scrub hold so syncFrame does not overwrite reset values before ack
    resetDayNightParams('user');
    sync.syncFrame();
    expect(getDayNightParams().timeOfDay).toBeCloseTo(9.0, 3);

    sync.dispose();
    bus.dispose();
    store.dispose();
  });
});

describe('Singleplayer LocalHostCore time dev command', () => {
  it('supports devCommand("time", ...) in singleplayer LocalHostCore', async () => {
    let now = 0;
    const timers: Array<{ at: number; fn: () => void; live: boolean }> = [];
    const out: FromLocalHost[] = [];
    const deps: LocalHostDeps = {
      now: () => now,
      wallMs: () => 1_700_000_000_000 + now,
      schedule: (fn, d) => {
        const t = { at: now + d, fn, live: true };
        timers.push(t);
        return () => { t.live = false; };
      },
      store: memorySnapshotStore(),
    };
    const core = await LocalHostCore.create({ scenario: 'w00' }, deps, (m) => out.push(m));
    core.handle({ t: 'client', msg: { t: 'join', d: { planetId: 'local' } } });

    const r1 = (await core.devCommand('time', { timeOfDay: 19.5, realHoursPerDay: 0.75, timeScale: 4 })) as {
      timeOfDay: number; realHoursPerDay: number; timeScale: number; phase: string;
    };
    expect(r1.timeOfDay).toBeCloseTo(19.5, 4);
    expect(r1.realHoursPerDay).toBeCloseTo(0.75, 4);
    expect(r1.timeScale).toBeCloseTo(4, 4);
    expect(r1.phase).toBe('night');

    // Consecutive read-only query before next 200ms step preserves queued dev.time patches
    const rRead = (await core.devCommand('time', {})) as {
      timeOfDay: number; realHoursPerDay: number; timeScale: number;
    };
    expect(rRead.timeOfDay).toBeCloseTo(19.5, 4);
    expect(rRead.realHoursPerDay).toBeCloseTo(0.75, 4);
    expect(rRead.timeScale).toBeCloseTo(4, 4);

    // Wrapping timeOfDay=24 -> 0h with daylight=0 via @terra/sim previewPlanetTimePatch (D-37)
    const r2 = (await core.devCommand('time', { timeOfDay: 24 })) as {
      hour: number; cyclePhase: number; daylight: number; phase: string; realHoursPerDay: number;
    };
    expect(r2.hour).toBe(0);
    expect(r2.cyclePhase).toBe(0);
    expect(r2.daylight).toBe(0);
    expect(r2.phase).toBe('night');
    expect(r2.realHoursPerDay).toBeCloseTo(0.75, 4);

    for (const t of timers.splice(0)) if (t.live) { now = t.at; t.fn(); }
    const deltas = out.filter((m) => m.t === 'server' && m.msg.t === 'delta');
    expect(deltas.length).toBeGreaterThan(0);
    core.stop();
  });
});
