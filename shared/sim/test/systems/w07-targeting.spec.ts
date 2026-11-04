import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { compileData } from '../../src/data';
import { ENTITY_KIND, ENTITY_STATE } from '../../src/ecs/columns';
import { placeSpawnedEntity } from '../../src/ecs/placement';
import { insertRow } from '../../src/ecs/store';
import { createState, setBlob, type PlanetState } from '../../src/kernel/state';
import { setEntityCombatLayer } from '../../src/systems/combat/layers';
import {
  acquireClosestTargetEntityId,
  acquireClosestTargetInRange,
  isHostileTargetForAttacker,
  isTargetInsideMinRange,
  pickMinRangeBackoffNeighbor,
  resolveAttackerWeaponRow,
} from '../../src/systems/combat/targeting';
import { updateColonyVisionCache } from '../../src/systems/combat/vision';

const data = compileData(parseWaves('..07'));

function spawnTestEntity(
  state: PlanetState,
  opts: {
    kind: number;
    owner: number;
    q: number;
    r: number;
    hp?: number;
    entityState?: number;
  },
): number {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, state.meta.tick);
  const cols = state.entities.cols;
  cols.kind[row] = opts.kind;
  cols.owner[row] = opts.owner;
  cols.hp[row] = opts.hp ?? 100;
  cols.hpMax[row] = opts.hp ?? 100;
  cols.state[row] = opts.entityState ?? ENTITY_STATE.active;
  placeSpawnedEntity(state.entities, row, opts.q, opts.r, state.meta.tick);
  return row;
}

describe('W07-09: Artillery minRange enforcement acceptance check', () => {
  it('Artillery skips target at dist 3 (< minRange 4) and fires on target at dist 4', () => {
    const state = createState({
      planetId: 'p-w07-09-artillery',
      planetType: 'temperate',
      seed: 'artillery-min-range',
      radius: 16,
    });

    const attackerRow = spawnTestEntity(state, {
      kind: ENTITY_KIND.recon,
      owner: 0,
      q: 0,
      r: 0,
    });

    const targetDist3Row = spawnTestEntity(state, {
      kind: ENTITY_KIND.blackAnt,
      owner: -1,
      q: 3,
      r: 0,
    });

    const artilleryOpts = {
      weaponId: 'artilleryShell',
      minRange: 4,
      maxRange: 10,
      data,
    };

    expect(acquireClosestTargetInRange(state, attackerRow, artilleryOpts)).toBe(-1);
    expect(acquireClosestTargetEntityId(state, attackerRow, artilleryOpts)).toBeNull();
    expect(isTargetInsideMinRange(state, attackerRow, targetDist3Row, artilleryOpts)).toBe(true);

    const backoff = pickMinRangeBackoffNeighbor(state, attackerRow, targetDist3Row);
    expect(backoff).not.toBeNull();

    const targetDist4Row = spawnTestEntity(state, {
      kind: ENTITY_KIND.blueBeetle,
      owner: -1,
      q: 4,
      r: 0,
    });

    const acquiredRow = acquireClosestTargetInRange(state, attackerRow, artilleryOpts);
    expect(acquiredRow).toBe(targetDist4Row);
    expect(acquireClosestTargetEntityId(state, attackerRow, artilleryOpts)).toBe(
      state.entities.cols.id[targetDist4Row],
    );
  });
});

describe('W07-09: Turret and HQ combat layer targeting rules', () => {
  it('Laser Tower and Autocannon target both ground and air hostiles, picking whichever is closer', () => {
    const state = createState({
      planetId: 'p-w07-09-aa-turrets',
      planetType: 'temperate',
      seed: 'aa-turrets',
      radius: 16,
    });

    const laserTowerRow = spawnTestEntity(state, {
      kind: ENTITY_KIND.laserTower,
      owner: 0,
      q: 0,
      r: 0,
    });
    const autocannonRow = spawnTestEntity(state, {
      kind: ENTITY_KIND.autocannon,
      owner: 0,
      q: 0,
      r: 1,
    });
    const airHostileRow = spawnTestEntity(state, {
      kind: ENTITY_KIND.recon,
      owner: 1,
      q: 2,
      r: 0,
    });
    setEntityCombatLayer(state, state.entities.cols.id[airHostileRow]!, 'air');

    const groundHostileRow = spawnTestEntity(state, {
      kind: ENTITY_KIND.blackAnt,
      owner: -1,
      q: 4,
      r: 0,
    });

    updateColonyVisionCache(state, 0, data, true);

    expect(acquireClosestTargetInRange(state, laserTowerRow, { data })).toBe(airHostileRow);
    expect(acquireClosestTargetInRange(state, autocannonRow, { data })).toBe(airHostileRow);

    state.entities.cols.hp[airHostileRow] = 0;
    expect(acquireClosestTargetInRange(state, laserTowerRow, { data })).toBe(groundHostileRow);
    expect(acquireClosestTargetInRange(state, autocannonRow, { data })).toBe(groundHostileRow);
  });

  it('HQ auto-turret targets ground hostiles only and skips closer air hostiles', () => {
    const state = createState({
      planetId: 'p-w07-09-hq-ground',
      planetType: 'temperate',
      seed: 'hq-ground',
      radius: 16,
    });

    const hqRow = spawnTestEntity(state, { kind: ENTITY_KIND.hq, owner: 0, q: 0, r: 0 });
    const closerAirRow = spawnTestEntity(state, { kind: ENTITY_KIND.recon, owner: 1, q: 1, r: 0 });
    setEntityCombatLayer(state, state.entities.cols.id[closerAirRow]!, 'air');
    const fartherGroundRow = spawnTestEntity(state, {
      kind: ENTITY_KIND.blackAnt,
      owner: -1,
      q: 3,
      r: 0,
    });

    updateColonyVisionCache(state, 0, data, true);

    const hqWeapon = resolveAttackerWeaponRow(state, hqRow, data);
    expect(hqWeapon).toMatchObject({ id: 'hqAutoTurret', hitsGround: true, hitsAir: false });
    expect(acquireClosestTargetInRange(state, hqRow, { data })).toBe(fartherGroundRow);

    state.entities.cols.hp[fartherGroundRow] = 0;
    expect(acquireClosestTargetInRange(state, hqRow, { data })).toBe(-1);
  });
});

