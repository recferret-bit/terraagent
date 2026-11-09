import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { compileData, dataRow } from '../../src/data';
import { ENTITY_KIND } from '../../src/ecs/columns';
import { placeSpawnedEntity } from '../../src/ecs/placement';
import { insertRow } from '../../src/ecs/store';
import { createState, type PlanetState } from '../../src/kernel/state';
import {
  canWeaponHitLayer,
  canWeaponHitTarget,
  getEntityCombatLayer,
  pickClosestValidLayerTarget,
  setEntityCombatLayer,
} from '../../src/systems/combat/layers';

function spawnTestEntity(
  state: PlanetState,
  opts: { kind: number; q: number; r: number; hp?: number; owner?: number },
): number {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, state.meta.tick);
  const cols = state.entities.cols;
  cols.kind[row] = opts.kind;
  cols.owner[row] = opts.owner ?? 0;
  cols.hp[row] = opts.hp ?? 100;
  cols.hpMax[row] = opts.hp ?? 100;
  placeSpawnedEntity(state.entities, row, opts.q, opts.r, state.meta.tick);
  return row;
}

describe('W07-07 combat layers and weapon flags', () => {
  const data = compileData(parseWaves('..07'));

  it('verifies compiled W07 weapon rows have expected hitsGround and hitsAir flags', () => {
    const allLayerWeapons = ['autocannon', 'laserTower'] as const;
    for (const id of allLayerWeapons) {
      const row = dataRow(data, 'weapons', id);
      expect(row).toMatchObject({ hitsGround: true, hitsAir: true });
      expect(canWeaponHitLayer(row, 'ground')).toBe(true);
      expect(canWeaponHitLayer(row, 'air')).toBe(true);
    }

    const groundOnlyWeapons = [
      'hqAutoTurret',
      'reconGun',
      'tankRocket',
      'artilleryShell',
      'antBite',
      'beetleBite',
      'spitterAcid',
    ] as const;
    for (const id of groundOnlyWeapons) {
      const row = dataRow(data, 'weapons', id);
      expect(row).toMatchObject({ hitsGround: true, hitsAir: false });
      expect(canWeaponHitLayer(row, 'ground')).toBe(true);
      expect(canWeaponHitLayer(row, 'air')).toBe(false);
    }

    expect(canWeaponHitLayer(undefined, 'ground')).toBe(false);
    expect(canWeaponHitLayer(undefined, 'air')).toBe(false);
    expect(canWeaponHitLayer({ hitsGround: false, hitsAir: true }, 'ground')).toBe(false);
    expect(canWeaponHitLayer({ hitsGround: false, hitsAir: true }, 'air')).toBe(true);
  });

  it('resolves entity combat layer from data tables and allows blob overrides', () => {
    const state = createState({ planetId: 'p_layers', planetType: 'temperate', seed: 's1', radius: 8 });
    const reconRow = spawnTestEntity(state, { kind: ENTITY_KIND.recon, q: 0, r: 0 });
    const antRow = spawnTestEntity(state, { kind: ENTITY_KIND.blackAnt, q: 1, r: 0, owner: -1 });

    expect(getEntityCombatLayer(state, reconRow, data)).toBe('ground');
    expect(getEntityCombatLayer(state, antRow, data)).toBe('ground');

    const reconId = state.entities.cols.id[reconRow]!;
    setEntityCombatLayer(state, reconId, 'air');
    expect(getEntityCombatLayer(state, reconRow, data)).toBe('air');

    setEntityCombatLayer(state, reconId, 'ground');
    expect(getEntityCombatLayer(state, reconRow, data)).toBe('ground');
  });
});

describe('W07-07 target layer filtering and closest selection', () => {
  const data = compileData(parseWaves('..07'));

  it('ground-only weapon skips air target even if closer, while AA weapon hits the closer air target', () => {
    const state = createState({ planetId: 'p_layers_2', planetType: 'temperate', seed: 's2', radius: 8 });
    const attackerRow = spawnTestEntity(state, { kind: ENTITY_KIND.recon, q: 0, r: 0, owner: 0 });
    const airTargetRow = spawnTestEntity(state, { kind: ENTITY_KIND.recon, q: 1, r: 0, owner: 1 });
    const groundTargetRow = spawnTestEntity(state, { kind: ENTITY_KIND.blackAnt, q: 2, r: 0, owner: -1 });

    setEntityCombatLayer(state, state.entities.cols.id[airTargetRow]!, 'air');

    const groundOnlyWeapon = dataRow(data, 'weapons', 'antBite');
    expect(canWeaponHitTarget(state, groundOnlyWeapon, airTargetRow, data)).toBe(false);
    expect(canWeaponHitTarget(state, groundOnlyWeapon, groundTargetRow, data)).toBe(true);

    const attackerQ = state.entities.cols.q[attackerRow]!;
    const attackerR = state.entities.cols.r[attackerRow]!;
    const candidates = [airTargetRow, groundTargetRow];

    const chosenGroundOnly = pickClosestValidLayerTarget(
      state,
      attackerQ,
      attackerR,
      groundOnlyWeapon,
      candidates,
      data,
    );
    expect(chosenGroundOnly).toBe(groundTargetRow);

    const aaWeapon = dataRow(data, 'weapons', 'autocannon');
    expect(canWeaponHitTarget(state, aaWeapon, airTargetRow, data)).toBe(true);
    const chosenAa = pickClosestValidLayerTarget(
      state,
      attackerQ,
      attackerR,
      aaWeapon,
      candidates,
      data,
    );
    expect(chosenAa).toBe(airTargetRow);
  });

  it('skips dead candidates and tie-breaks equidistant valid targets by lowest entity id', () => {
    const state = createState({ planetId: 'p_layers_3', planetType: 'temperate', seed: 's3', radius: 8 });
    const deadCloserRow = spawnTestEntity(state, { kind: ENTITY_KIND.blackAnt, q: 1, r: 0, hp: 0, owner: -1 });
    const firstTieRow = spawnTestEntity(state, { kind: ENTITY_KIND.blackAnt, q: 2, r: 0, hp: 100, owner: -1 });
    const secondTieRow = spawnTestEntity(state, { kind: ENTITY_KIND.blueBeetle, q: 0, r: 2, hp: 100, owner: -1 });

    const weapon = dataRow(data, 'weapons', 'reconGun');
    const chosen = pickClosestValidLayerTarget(
      state,
      0,
      0,
      weapon,
      [deadCloserRow, secondTieRow, firstTieRow],
      data,
    );
    expect(chosen).toBe(firstTieRow);
  });
});
