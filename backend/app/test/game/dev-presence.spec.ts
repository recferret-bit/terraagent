import { describe, expect, it, vi } from 'vitest';
import { createState, setBlob, snapshot, type PlanetState } from '@terra/sim';
import { EventBus } from '../../src/bus/event-bus';
import { DevCommandRegistry } from '../../src/dev/dev-command.registry';
import { PresenceCommands } from '../../src/dev/presence.command';
import type { FlagsService } from '../../src/flags/flags.service';
import type { GamePlanets } from '../../src/game/game-planets.service';
import { DevPresence } from '../../src/game/presence/dev-presence';
import { HardModeClock } from '../../src/game/presence/hard-mode-clock';

function world(away: boolean): PlanetState {
  const state = createState({ planetId: 'pl_dev', planetType: 'temperate', seed: 'w09', radius: 2 });
  state.colonies.push({ index: 0, id: 'col_0', name: 'C', color: 1, status: 'active', changedAt: 0 });
  if (away) setBlob(state, 'presence', { byColony: { '0': { away: true } } }, 1);
  return state;
}

function harness(state: PlanetState, enabled = true) {
  const submits: unknown[] = [];
  const fanned: unknown[] = [];
  const planets = {
    isLoaded: (id: string) => id === 'pl_dev',
    fullState: async () => ({ tick: state.meta.tick, bytes: snapshot(state) }),
    submit: async (_planetId: string, cmd: { args: { away: boolean }; commandId: string }) => {
      submits.push(cmd);
      setBlob(state, 'presence', { byColony: { '0': { away: cmd.args.away } } }, state.meta.tick + 1);
      state.meta.tick += 1;
      return { ok: true, commandId: cmd.commandId, appliedAtTick: state.meta.tick };
    },
    fanEvent: (_planetId: string, event: unknown) => { fanned.push(event); },
  };
  const clock = new HardModeClock();
  const bus = new EventBus();
  const events: unknown[] = [];
  bus.on('planet.event', (event) => { events.push(event); }, { module: 'test' });
  const flags = { has: (wave: string) => enabled && wave === 'W09' } as FlagsService;
  const presence = new DevPresence(planets as unknown as GamePlanets, clock, bus, flags);
  return { presence, clock, submits, events, fanned };
}

const seat = { planetId: 'pl_dev', colonyIndex: 0, colonyId: 'col_0' };

describe('W09-31 dev presence', () => {
  it('posts system.presence once for away, then skips a repeat', async () => {
    const { presence, submits } = harness(world(false));
    const first = await presence.setAway({ ...seat, away: true });
    expect(first).toMatchObject({ posted: true, away: true, appliedAtTick: 1 });
    expect(submits).toHaveLength(1);
    expect(submits[0]).toMatchObject({
      source: 'system', kind: 'system.presence', colonyIndex: 0, args: { colonyId: 'col_0', away: true },
    });
    const second = await presence.setAway({ ...seat, away: true });
    expect(second.posted).toBe(false);
    expect(submits).toHaveLength(1);
    const back = await presence.setAway({ ...seat, away: false });
    expect(back).toMatchObject({ posted: true, away: false });
    expect(submits).toHaveLength(2);
  });

  it('rejects colony eliminate while present and does not start the clock', async () => {
    const { presence, clock, events, fanned } = harness(world(false));
    await expect(presence.eliminate(seat)).rejects.toMatchObject({ errorCode: 'NOT_AWAY', message: 'not_away' });
    expect(clock.get('pl_dev', 'col_0')).toBeUndefined();
    expect(events).toEqual([]);
    expect(fanned).toEqual([]);
  });

  it('emits colonyEliminated and starts the hard-mode clock once while away', async () => {
    const { presence, clock, events, fanned } = harness(world(true));
    const first = await presence.eliminate(seat);
    expect(first).toMatchObject({ event: 'colonyEliminated', cause: 'other', colonyId: 'col_0', atTick: 0 });
    expect(clock.get('pl_dev', 'col_0')?.startedAtMs).toBe(first.startedAtMs);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'colonyEliminated',
      severity: 'critical',
      data: { colonyId: 'col_0', colonyIndex: 0, cause: 'other', atTick: 0 },
    });
    expect(fanned).toHaveLength(1);
    const second = await presence.eliminate(seat);
    expect(second.startedAtMs).toBe(first.startedAtMs);
    expect(events).toHaveLength(2);
  });

  it('registers away, back, and colony.eliminate', async () => {
    const registry = new DevCommandRegistry({ NODE_ENV: 'test' } as never);
    const setAway = vi.fn(async () => ({ posted: true }));
    const eliminate = vi.fn(async () => ({ event: 'colonyEliminated' }));
    new PresenceCommands(registry, { setAway, eliminate } as unknown as DevPresence).onModuleInit();
    expect(registry.list().map((command) => command.name).sort()).toEqual(['away', 'back', 'colony.eliminate']);
    await registry.run('away', seat);
    await registry.run('back', seat);
    await registry.run('colony.eliminate', seat);
    expect(setAway).toHaveBeenNthCalledWith(1, { ...seat, away: true });
    expect(setAway).toHaveBeenNthCalledWith(2, { ...seat, away: false });
    expect(eliminate).toHaveBeenCalledWith(seat);
  });
});
