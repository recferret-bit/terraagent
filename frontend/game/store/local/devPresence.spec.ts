import { parseWaves } from '@terra/contracts';
import { createState, type PlanetState, type SimCommand } from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { LocalDevError, LocalHostCore, type LocalHostDeps } from './LocalHostCore';
import { colonyPresenceAway, LocalHardModeClock, planLocalPresence } from './devPresence';
import { builtPlanetSource } from './planetSource';
import { memorySnapshotStore } from './snapshotStore';

const waves = ['W09'];

function planet(away: boolean): PlanetState {
  const state = createState({ planetId: 'pl_dev', planetType: 'temperate', seed: 'w09', radius: 2 });
  state.colonies.push({ index: 0, id: 'col_0', name: 'C', color: 1, status: 'active', changedAt: 0 });
  if (away) state.blobs.presence = { changedAt: 1, value: { byColony: { '0': { away: true } } } };
  return state;
}

const args = { planetId: 'pl_dev', colonyIndex: 0, colonyId: 'col_0' };

describe('local dev presence', () => {
  it('does not queue a second away, and eliminate while present does not start the clock', () => {
    const clock = new LocalHardModeClock();
    const state = planet(false);
    const queued: SimCommand[] = [];
    const first = planLocalPresence({ name: 'away', args, waves, state, tick: 3, nowMs: 10, queued, clock });
    expect(first.ok && first.command?.kind).toBe('system.presence');
    if (first.ok && first.command) queued.push(first.command);
    const second = planLocalPresence({ name: 'away', args, waves, state, tick: 3, nowMs: 10, queued, clock });
    expect(second.ok && second.command).toBeUndefined();
    const eliminated = planLocalPresence({ name: 'colony.eliminate', args, waves, state, tick: 3, nowMs: 10, queued: [], clock });
    expect(eliminated).toEqual({ ok: false, code: 'not_away', message: 'not_away' });
    expect(clock.get('pl_dev', 'col_0')).toBeUndefined();
  });

  it('starts the hard-mode clock once when the colony is away', () => {
    const clock = new LocalHardModeClock();
    const state = planet(true);
    const first = planLocalPresence({ name: 'colony.eliminate', args, waves, state, tick: 4, nowMs: 50, queued: [], clock });
    const second = planLocalPresence({ name: 'colony.eliminate', args, waves, state, tick: 4, nowMs: 90, queued: [], clock });
    expect(first.ok && first.event?.kind).toBe('colonyEliminated');
    expect(clock.get('pl_dev', 'col_0')?.startedAtMs).toBe(50);
    expect(second.ok && second.reply.startedAtMs).toBe(50);
  });
});

describe('LocalHostCore presence commands', () => {
  it('marks the colony away in one tick and a repeat does not post again', async () => {
    const flags = parseWaves('..09').list;
    const source = builtPlanetSource('w09', flags, () => planet(false));
    const deps: LocalHostDeps = {
      now: () => 0, wallMs: () => 1_700_000_000_000, schedule: () => () => undefined, store: memorySnapshotStore(),
    };
    const core = LocalHostCore.open(source, flags, deps, () => undefined);
    const first = await core.devCommand('away', args) as { posted: boolean; appliedAtTick: number };
    expect(first.posted).toBe(true);
    expect(first.appliedAtTick).toBe(core.tick);
    expect(colonyPresenceAway(core.simHost.state, 0)).toBe(true);
    const second = await core.devCommand('away', args) as { posted: boolean };
    expect(second.posted).toBe(false);
    expect(core.tick).toBe(first.appliedAtTick);
    await expect(core.devCommand('colony.eliminate', args)).resolves.toMatchObject({ event: 'colonyEliminated' });
    core.simHost.state.blobs.presence = { changedAt: core.tick, value: { byColony: { '0': { away: false } } } };
    await expect(core.devCommand('colony.eliminate', args)).rejects.toBeInstanceOf(LocalDevError);
    await expect(core.devCommand('colony.eliminate', args)).rejects.toMatchObject({ code: 'not_away' });
    await core.stop();
  });
});
