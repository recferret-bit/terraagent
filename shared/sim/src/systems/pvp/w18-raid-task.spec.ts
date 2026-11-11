import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { compileData } from '../../data';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { placeSpawnedEntity } from '../../ecs/placement';
import { insertRow, rowOf } from '../../ecs/store';
import { ensureColonyRecord } from '../../kernel/colonies';
import { createState, type PlanetState } from '../../kernel/state';
import { getUnitStanceRecord } from '../combat/stances';
import {
  assignRaidArmyGroup,
  getPvpState,
  getUnitGroupId,
  isRaidCombatUnitRow,
  launchColonyRaid,
  resolveRaidTargetDestination,
  selectColonyRaidUnits,
  setColonyShieldHours,
} from './index';

function addEntity(
  state: PlanetState,
  spec: { kind: number; owner: number; q: number; r: number; hp: number; state: number },
): number {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, 0);
  state.entities.cols.kind[row] = spec.kind;
  state.entities.cols.owner[row] = spec.owner;
  placeSpawnedEntity(state.entities, row, spec.q, spec.r, 0);
  state.entities.cols.hp[row] = spec.hp;
  state.entities.cols.hpMax[row] = spec.hp;
  state.entities.cols.state[row] = spec.state;
  return id;
}

function makeRaidTestState() {
  const state = createState({
    planetId: 'p_w18_raid',
    planetType: 'temperate',
    seed: 'w18-raid-seed',
    radius: 32,
  });
  const col0 = ensureColonyRecord(state, 0, 0);
  col0.id = 'col_0';
  col0.stage = 4;
  col0.sectorId = 0;

  const col1 = ensureColonyRecord(state, 1, 0);
  col1.id = 'col_1';
  col1.stage = 4;
  col1.sectorId = 0;

  addEntity(state, { kind: ENTITY_KIND.commandHub, owner: 0, q: 0, r: 0, hp: 1500, state: ENTITY_STATE.active });
  addEntity(state, { kind: ENTITY_KIND.hq, owner: 0, q: 1, r: 0, hp: 900, state: ENTITY_STATE.idle });
  addEntity(state, { kind: ENTITY_KIND.worker, owner: 0, q: -1, r: 0, hp: 160, state: ENTITY_STATE.idle });
  addEntity(state, { kind: ENTITY_KIND.commandHub, owner: 1, q: 14, r: 0, hp: 1500, state: ENTITY_STATE.active });

  return state;
}

describe('W18-02 · raid task unit selection & group assignment (positive cases)', () => {
  const data = compileData(parseWaves('..18'));

  it('selects only living mobile combat units (recons) and excludes HQ and workers', () => {
    const state = makeRaidTestState();
    const r1 = addEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 2, r: 0, hp: 220, state: ENTITY_STATE.idle });
    const r2 = addEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 2, r: 1, hp: 220, state: ENTITY_STATE.idle });

    const selected = selectColonyRaidUnits(state, 0, { data });
    expect(selected).toEqual([r1, r2]);
    expect(isRaidCombatUnitRow(state, rowOf(state.entities, r1), data)).toBe(true);
  });

  it('launches a raid, assigns a group ID to all idle combat units, and orders them toward Colony B', () => {
    const state = makeRaidTestState();
    const r1 = addEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 2, r: 0, hp: 220, state: ENTITY_STATE.idle });
    const r2 = addEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 3, r: 0, hp: 220, state: ENTITY_STATE.idle });

    const res = launchColonyRaid(state, 0, 1, undefined, { data });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.raid.groupId).toBe(1);
    expect(res.raid.unitIds).toEqual([r1, r2]);
    expect(getUnitGroupId(state, r1)).toBe(1);
    expect(getUnitGroupId(state, r2)).toBe(1);

    for (const id of [r1, r2]) {
      const row = rowOf(state.entities, id);
      expect(state.entities.cols.state[row]).toBe(ENTITY_STATE.moving);
      const stance = getUnitStanceRecord(state, row);
      expect(stance.attackMoveGoal).not.toBeNull();
      expect(stance.attackMoveGoal?.q).toBeGreaterThanOrEqual(11);
      expect(stance.attackMoveGoal?.q).toBeLessThanOrEqual(14);
    }
    expect(res.raid.currentTargetQ).toBe(14);
    expect(res.raid.currentTargetR).toBe(0);
    expect(getPvpState(state).activeRaids[res.raid.raidId]).toBeDefined();
  });
});

describe('W18-02 · raid task negative & boundary cases', () => {
  const data = compileData(parseWaves('..18'));

  it('rejects self-raid, unknown target, shielded target, and cross-sector target', () => {
    const state = makeRaidTestState();
    expect(launchColonyRaid(state, 0, 0, undefined, { data })).toEqual({
      ok: false,
      code: 'invalid_args',
    });
    expect(launchColonyRaid(state, 0, 99, undefined, { data })).toEqual({
      ok: false,
      code: 'invalid_args',
    });

    setColonyShieldHours(state, 1, 5, 0, data);
    expect(launchColonyRaid(state, 0, 1, undefined, { data })).toEqual({
      ok: false,
      code: 'raid_protected',
    });

    setColonyShieldHours(state, 1, 0, 0, data);
    state.colonies[1]!.sectorId = 2;
    expect(launchColonyRaid(state, 0, 1, undefined, { data })).toEqual({
      ok: false,
      code: 'cross_sector_disabled',
    });
  });

  it('prioritizes frontier defenses over interior structures and supports explicit group IDs', () => {
    const state = makeRaidTestState();
    const r1 = addEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 2, r: 0, hp: 220, state: ENTITY_STATE.idle });
    const turretId = addEntity(state, {
      kind: ENTITY_KIND.autocannon,
      owner: 1,
      q: 10,
      r: 0,
      hp: 650,
      state: ENTITY_STATE.active,
    });

    const dest = resolveRaidTargetDestination(state, 0, 1, [r1]);
    expect(dest).toEqual({ q: 10, r: 0, targetEntityId: turretId });

    const gid = assignRaidArmyGroup(state, 0, [r1], 4, 10);
    expect(gid).toBe(4);
    expect(getUnitGroupId(state, r1)).toBe(4);
  });
});
