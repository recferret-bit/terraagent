import { describe, expect, it } from 'vitest';
import { HomeResponseSchema } from '@terra/contracts';
import { createState, setBlob, snapshot, type PlanetState } from '@terra/sim';
import { EventBus } from '../../src/bus/event-bus';
import { HomeRepository } from '../../src/core/home/home.repository';
import { HomeService } from '../../src/core/home/home.service';
import type { FlagsService } from '../../src/flags/flags.service';
import type { GamePlanets } from '../../src/game/game-planets.service';
import { DevPresence } from '../../src/game/presence/dev-presence';
import { HardModeClock } from '../../src/game/presence/hard-mode-clock';
import { AlertRouter } from '../../src/notify/alert-router';
import { NotifierPort, type Notification, type NotificationResult } from '../../src/ports/notifier.port';
import { freeLandingHost } from '../unit/fixtures/landing-host';

class RecordingNotifier extends NotifierPort {
  readonly sent: Notification[] = [];
  send(note: Notification): Promise<NotificationResult> {
    this.sent.push(note);
    return Promise.resolve({ id: String(this.sent.length), status: 'sent' });
  }
}

function awayWorld(planetId: string, colonyId: string): PlanetState {
  const state = createState({ planetId, planetType: 'temperate', seed: 'w09', radius: 2 });
  state.colonies.push({ index: 0, id: colonyId, name: 'C', color: 1, status: 'active', changedAt: 0 });
  setBlob(state, 'presence', { byColony: { '0': { away: true } } }, 1);
  return state;
}

async function seatedHome(clock: HardModeClock): Promise<HomeService> {
  const home = new HomeService(new HomeRepository());
  home.setLandingHost(freeLandingHost);
  home.setHardModeClock(clock);
  return home;
}

function wire(state: PlanetState, clock: HardModeClock, planetId: string) {
  const planets = {
    isLoaded: (id: string) => id === planetId,
    fullState: async () => ({ tick: state.meta.tick, bytes: snapshot(state) }),
    submit: async () => ({ ok: true, commandId: 'cm', appliedAtTick: state.meta.tick }),
    fanEvent: () => undefined,
  };
  const bus = new EventBus();
  const port = new RecordingNotifier();
  const router = new AlertRouter(port, bus);
  router.onModuleInit();
  const flags = { has: (wave: string): boolean => wave === 'W09' } as unknown as FlagsService;
  const presence = new DevPresence(planets as unknown as GamePlanets, clock, bus, flags);
  return { port, router, presence };
}

const eliminatedOf = (port: RecordingNotifier) => port.sent.filter((note) => note.kind === 'colony_eliminated');

describe('W09-19 hard-mode home', () => {
  it('stays ACTIVE when the hard-mode clock has no mark', async () => {
    const home = await seatedHome(new HardModeClock());
    const body = await home.getOrAssignHome({ id: 'pilot', handle: 'Pilot' });
    expect(body.state).toBe('ACTIVE');
  });

  it('returns ELIMINATED from the clock mark and asks the router once', async () => {
    const clock = new HardModeClock();
    const home = await seatedHome(clock);
    const before = await home.getOrAssignHome({ id: 'pilot', handle: 'Pilot' });
    if (before.state !== 'ACTIVE') throw new Error('expected ACTIVE');
    const seat = { planetId: before.planet.id, colonyId: before.colony.id, colonyIndex: before.colony.colonyIndex ?? 0 };
    const { port, router, presence } = wire(awayWorld(seat.planetId, seat.colonyId), clock, seat.planetId);
    const first = await presence.eliminate(seat);
    const body = HomeResponseSchema.parse(await home.getOrAssignHome({ id: 'pilot', handle: 'Pilot' }));
    expect(body.state).toBe('ELIMINATED');
    if (body.state !== 'ELIMINATED') return;
    expect(body.recap).toEqual({ startedAtMs: first.startedAtMs, atTick: first.atTick, cause: 'other' });
    expect(body.planets.map((planet) => planet.id)).toEqual([seat.planetId]);
    expect(body.newPlanetTypes).toEqual([]);
    expect(body.colony?.id).toBe(seat.colonyId);
    expect(eliminatedOf(port)).toHaveLength(1);
    expect(eliminatedOf(port)[0]).toMatchObject({ kind: 'colony_eliminated', colonyId: seat.colonyId });
    router.onModuleDestroy();
  });

  it('does not ask the router again when eliminate repeats while the mark exists', async () => {
    const clock = new HardModeClock();
    const home = await seatedHome(clock);
    const before = await home.getOrAssignHome({ id: 'repeat', handle: 'Repeat' });
    if (before.state !== 'ACTIVE') throw new Error('expected ACTIVE');
    const seat = { planetId: before.planet.id, colonyId: before.colony.id, colonyIndex: before.colony.colonyIndex ?? 0 };
    const { port, router, presence } = wire(awayWorld(seat.planetId, seat.colonyId), clock, seat.planetId);
    const first = await presence.eliminate(seat);
    const second = await presence.eliminate(seat);
    expect(second.startedAtMs).toBe(first.startedAtMs);
    expect(clock.get(seat.planetId, seat.colonyId)?.startedAtMs).toBe(first.startedAtMs);
    expect(eliminatedOf(port)).toHaveLength(1);
    const again = await home.getOrAssignHome({ id: 'repeat', handle: 'Repeat' });
    expect(again.state).toBe('ELIMINATED');
    router.onModuleDestroy();
  });
});
