import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { compileData } from '../../data';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { insertRow } from '../../ecs/store';
import { ensureColonyRecord } from '../../kernel/colonies';
import { createState, type PlanetState } from '../../kernel/state';
import {
  acquireClosestTargetInRange,
  isHostileTargetForAttacker,
  isTargetValidInRange,
} from '../combat/targeting';
import { setColonyShieldHours } from './shield';

function addEntity(
  state: PlanetState,
  spec: {
    kind: number;
    owner: number;
    q: number;
    r: number;
    hp: number;
    state: number;
    footprintW?: number;
    footprintD?: number;
  },
): { id: number; row: number } {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, 0);
  state.entities.cols.kind[row] = spec.kind;
  state.entities.cols.owner[row] = spec.owner;
  state.entities.cols.q[row] = spec.q;
  state.entities.cols.r[row] = spec.r;
  state.entities.cols.x[row] = spec.q;
  state.entities.cols.y[row] = spec.r;
  state.entities.cols.hp[row] = spec.hp;
  state.entities.cols.hpMax[row] = spec.hp;
  state.entities.cols.state[row] = spec.state;
  if (spec.footprintW) state.entities.cols.footprintW[row] = spec.footprintW;
  if (spec.footprintD) state.entities.cols.footprintD[row] = spec.footprintD;
  return { id, row };
}

describe('W18-03 · foreign-territory targeting & footprintAttackRange unit tests', () => {
  const data = compileData(parseWaves('..18'));

  it('acquires foreign turrets and multi-tile buildings using footprintAttackRange', () => {
    const state = createState({
      planetId: 'p_w18_03_unit',
      planetType: 'temperate',
      seed: 'w18-03-unit',
      radius: 24,
    });
    const col0 = ensureColonyRecord(state, 0, 0);
    col0.stage = 4;
    const col1 = ensureColonyRecord(state, 1, 0);
    col1.stage = 4;

    const recon = addEntity(state, {
      kind: ENTITY_KIND.recon,
      owner: 0,
      q: 0,
      r: 0,
      hp: 220,
      state: ENTITY_STATE.idle,
    });
    // 3x3 Command Hub at (5, 0): center distance 5, footprintAttackRange(4, 3) = 4 + 1 = 5
    const hub = addEntity(state, {
      kind: ENTITY_KIND.commandHub,
      owner: 1,
      q: 5,
      r: 0,
      hp: 1500,
      state: ENTITY_STATE.active,
      footprintW: 3,
      footprintD: 3,
    });

    expect(isHostileTargetForAttacker(state, recon.row, hub.row, { data })).toBe(true);
    expect(isTargetValidInRange(state, recon.row, hub.row, { maxRange: 4, data })).toBe(true);
    expect(acquireClosestTargetInRange(state, recon.row, { maxRange: 4, data })).toBe(hub.row);
  });

  it('skips targets belonging to a newcomer-shielded foreign colony', () => {
    const state = createState({
      planetId: 'p_w18_03_shield',
      planetType: 'temperate',
      seed: 'w18-03-shield',
      radius: 24,
    });
    const col0 = ensureColonyRecord(state, 0, 0);
    col0.stage = 4;
    const col1 = ensureColonyRecord(state, 1, 0);
    col1.stage = 2;
    setColonyShieldHours(state, 1, 5, 0, data);

    const recon = addEntity(state, {
      kind: ENTITY_KIND.recon,
      owner: 0,
      q: 0,
      r: 0,
      hp: 220,
      state: ENTITY_STATE.idle,
    });
    const turret = addEntity(state, {
      kind: ENTITY_KIND.autocannon,
      owner: 1,
      q: 3,
      r: 0,
      hp: 650,
      state: ENTITY_STATE.active,
    });

    expect(isHostileTargetForAttacker(state, recon.row, turret.row, { data })).toBe(false);
    expect(acquireClosestTargetInRange(state, recon.row, { maxRange: 5, data })).toBe(-1);
  });
});
