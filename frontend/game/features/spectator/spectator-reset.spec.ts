// @vitest-environment jsdom
import { CLOSE_CODES, flagsFromList, type ServerMessage } from '@terra/contracts';
import { createPlanet, SIM_VERSION, SimHost } from '@terra/sim';
import { afterEach, describe, expect, it } from 'vitest';
import { localHostOptions } from '../../app/online/localHost';
import {
  isLocalSpectatorAllowed,
  isSpectatorResetSearch,
  isSpectatorSearch,
  onlineMode,
  stripSpectatorResetFromUrl,
} from '../../app/online/onlineMode';
import { setProductionBuildOverride } from '../../core/buildEnv';
import { closeAction, SPECTATOR_LOCAL_ONLY, terminalText } from '../../net/closeCodes';
import { Emitter } from '../../net/emitter';
import type { ConnectionState, Transport } from '../../net/types';
import { LocalHostCore, type LocalHostDeps } from '../../store/local/LocalHostCore';
import type { FromLocalHost } from '../../store/local/protocol';
import { memorySnapshotStore } from '../../store/local/snapshotStore';
import { ownBytes } from '../../store/bytes';
import { WorldStore } from '../../store/WorldStore';

afterEach(() => {
  setProductionBuildOverride(null);
});

describe('Local-only spectator guards & reset query parsing', () => {
  it('enforces local-only spectator access and rejects production builds or public origins', () => {
    expect(isLocalSpectatorAllowed({ location: { protocol: 'http:', hostname: '127.0.0.1' }, mode: 'development', prod: false })).toBe(true);
    expect(isLocalSpectatorAllowed({ location: { protocol: 'http:', hostname: 'localhost' }, mode: 'test', prod: false })).toBe(true);
    expect(isLocalSpectatorAllowed({ location: { protocol: 'https:', hostname: '[::1]' }, mode: 'development', prod: false })).toBe(true);

    expect(isLocalSpectatorAllowed({ location: { protocol: 'https:', hostname: 'play.terraagent.fun' }, mode: 'development', prod: false })).toBe(false);
    expect(isLocalSpectatorAllowed({ location: { protocol: 'https:', hostname: 'terraagent.fun' }, mode: 'development', prod: false })).toBe(false);
    expect(isLocalSpectatorAllowed({ location: { protocol: 'http:', hostname: '192.168.1.25' }, mode: 'development', prod: false })).toBe(false);
    expect(isLocalSpectatorAllowed({ location: { protocol: 'file:', hostname: 'localhost' }, mode: 'development', prod: false })).toBe(false);
    expect(isLocalSpectatorAllowed({ location: { protocol: 'http:', hostname: '127.0.0.1' }, mode: 'production', prod: true })).toBe(false);
    expect(isLocalSpectatorAllowed({ location: { protocol: 'http:', hostname: '127.0.0.1' }, mode: 'development', prod: false, appEnv: 'production' })).toBe(false);

    const remoteEnv = { location: { protocol: 'https:', hostname: 'play.terraagent.fun' }, mode: 'development', prod: false };
    expect(isSpectatorSearch('?spectator=1', remoteEnv)).toBe(false);
    expect(onlineMode('?spectator=1', remoteEnv)).toBe('boot');
    expect(onlineMode('?spectator=1&planet=dune', remoteEnv)).toBeNull();
    expect(onlineMode('?scenario=spectator', remoteEnv)).toBe('boot');
    expect(localHostOptions('?spectator=1', remoteEnv)).toBeNull();
  });

  it('parses & strips one-shot spectator reset parameter without clobbering other query params', () => {
    expect(localHostOptions('?spectator=1&reset=1')).toMatchObject({ scenario: 'spectator', spectator: true, reset: true });
    expect(isSpectatorResetSearch('?spectator=1&reset=1')).toBe(true);
    expect(isSpectatorResetSearch('?spectator=1&reset=true')).toBe(true);
    expect(isSpectatorResetSearch('?spectator=1&reset')).toBe(true);
    expect(isSpectatorResetSearch('?spectator=1')).toBe(false);
    expect(isSpectatorResetSearch('?spectator=1&reset=0')).toBe(false);
    expect(isSpectatorResetSearch('?spectator=1&reset=false')).toBe(false);

    let replaced = '';
    const stripped = stripSpectatorResetFromUrl(
      { pathname: '/play.html', search: '?spectator=1&host=server&reset=1&bots=3', hash: '#top' },
      (u) => {
        replaced = u;
      },
    );
    expect(stripped).toBe(true);
    expect(replaced).toBe('/play.html?spectator=1&host=server&bots=3#top');
  });
});

