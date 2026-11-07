import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  applyTunedEntityHealth, compileData, createRegistryPipeline, createState, ensureColonyLedger,
  ensureColonyRecord, ENTITY_KIND, ENTITY_STATE, getEntitySpottingRadius, getPendingProjectileImpacts, insertRow, placeSpawnedEntity, PREP, resolveAttackerWeaponRow, SimHost,
  TERRAIN, setUnitStance, spawnHiveEntity, rowOf, getFaunaHivesState, type PlanetState,
} from '../../src';
import { consumeWeaponShot, type WeaponCadence } from '../../src/systems/combat/weaponFire';
import { mobileStats } from '../../src/units/mobility';

const flags = parseWaves('..07');
function spawn(state: PlanetState, kind: number, owner: number, q: number, hp = 10000): number {
  const row = insertRow(state.entities, state.meta.nextEntityId++, 0);
  const c = state.entities.cols;
  c.kind[row] = kind; c.owner[row] = owner; c.hp[row] = hp; c.hpMax[row] = hp;
  c.state[row] = ENTITY_STATE.active;
  placeSpawnedEntity(state.entities, row, q, 0, 0);
  return row;
}
function world() {
  const state = createState({ planetId: 'combat-tune', planetType: 'temperate', seed: 'tune', radius: 12 });
  state.grid.layers.terrain.fill(TERRAIN.flat);
  state.grid.layers.prep.fill(PREP.wild);
  for (const owner of [0, 1]) ensureColonyLedger(ensureColonyRecord(state, owner, 0)).status = 'active';
  return state;
}

describe('combat respects live sight', () => {
  it.each(['hold', 'defend', 'hunt'] as const)('%s never acquires or fires outside tuned shared sight', stance => {
    const state = world();
    const shooter = spawn(state, ENTITY_KIND.recon, 0, 0);
    spawn(state, ENTITY_KIND.commandHub, 1, 5);
    const data = compileData(flags, { combatUnits: { recon: { viewRadius: 2 } }, weapons: { reconGun: { range: 9 } } });
    const host = new SimHost(createRegistryPipeline({ flags, data }));
    host.load(state);
    setUnitStance(state, state.entities.cols.id[shooter], stance, undefined, 0);
    for (let i = 0; i < 10; i++) {
      expect(host.step(1).events.filter(e => e.kind === 'projectileFired')).toHaveLength(0);
      expect(state.entities.cols.x[shooter]).toBe(0);
    }
    spawn(state, ENTITY_KIND.recon, 0, 4);
    expect(host.step(5).events.some(e => e.kind === 'projectileFired')).toBe(true);
  });

});

describe('canonical combat data', () => {
  it('movement approach and damage previews read the weapon row rather than duplicate entity stats', () => {
    const data = compileData(flags, { weapons: { reconGun: { damage: 19, ratePerS: 2.5, range: 9 } } });
    expect(mobileStats(ENTITY_KIND.recon, data)).toMatchObject({ weaponRange: 9, dps: 47.5 });
  });

  it('hive health tuning updates its public record and damage detection baseline', () => {
    const state = world();
    const base = compileData(flags);
    const id = spawnHiveEntity(state, { species: 'blackAnt', q: 6, r: 0, initialResidents: 0 }, 0, base);
    const row = rowOf(state.entities, id);
    state.entities.cols.hp[row] = 750;
    const tuned = compileData(flags, { fauna: { hiveBlackAnt: { hp: 600 } } });
    applyTunedEntityHealth(state, base, tuned);
    const fauna = getFaunaHivesState(state);
    expect(fauna.hivesById[id]).toMatchObject({ hp: 300, hpMax: 600 });
    expect(fauna.lastSeenHpByEntityId[id]).toBe(300);
  });
});