describe('W07-09: Tie-breaking and sticky target retention', () => {
  it('tie-breaks equidistant hostiles by lowest entity id and keeps sticky target while valid in range', () => {
    const state = createState({
      planetId: 'p-w07-09-ties-sticky',
      planetType: 'temperate',
      seed: 'ties-sticky',
      radius: 16,
    });

    const reconRow = spawnTestEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 0, r: 0 });
    const antFirstRow = spawnTestEntity(state, {
      kind: ENTITY_KIND.blackAnt,
      owner: -1,
      q: 3,
      r: 0,
    });
    const antSecondRow = spawnTestEntity(state, {
      kind: ENTITY_KIND.blackAnt,
      owner: -1,
      q: 0,
      r: 3,
    });

    updateColonyVisionCache(state, 0, data, true);

    const firstPick = acquireClosestTargetInRange(state, reconRow, { data });
    expect(firstPick).toBe(antFirstRow);

    const closerAntRow = spawnTestEntity(state, {
      kind: ENTITY_KIND.blackAnt,
      owner: -1,
      q: 1,
      r: 0,
    });
    expect(
      acquireClosestTargetInRange(state, reconRow, { data, stickyTargetRow: antFirstRow }),
    ).toBe(antFirstRow);

    state.entities.cols.hp[antFirstRow] = 0;
    expect(
      acquireClosestTargetInRange(state, reconRow, { data, stickyTargetRow: antFirstRow }),
    ).toBe(closerAntRow);
    expect(antSecondRow).toBeGreaterThan(0);
  });
});

describe('W07-09: Passive fauna and offline turret rules', () => {
  it('skips passive fauna in auto-acquisition unless provoked/aggressive or includePassiveFauna is true', () => {
    const state = createState({
      planetId: 'p-w07-09-passive-fauna',
      planetType: 'temperate',
      seed: 'passive-fauna',
      radius: 16,
    });

    const reconRow = spawnTestEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 0, r: 0 });
    const passiveAntRow = spawnTestEntity(state, {
      kind: ENTITY_KIND.blackAnt,
      owner: -1,
      q: 2,
      r: 0,
    });
    const passiveAntId = state.entities.cols.id[passiveAntRow]!;

    setBlob(state, 'faunaMode', { byEntityId: { [passiveAntId]: 'passive' } }, 0);
    updateColonyVisionCache(state, 0, data, true);

    expect(isHostileTargetForAttacker(state, reconRow, passiveAntRow)).toBe(false);
    expect(acquireClosestTargetInRange(state, reconRow, { data })).toBe(-1);
    expect(
      acquireClosestTargetInRange(state, reconRow, { data, includePassiveFauna: true }),
    ).toBe(passiveAntRow);
  });

  it('returns -1 when a powered turret is in brownout or under construction', () => {
    const state = createState({
      planetId: 'p-w07-09-offline-turret',
      planetType: 'temperate',
      seed: 'offline-turret',
      radius: 16,
    });

    const turretRow = spawnTestEntity(state, {
      kind: ENTITY_KIND.autocannon,
      owner: 0,
      q: 0,
      r: 0,
      entityState: ENTITY_STATE.offlineBrownout,
    });
    const antRow = spawnTestEntity(state, {
      kind: ENTITY_KIND.blackAnt,
      owner: -1,
      q: 2,
      r: 0,
    });

    updateColonyVisionCache(state, 0, data, true);
    expect(acquireClosestTargetInRange(state, turretRow, { data })).toBe(-1);

    state.entities.cols.state[turretRow] = ENTITY_STATE.constructing;
    expect(acquireClosestTargetInRange(state, turretRow, { data })).toBe(-1);

    state.entities.cols.state[turretRow] = ENTITY_STATE.active;
    updateColonyVisionCache(state, 0, data, true);
    expect(acquireClosestTargetInRange(state, turretRow, { data })).toBe(antRow);
  });
});