describe('LocalHostCore spectator snapshot persistence & reset=true wipe', () => {
  it('persists local spectator bots + feeds across restarts and wipes from scratch when reset=true', async () => {
    const now = 0;
    const sharedStore = memorySnapshotStore();
    const makeDeps = (): LocalHostDeps => ({
      now: () => now,
      wallMs: () => 1_700_000_000_000 + now,
      schedule: () => () => undefined,
      store: sharedStore,
    });

    const out1: FromLocalHost[] = [];
    const core1 = await LocalHostCore.create(
      { scenario: 'spectator', spectator: true, planetType: 'temperate', botCount: 2, seed: 'spec-persist' },
      makeDeps(),
      (m) => out1.push(m),
    );
    core1.advance(18);
    expect(core1.tick).toBe(18);
    await core1.stop();

    const out2: FromLocalHost[] = [];
    const core2 = await LocalHostCore.create(
      { scenario: 'spectator', spectator: true, planetType: 'temperate', botCount: 2, seed: 'spec-persist' },
      makeDeps(),
      (m) => out2.push(m),
    );
    core2.handle({ t: 'client', msg: { t: 'join', d: { planetId: 'local', mode: 'spectator' } } });
    const w2 = out2.flatMap((m) => (m.t === 'server' ? [m.msg] : [])).find((m) => m.t === 'welcome');
    expect(core2.tick).toBe(18);
    expect((w2?.d as { recentInputs?: unknown[] })?.recentInputs?.length ?? 0).toBeGreaterThan(0);
    await core2.stop();

    const out3: FromLocalHost[] = [];
    const core3 = await LocalHostCore.create(
      { scenario: 'spectator', spectator: true, planetType: 'temperate', botCount: 2, seed: 'spec-persist', reset: true },
      makeDeps(),
      (m) => out3.push(m),
    );
    core3.handle({ t: 'client', msg: { t: 'join', d: { planetId: 'local', mode: 'spectator' } } });
    const w3 = out3.flatMap((m) => (m.t === 'server' ? [m.msg] : [])).find((m) => m.t === 'welcome');
    expect(core3.tick).toBe(0);
    expect((w3?.d as { recentInputs?: unknown[] })?.recentInputs ?? []).toHaveLength(0);
    await core3.stop();

    const core4 = await LocalHostCore.create(
      { scenario: 'spectator', spectator: true, planetType: 'temperate', botCount: 2, seed: 'spec-persist' },
      makeDeps(),
      () => undefined,
    );
    expect(core4.tick).toBe(0);
    await core4.stop();
  });
});

describe('WorldStore spectator reset feed clearing & close codes', () => {
  it('treats 4003 spectator_local_only as terminal and clears stale WorldStore feeds on reset welcome', () => {
    expect(closeAction(CLOSE_CODES.forbidden, SPECTATOR_LOCAL_ONLY)).toBe('terminal');
    expect(terminalText(CLOSE_CODES.forbidden, SPECTATOR_LOCAL_ONLY)).toBe('Spectator mode is local-only');

    const msgs = new Emitter<ServerMessage>();
    const states = new Emitter<ConnectionState>();
    const fakeTransport: Transport = {
      state: { phase: 'idle', attempt: 0, downSinceMs: null },
      start() {},
      stop() {},
      send() {},
      onMessage: (fn) => msgs.on(fn),
      onState: (fn) => states.on(fn),
    };
    const host = new SimHost({ flags: flagsFromList([]) });
    host.load(createPlanet({ type: 'temperate', planetType: 'ocean', seed: 'ws-feed-reset', planetId: 'pl_spec_ocean_2', radius: 16, capacity: 4 }));
    const makeWelcome = (tick: number, inputsCount: number): ServerMessage => ({
      v: 1,
      t: 'welcome',
      tick,
      d: {
        reason: tick === 0 ? 'resync' : 'join',
        mode: 'spectator',
        colonyId: null,
        planet: { id: 'pl_spec_ocean_2', type: 'ocean', name: 'spec' },
        state: ownBytes(host.snapshot({ forClient: true })),
        simVersion: SIM_VERSION,
        dataHash: host.pipeline.config.data.hash,
        tick,
        serverTimeMs: 1_700_000_000_000,
        tickMs: 200,
        deltaHz: 5,
        flags: [...host.pipeline.config.flags],
        buildings: [],
        recentInputs: Array.from({ length: inputsCount }, (_, i) => ({
          id: `in_${i}`,
          planetId: 'pl_spec_ocean_2',
          sectorId: 'sec_0_0',
          colonyId: 'col_0',
          colonyIndex: 0,
          actorId: 'bot:col_0',
          isBot: true,
          source: 'bot' as const,
          commandId: `cm_${i}`,
          kind: 'enqueueTask',
          args: {},
          status: 'applied' as const,
          outcome: 'applied' as const,
          atTick: i + 1,
          createdAtMs: 1_700_000_000_000,
        })),
        recentDecisions: inputsCount > 0 ? [{
          id: 'dec_0',
          planetId: 'pl_spec_ocean_2',
          sectorId: 'sec_0_0',
          colonyId: 'col_0',
          colonyIndex: 0,
          actorId: 'bot:col_0',
          isBot: true,
          actorSource: 'rival_planner' as const,
          decisionKind: 'expand',
          summary: 'Build solar',
          rationale: 'Power needed',
          commandId: 'cm_0',
          commandKind: 'enqueueTask',
          payload: {},
          outcome: 'applied' as const,
          atTick: 1,
          createdAtMs: 1_700_000_000_000,
        }] : [],
      },
    });

    const store = new WorldStore(fakeTransport, () => ({ postMessage() {}, onmessage: null, terminate() {} }));
    store.start([]);
    msgs.emit(makeWelcome(25, 2));
    expect(store.recentInputs()).toHaveLength(2);
    expect(store.recentDecisions()).toHaveLength(1);
    expect(store.isSpectator()).toBe(true);

    msgs.emit(makeWelcome(0, 0));
    expect(store.recentInputs()).toHaveLength(0);
    expect(store.recentDecisions()).toHaveLength(0);
    store.dispose();

    setProductionBuildOverride(true);
    const prodStore = new WorldStore(fakeTransport, () => ({ postMessage() {}, onmessage: null, terminate() {} }));
    prodStore.start([]);
    msgs.emit(makeWelcome(1, 0));
    expect(prodStore.isSpectator()).toBe(false);
    prodStore.dispose();
  });
});
