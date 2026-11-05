import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  BuildingLightState,
  createRegistryPipeline,
  createState,
  ENTITY_KIND,
  ENTITY_STATE,
  entityLightLevel,
  entityShouldEmitLight,
  insertRow,
  lightStateFor,
  registerLightState,
  rowOf,
  setHqCellEnergy,
  spawnHqUnit,
  SolarLightState,
  step,
  UnlitLightState,
} from '../../src';

const NIGHT = 1;
const DAY = 0;

describe('building light state (one definition of "lit")', () => {
  const hub = (state: number) => ({ kind: ENTITY_KIND.commandHub, state });

  it('night + energy -> lit; night + no energy -> unlit, for every offline state', () => {
    expect(entityLightLevel(hub(ENTITY_STATE.active), NIGHT)).toBe(1);
    expect(entityShouldEmitLight(hub(ENTITY_STATE.active), NIGHT)).toBe(true);
    for (const off of [
      ENTITY_STATE.offlineBrownout,
      ENTITY_STATE.offlineUnpowered,
      ENTITY_STATE.offlineNoGrid,
      ENTITY_STATE.offlineOverload,
      ENTITY_STATE.offlineNoFuel,
      ENTITY_STATE.inert,
    ]) {
      expect(entityLightLevel(hub(off), NIGHT)).toBe(0);
      expect(entityShouldEmitLight(hub(off), NIGHT)).toBe(false);
    }
    // a store at its cap is halted but still powered
    expect(entityLightLevel(hub(ENTITY_STATE.offlineCapped), NIGHT)).toBe(1);
  });

  it('day: the level does not depend on the hour, and nothing "emits light" by day', () => {
    expect(entityLightLevel(hub(ENTITY_STATE.active), DAY)).toBe(entityLightLevel(hub(ENTITY_STATE.active), NIGHT));
    expect(entityLightLevel(hub(ENTITY_STATE.offlineUnpowered), DAY)).toBe(0);
    expect(entityShouldEmitLight(hub(ENTITY_STATE.active), DAY)).toBe(false);
  });

  it('construction and waiting give a dim glow that grows with the build stage', () => {
    expect(entityLightLevel(hub(ENTITY_STATE.waiting), NIGHT)).toBeCloseTo(0.18);
    const a = entityLightLevel({ ...hub(ENTITY_STATE.constructing), buildStage: 0 }, NIGHT);
    const b = entityLightLevel({ ...hub(ENTITY_STATE.constructing), buildStage: 0.66 }, NIGHT);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(b).toBeLessThan(1);
  });

  it('per-kind policies: solar is dark at night, an unlit kind is always dark, subclasses register', () => {
    expect(lightStateFor(ENTITY_KIND.solar)).toBeInstanceOf(SolarLightState);
    expect(entityLightLevel({ kind: ENTITY_KIND.solar, state: ENTITY_STATE.active }, NIGHT)).toBe(0);
    expect(entityLightLevel({ kind: ENTITY_KIND.solar, state: ENTITY_STATE.active }, DAY)).toBe(1);
    expect(lightStateFor(ENTITY_KIND.metalsExtractor)).toBeInstanceOf(BuildingLightState);
    registerLightState(ENTITY_KIND.wind, new UnlitLightState());
    expect(entityLightLevel({ kind: ENTITY_KIND.wind, state: ENTITY_STATE.active }, NIGHT)).toBe(0);
    registerLightState(ENTITY_KIND.wind, new BuildingLightState());
    expect(entityLightLevel({ kind: ENTITY_KIND.wind, state: ENTITY_STATE.active }, NIGHT)).toBe(1);
  });

  it('brownout shedding by group: the shed building goes dark, the kept one stays lit (power system writes the state)', () => {
    const state = createState({ planetId: 'p1', planetType: 'temperate', seed: 'w02', radius: 8 });
    const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });
    const spawn = (kind: number, q: number, r: number, fp: number, shedGroup: number) => {
      const id = state.meta.nextEntityId++;
      const row = insertRow(state.entities, id, 0);
      const c = state.entities.cols;
      c.kind[row] = kind;
      c.owner[row] = 0;
      c.q[row] = q;
      c.r[row] = r;
      c.footprintW[row] = fp;
      c.footprintD[row] = fp;
      c.hp[row] = 500;
      c.shedGroup[row] = shedGroup;
      c.state[row] = ENTITY_STATE.active;
      return { id, row };
    };
    const hubE = spawn(ENTITY_KIND.commandHub, 0, 0, 3, 0);
    const hqId = spawnHqUnit(state, { owner: 0, q: 1, r: 0 });
    setHqCellEnergy(state, rowOf(state.entities, hqId), 0); // cell 0: the deficit goes straight to shedding
    const older = spawn(ENTITY_KIND.metalsExtractor, 2, 0, 2, 3);
    const newer = spawn(ENTITY_KIND.metalsExtractor, 0, 2, 2, 3);

    step(state, [], 1, pipeline);
    const c = state.entities.cols;
    const lvl = (e: { row: number }) => entityLightLevel({ kind: c.kind[e.row]!, state: c.state[e.row]! }, NIGHT);
    expect(c.state[newer.row]).toBe(ENTITY_STATE.offlineBrownout);
    expect(lvl(newer)).toBe(0);
    expect(lvl(older)).toBe(1);
    expect(lvl(hubE)).toBe(1);
  });
});