describe('live combat tuning', () => {
  it.each([[ENTITY_KIND.recon, 20], [ENTITY_KIND.autocannon, 20], [ENTITY_KIND.laserTower, 40]])(
    'kind %s fires its configured sustained rate through the production combat system', (kind, shots) => {
      const state = world();
      const shooter = spawn(state, kind, 0, 0);
      spawn(state, ENTITY_KIND.hq, 0, -2);
      spawn(state, ENTITY_KIND.commandHub, 0, -1);
      state.colonies[0]!.powerSupplyOverride = 100;
      spawn(state, ENTITY_KIND.commandHub, 1, 3);
      const host = new SimHost(createRegistryPipeline({ flags }));
      host.load(state);
      let fired = 0;
      for (let tick = 0; tick < 50; tick++) {
        fired += host.step(1).events.filter(e => e.kind === 'projectileFired' && e.data.attackerId === state.entities.cols.id[shooter]).length;
        expect(state.entities.cols.x[shooter]).toBe(0);
        expect(state.entities.cols.y[shooter]).toBe(0);
      }
      expect(fired).toBe(shots);
    },
  );

  it('a changed rate takes effect, rate zero stops fire, and idle time creates no catch-up burst', () => {
    const record: WeaponCadence = {};
    expect(consumeWeaponShot(record, { ratePerS: 2 }, 1)).toBe(true);
    expect(consumeWeaponShot(record, { ratePerS: 4 }, 2)).toBe(false);
    expect(consumeWeaponShot(record, { ratePerS: 4 }, 3)).toBe(true);
    expect(consumeWeaponShot(record, { ratePerS: 0 }, 50)).toBe(false);
    expect(consumeWeaponShot(record, { ratePerS: 2 }, 100)).toBe(true);
    expect(consumeWeaponShot(record, { ratePerS: 2 }, 101)).toBe(false);
  });

  it('slow projectile tuning reaches the actual scheduled shot', () => {
    const state = world();
    spawn(state, ENTITY_KIND.recon, 0, 0);
    spawn(state, ENTITY_KIND.commandHub, 1, 3);
    const data = compileData(flags, { weapons: { reconGun: { projSpeed: 0.5 } } });
    const host = new SimHost(createRegistryPipeline({ flags, data }));
    host.load(state);
    host.step(1);
    expect(getPendingProjectileImpacts(state)).toHaveLength(1);
    expect(getPendingProjectileImpacts(state)[0].speed).toBe(0.5);
  });

  it('health edits and reset preserve damage percentage and leave other types untouched', () => {
    const state = world();
    const recon = spawn(state, ENTITY_KIND.recon, 0, 0, 160);
    const turret = spawn(state, ENTITY_KIND.autocannon, 0, 2, 450);
    state.entities.cols.hp[recon] = 80;
    const base = compileData(flags);
    const tuned = compileData(flags, { combatUnits: { recon: { hp: 320 } } });
    applyTunedEntityHealth(state, base, tuned);
    expect(state.entities.cols.hpMax[recon]).toBe(320);
    expect(state.entities.cols.hp[recon]).toBe(160);
    expect(state.entities.cols.hp[turret]).toBe(450);
    expect(state.entities.cols.changedAt[recon]).toBe(1);
    applyTunedEntityHealth(state, tuned, base);
    expect(state.entities.cols.hp[recon]).toBe(80);
    expect(state.entities.cols.hpMax[recon]).toBe(160);
  });

  it('rejects invalid max health before changing any entities', () => {
    const state = world();
    const recon = spawn(state, ENTITY_KIND.recon, 0, 0, 160);
    const base = compileData(flags);
    const tuned = compileData(flags, { combatUnits: { recon: { hp: 0 } } });
    expect(() => applyTunedEntityHealth(state, base, tuned)).toThrow('must be positive');
    expect(state.entities.cols.hp[recon]).toBe(160);
  });

  it('armored scout uses ground paths and high tuned speed is converted exactly once', () => {
    const data = compileData(flags, { combatUnits: { recon: { speed: 10 } }, fauna: { blackAnt: { speed: 5 } } });
    expect(mobileStats(ENTITY_KIND.recon, data)).toMatchObject({ profile: 'ground', speedPerTick: 2 });
    expect(mobileStats(ENTITY_KIND.blackAnt, data)?.speedPerTick).toBe(1);
  });

  it('fauna weapon previews use the live combat fields and tuned sight radii are honored', () => {
    const state = world();
    const ant = spawn(state, ENTITY_KIND.blackAnt, -1, 3);
    const data = compileData(flags, {
      fauna: { blackAnt: { damage: 25, range: 2, attackIntervalS: 2, viewRadius: 9 } },
      combatUnits: { recon: { viewRadius: 8 } },
    });
    expect(resolveAttackerWeaponRow(state, ant, data)).toMatchObject({ damage: 25, range: 2, ratePerS: 0.5 });
    expect(getEntitySpottingRadius(ENTITY_KIND.blackAnt, data)).toBe(9);
    expect(getEntitySpottingRadius(ENTITY_KIND.recon, data)).toBe(8);
  });
});
