import { parseWaves, type SimCommandV1 } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND, createEngineConfig, createRegistryPipeline, createState, step, type PlanetState } from '../../src';
import treasuryMod, { readTreasury } from '../../src/systems/treasury';

/** One simulated hour at 200 ms/tick (5 ticks/s). `hazard.intervalTicks` 180 → 100 attempts. */
const HOUR_TICKS = TICKS_PER_SECOND * 60 * 60;
const SHIELD_UNTIL = 1_000_000;

function planet(seed: string): PlanetState {
  return createState({ planetId: 'pl_w22', planetType: 'temperate', seed, radius: 4 });
}

function pipeline(flags = '..22') {
  return createRegistryPipeline({ flags: parseWaves(flags), modules: [treasuryMod] });
}

function shieldCmd(
  untilTick: number,
  extra?: Partial<SimCommandV1> & { magnitudeBp?: number },
): SimCommandV1 {
  const { magnitudeBp, ...rest } = extra ?? {};
  return {
    colonyIndex: null,
    source: 'system',
    commandId: 'cm_shield',
    kind: 'system.treasuryEffect',
    args: {
      kind: 'meteor_shield',
      untilTick,
      ...(magnitudeBp !== undefined ? { params: { magnitudeBp } } : {}),
    },
    ...rest,
  };
}

/** Applies the shield (optional) and advances `HOUR_TICKS`, one tick at a time or in one coarse step. */
function runHour(seed: string, magnitudeBp: number | null, coarse: boolean) {
  const state = planet(seed);
  const pipe = pipeline();
  const terrain = Uint8Array.from(state.grid.layers.terrain);
  if (magnitudeBp !== null) {
    const applied = step(state, [shieldCmd(SHIELD_UNTIL, { magnitudeBp, commandId: 'cm_on' })], 1, pipe);
    expect(applied.outcomes[0]?.code).toBeUndefined();
    expect(applied.events.filter((event) => event.kind === 'treasuryEffectStarted')).toHaveLength(1);
  }
  const left = HOUR_TICKS - state.meta.tick;
  if (coarse) step(state, [], left, pipe);
  else for (let n = 0; n < left; n++) step(state, [], 1, pipe);
  expect(state.meta.tick).toBe(HOUR_TICKS);
  expect(state.grid.layers.terrain).toEqual(terrain);
  return readTreasury(state);
}

describe('W22-10 meteor_shield', () => {
  it('cuts hazard strikes by at least 60% over one simulated hour', () => {
    const seed = 'w22-shield';
    const control = runHour(seed, null, true);
    const shielded = runHour(seed, 7500, true);
    const stepped = runHour(seed, 7500, false);
    expect(control.hazardStrikes).toBe(100);
    expect(control.lightningStrikes).toBe(50);
    expect(shielded.hazardStrikes).toBeGreaterThan(0);
    expect(shielded.hazardStrikes).toBeLessThanOrEqual(control.hazardStrikes * 0.4);
    expect(shielded.lightningStrikes).toBeLessThanOrEqual(shielded.hazardStrikes);
    expect(stepped).toEqual(shielded);
  });

  it('does not reduce the rate when magnitude is 0', () => {
    const seed = 'w22-shield';
    const control = runHour(seed, null, true);
    const zero = runHour(seed, 0, true);
    expect(zero.hazardStrikes).toBe(control.hazardStrikes);
    expect(zero.lightningStrikes).toBe(control.lightningStrikes);
  });

  it('rejects a player source and garbage args without storing an effect', () => {
    const state = planet('w22-reject');
    const pipe = pipeline();
    const player = step(state, [shieldCmd(SHIELD_UNTIL, { source: 'player', commandId: 'cm_player' })], 1, pipe);
    expect(player.outcomes[0]?.code).toBe('not_authorized');
    expect(player.events.filter((event) => event.kind === 'treasuryEffectStarted')).toEqual([]);
    expect(state.blobs.treasury).toBeUndefined();

    const garbage = step(state, [shieldCmd(SHIELD_UNTIL, { commandId: 'cm_bad', args: { kind: 'meteor' } })], 1, pipe);
    expect(garbage.outcomes[0]?.code).toBe('invalid_args');
    expect(state.blobs.treasury).toBeUndefined();
  });

  it('drops the effect once at untilTick and does not emit treasuryEffectEnded again', () => {
    const state = planet('w22-end');
    const pipe = pipeline();
    const until = 50;
    const started = step(state, [shieldCmd(until)], 1, pipe);
    expect(started.events.map((event) => event.kind)).toEqual(['treasuryEffectStarted']);
    expect(readTreasury(state).effects.meteor_shield?.untilTick).toBe(until);

    const before = step(state, [], until - 1 - state.meta.tick, pipe);
    expect(before.events.filter((event) => event.kind === 'treasuryEffectEnded')).toEqual([]);
    expect(readTreasury(state).effects.meteor_shield).toBeDefined();

    const ended = step(state, [], 1, pipe);
    expect(state.meta.tick).toBe(until);
    const endings = ended.events.filter((event) => event.kind === 'treasuryEffectEnded');
    expect(endings).toEqual([
      expect.objectContaining({
        atTick: until,
        data: { planetId: 'pl_w22', kind: 'meteor_shield', atTick: until },
      }),
    ]);
    expect(readTreasury(state).effects.meteor_shield).toBeUndefined();

    const again = step(state, [], 1, pipe);
    expect(again.events.filter((event) => event.kind === 'treasuryEffectEnded')).toEqual([]);
  });

  it('refreshes untilTick when the same kind is applied again', () => {
    const state = planet('w22-refresh');
    const pipe = pipeline();
    step(state, [shieldCmd(100, { commandId: 'cm_a' })], 1, pipe);
    const again = step(state, [shieldCmd(500, { commandId: 'cm_b' })], 1, pipe);
    expect(again.outcomes[0]?.code).toBeUndefined();
    expect(readTreasury(state).effects.meteor_shield).toMatchObject({ untilTick: 500, magnitudeBp: 7500 });
    const early = step(state, [], 100 - state.meta.tick, pipe);
    expect(early.events.filter((event) => event.kind === 'treasuryEffectEnded')).toEqual([]);
    expect(readTreasury(state).effects.meteor_shield?.untilTick).toBe(500);
  });

  it('leaves the hazard system out of the registry when W22 is off', () => {
    const on = createEngineConfig({ flags: parseWaves('..22') });
    const off = createEngineConfig({ flags: parseWaves('..21') });
    expect(on.systems.some((system) => system.id === 'treasury.hazards' && system.slot === 2)).toBe(true);
    expect(off.systems.some((system) => system.id === 'treasury.hazards')).toBe(false);

    const state = planet('w22-off');
    const res = step(state, [shieldCmd(SHIELD_UNTIL)], 1, createRegistryPipeline({ flags: parseWaves('..21') }));
    expect(res.outcomes[0]?.code).toBe('wave_disabled');
    expect(state.blobs.treasury).toBeUndefined();
  });
});
