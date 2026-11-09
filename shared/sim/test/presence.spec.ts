import { parseWaves, type SimCommandV1 } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { createRegistryPipeline, createState, step, type PlanetState } from '../src';
import { presenceAway } from '../src/systems/presence';

function planet(): PlanetState {
  const state = createState({ planetId: 'pl_presence', planetType: 'temperate', seed: 'w09', radius: 4 });
  state.colonies.push({ index: 0, id: 'col_0', name: 'C', color: 1, status: 'active', changedAt: 0 });
  return state;
}

function presenceCmd(away: boolean, commandId: string, extra?: Partial<SimCommandV1>): SimCommandV1 {
  return {
    colonyIndex: 0,
    source: 'system',
    commandId,
    kind: 'system.presence',
    args: { colonyId: 'col_0', away },
    ...extra,
  };
}

const pipeline = () => createRegistryPipeline({ flags: parseWaves('..09') });

const presenceEvents = (events: readonly { kind: string; data: Record<string, unknown> }[]) =>
  events.filter((event) => event.kind === 'colonyAway' || event.kind === 'colonyBack');

describe('system.presence', () => {
  it('emits colonyAway once, then colonyBack', () => {
    const state = planet();
    const flags = pipeline();
    const away = step(state, [presenceCmd(true, 'cm_away')], 1, flags);
    expect(away.outcomes[0]?.code).toBeUndefined();
    expect(presenceEvents(away.events).map((event) => event.kind)).toEqual(['colonyAway']);
    expect(presenceEvents(away.events)[0]?.data).toEqual({ colonyId: 'col_0', colonyIndex: 0, atTick: 1 });
    expect(presenceAway(state, 0)).toBe(true);

    const again = step(state, [presenceCmd(true, 'cm_again')], 1, flags);
    expect(presenceEvents(again.events)).toEqual([]);
    expect(again.outcomes[0]?.code).toBeUndefined();
    expect(state.blobs.presence?.changedAt).toBe(1);

    const back = step(state, [presenceCmd(false, 'cm_back')], 1, flags);
    expect(presenceEvents(back.events).map((event) => event.kind)).toEqual(['colonyBack']);
    expect(presenceEvents(back.events)[0]?.data).toMatchObject({ colonyId: 'col_0', colonyIndex: 0, atTick: 3 });
    expect(presenceAway(state, 0)).toBe(false);
  });

  it('does not emit colonyBack when the colony was never away', () => {
    const state = planet();
    const res = step(state, [presenceCmd(false, 'cm_back')], 1, pipeline());
    expect(presenceEvents(res.events)).toEqual([]);
    expect(state.blobs.presence).toBeUndefined();
  });

  it('rejects a bad payload, an unknown colony, a player source, and a mismatched index', () => {
    const state = planet();
    const flags = pipeline();
    const missing = step(state, [presenceCmd(true, 'cm_bad', { args: { colonyId: 'col_0' } })], 1, flags);
    expect(missing.outcomes[0]?.code).toBe('invalid_args');

    const unknown = step(
      state,
      [presenceCmd(true, 'cm_miss', { args: { colonyId: 'col_missing', away: true }, colonyIndex: null })],
      1,
      flags,
    );
    expect(unknown.outcomes[0]?.code).toBe('not_own_colony');

    const player = step(state, [presenceCmd(true, 'cm_player', { source: 'player' })], 1, flags);
    expect(player.outcomes[0]?.code).toBe('not_authorized');

    const clash = step(state, [presenceCmd(true, 'cm_clash', { args: { colonyId: 'col_9', away: true } })], 1, flags);
    expect(clash.outcomes[0]?.code).toBe('not_own_colony');
    expect(state.blobs.presence).toBeUndefined();
  });

  it('resolves the colony by id when colonyIndex is null, and keys the blob by index', () => {
    const state = planet();
    state.colonies.push({ index: 1, id: 'col_1', name: 'D', color: 2, status: 'active', changedAt: 0 });
    const res = step(
      state,
      [
        presenceCmd(true, 'cm_by_id', {
          colonyIndex: null,
          args: { colonyId: 'col_1', away: true },
        }),
      ],
      1,
      pipeline(),
    );
    expect(res.outcomes[0]?.code).toBeUndefined();
    expect(presenceEvents(res.events)[0]?.data).toMatchObject({ colonyId: 'col_1', colonyIndex: 1 });
    expect(presenceAway(state, 1)).toBe(true);
    expect(presenceAway(state, 0)).toBe(false);
    const blob = state.blobs.presence?.value as { byColony: Record<string, { away: boolean }> };
    expect(blob.byColony['1']).toEqual({ away: true });
  });

  it('is wave_disabled when W09 is off and does not write the blob', () => {
    const state = planet();
    const off = createRegistryPipeline({ flags: parseWaves('..08') });
    const res = step(state, [presenceCmd(true, 'cm_off')], 1, off);
    expect(res.outcomes[0]?.code).toBe('wave_disabled');
    expect(presenceEvents(res.events)).toEqual([]);
    expect(state.blobs.presence).toBeUndefined();
  });
});
