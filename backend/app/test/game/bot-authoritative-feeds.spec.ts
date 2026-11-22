import { createPlanet, DEV_PLANET_SEED, seedRivalAiColonies } from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { PlanetHost } from '../../src/game/thread/planet-host';
import type { FromThread } from '../../src/game/thread/protocol';

const FLAGS = ['W00', 'W01', 'W02', 'W03', 'W08', 'W09', 'W14', 'W15', 'W18'];

describe('PlanetHost authoritative bot inputs and sector sync', () => {
  it('plans backend bot inputs explicitly, emits simFeeds and sectorSync without client ack waiters', () => {
    const out: FromThread[] = [];
    const host = new PlanetHost(0, FLAGS, (m) => out.push(m));
    host.handle({
      t: 'load',
      planetId: 'pl_auth_bots',
      params: { type: 'temperate', seed: DEV_PLANET_SEED, radius: 36, capacity: 8 },
    });
    const planet = host.planets.get('pl_auth_bots')!;
    seedRivalAiColonies(planet.state, {
      count: 2,
      capacity: 8,
      tick: 0,
      data: planet.pipeline.config.data,
    });
    out.length = 0;

    for (let i = 0; i < 12; i++) {
      expect(host.stepPlanet('pl_auth_bots', 1)).toBe(true);
    }

    const feedMsgs = out.filter((m): m is Extract<FromThread, { t: 'simFeeds' }> => m.t === 'simFeeds');
    const allInputs = feedMsgs.flatMap((f) => f.inputs);
    const allDecisions = feedMsgs.flatMap((f) => f.decisions);
    expect(allInputs.length).toBeGreaterThan(0);
    expect(allInputs.some((i) => i.source === 'bot' && i.isBot)).toBe(true);
    expect(allDecisions.some((d) => d.actorSource === 'bot_governor' && d.isBot)).toBe(true);
    // Internal bot inputs must not emit cmd waiters ack/reject for the WS command bus.
    expect(out.filter((m) => m.t === 'ack' || m.t === 'reject')).toHaveLength(0);

    host.handle({ t: 'sectorSyncNow', planetId: 'pl_auth_bots' });
    const syncs = out.filter((m): m is Extract<FromThread, { t: 'sectorSync' }> => m.t === 'sectorSync');
    expect(syncs.length).toBeGreaterThan(0);
    const latest = syncs[syncs.length - 1]!.payload;
    expect(latest.alivePlayers).toBe(0);
    expect(latest.aliveBots).toBe(2);
    expect(latest.participants.every((p) => p.isBot && p.actorKind === 'bot')).toBe(true);
  });

  it('answers queued player/dev commands with ack while still recording them into simFeeds', () => {
    const out: FromThread[] = [];
    const host = new PlanetHost(0, FLAGS, (m) => out.push(m));
    const state = createPlanet({ type: 'flat', seed: 'p_q', planetId: 'pl_q', radius: 12, capacity: 4 });
    expect(state.grid.count).toBeGreaterThan(0);
    host.handle({ t: 'load', planetId: 'pl_q', params: { type: 'flat', seed: 'p_q', radius: 12, capacity: 4 } });
    out.length = 0;

    host.handle({
      t: 'cmd',
      planetId: 'pl_q',
      cmd: { colonyIndex: null, source: 'dev', commandId: 'cm_ping_1', kind: 'dev.ping', args: {} },
    });
    expect(host.stepPlanet('pl_q', 1)).toBe(true);

    expect(out.some((m) => m.t === 'ack' && m.commandId === 'cm_ping_1')).toBe(true);
    const feeds = out.filter((m): m is Extract<FromThread, { t: 'simFeeds' }> => m.t === 'simFeeds');
    expect(feeds.flatMap((f) => f.inputs)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ commandId: 'cm_ping_1', kind: 'dev.ping', source: 'dev', status: 'applied' }),
      ]),
    );
  });
});
