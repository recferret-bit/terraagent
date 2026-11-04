import { describe, expect, it } from 'vitest';
import { eventDef, parseWaves } from '@terra/contracts';
import { compileData, dataRow } from '../../src/data';
import { ENTITY_KIND } from '../../src/ecs/columns';
import { placeSpawnedEntity } from '../../src/ecs/placement';
import { insertRow, rowOf } from '../../src/ecs/store';
import { hexRound } from '../../src/grid/hex';
import type { StepContext } from '../../src/kernel/context';
import type { SimEvent } from '../../src/kernel/events';
import { createState, type PlanetState } from '../../src/kernel/state';
import { setEntityCombatLayer } from '../../src/systems/combat/layers';
import { fireLaserOrMelee, isLaserWeapon, resolveWeaponRow } from '../../src/systems/combat/lasers';

const data = compileData(parseWaves('..07'));

function makeTestContext(state: PlanetState, tick = state.meta.tick, dt = 1): { ctx: StepContext; events: SimEvent[] } {
  const events: SimEvent[] = [];
  const ctx: StepContext = {
    dt,
    tick,
    flags: new Set(parseWaves('..07').list),
    data,
    events,
    postings: [],
    rng: (stream) => state.rng[stream],
    newEntityId: () => state.meta.nextEntityId++,
    emit: (e) => {
      events.push({
        severity: 'info',
        colonyIds: [],
        data: {},
        ...e,
        atTick: tick,
      });
    },
    record: () => undefined,
  };
  return { ctx, events };
}

function spawnEntity(
  state: PlanetState,
  opts: { kind: number; q: number; r: number; hp?: number; owner?: number },
): { id: number; row: number } {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, state.meta.tick);
  const cols = state.entities.cols;
  cols.kind[row] = opts.kind;
  cols.owner[row] = opts.owner ?? 0;
  cols.hp[row] = opts.hp ?? 100;
  cols.hpMax[row] = opts.hp ?? 100;
  placeSpawnedEntity(state.entities, row, opts.q, opts.r, state.meta.tick);
  return { id, row };
}

describe('W07-05 laser weapon classification and aliases', () => {
  it('recognizes laserTower (pulsedLaser), antBite (mandibleBite), and beetleBite (hornGore) as laser weapons', () => {
    const laserTowerRow = dataRow(data, 'weapons', 'laserTower');
    const antBiteRow = dataRow(data, 'weapons', 'antBite');
    const beetleBiteRow = dataRow(data, 'weapons', 'beetleBite');

    expect(isLaserWeapon(laserTowerRow)).toBe(true);
    expect(isLaserWeapon(antBiteRow)).toBe(true);
    expect(isLaserWeapon(beetleBiteRow)).toBe(true);
    expect(isLaserWeapon({ kind: 'laser', damage: 35, range: 6 })).toBe(true);

    expect(isLaserWeapon(resolveWeaponRow('pulsedLaser', data))).toBe(true);
    expect(isLaserWeapon(resolveWeaponRow('mandibleBite', data))).toBe(true);
    expect(isLaserWeapon(resolveWeaponRow('hornGore', data))).toBe(true);

    expect(antBiteRow).toMatchObject({
      range: 1,
      minRange: 0,
      damage: 8,
      projSpeed: 0,
      aoe: 0,
      hitsGround: true,
      hitsAir: false,
    });
    expect(beetleBiteRow).toMatchObject({
      range: 1,
      minRange: 0,
      damage: 24,
      projSpeed: 0,
      aoe: 0,
      hitsGround: true,
      hitsAir: false,
    });

    for (const id of ['autocannon', 'reconGun', 'artilleryShell', 'tankRocket', 'spitterAcid'] as const) {
      expect(isLaserWeapon(dataRow(data, 'weapons', id))).toBe(false);
    }
    expect(isLaserWeapon(undefined)).toBe(false);
  });
});

describe('W07-05 Laser Tower instant hit on moving Recon', () => {
  it('acceptance: Laser Tower hits moving Recon every shot immediately on fire tick', () => {
    const state = createState({ planetId: 'p_laser_1', planetType: 'temperate', seed: 's1', radius: 12 });
    state.meta.tick = 0;

    const tower = spawnEntity(state, { kind: ENTITY_KIND.laserTower, q: 0, r: 0, hp: 400, owner: 0 });
    const recon = spawnEntity(state, { kind: ENTITY_KIND.recon, q: -4, r: 2, hp: 160, owner: 1 });

    // Recon moves at 3.5 tiles/s = 0.7 tiles/tick from (-4, 2) toward (4, 2) while staying inside range 6
    const speedPerTick = 0.7;
    const shotTicks = [1, 8, 16, 23];
    let expectedHp = 160;

    for (let tick = 1; tick <= 24; tick++) {
      state.meta.tick = tick;
      const rRow = rowOf(state.entities, recon.id);
      const nextX = Math.min(4, -4 + tick * speedPerTick);
      const nextY = 2;
      const [rq, rr] = hexRound(nextX, nextY);
      state.entities.cols.x[rRow] = nextX;
      state.entities.cols.y[rRow] = nextY;
      state.entities.cols.q[rRow] = rq;
      state.entities.cols.r[rRow] = rr;

      if (!shotTicks.includes(tick)) continue;
      const { ctx, events } = makeTestContext(state, tick);
      const res = fireLaserOrMelee(
        state,
        {
          attackerId: tower.id,
          targetId: recon.id,
          weaponId: 'pulsedLaser',
          weaponRow: {
            id: 'pulsedLaser',
            kind: 'laser',
            damage: 35,
            intervalS: 1.5,
            range: 6,
            minRange: 0,
            projSpeed: 0,
            aoe: 0,
            hitsGround: true,
            hitsAir: true,
          },
          damage: 35,
          range: 6,
          tick,
        },
        ctx,
      );

      expectedHp -= 35;
      expect(res).toEqual({
        hit: true,
        damageDealt: 35,
        targetId: recon.id,
        tick,
      });
      expect(state.entities.cols.hp[rowOf(state.entities, recon.id)]).toBe(expectedHp);

      expect(events).toHaveLength(2);
      const firedEv = events.find((e) => e.kind === 'projectileFired')!;
      const impactEv = events.find((e) => e.kind === 'projectileImpact')!;
      expect(eventDef('projectileFired').data.safeParse(firedEv.data).success).toBe(true);
      expect(eventDef('projectileImpact').data.safeParse(impactEv.data).success).toBe(true);
      expect(firedEv.data).toMatchObject({
        attackerId: tower.id,
        targetId: recon.id,
        weaponKind: 'laser',
        speed: 0,
        impactTick: tick,
      });
      expect(impactEv.data).toMatchObject({
        attackerId: tower.id,
        targetId: recon.id,
        weaponKind: 'laser',
        hit: true,
        hitIds: [recon.id],
        hitEntityIds: [recon.id],
        aoe: 0,
      });
    }

    expect(state.entities.cols.hp[rowOf(state.entities, recon.id)]).toBe(20);
  });
});

describe('W07-05 range-1 melee bite and HP clamping', () => {
  it('melee bite (antBite, range 1, damage 8) hits at distance 1 and misses at distance > 1 or vs air target', () => {
    const state = createState({ planetId: 'p_laser_2', planetType: 'temperate', seed: 's2', radius: 10 });
    state.meta.tick = 10;

    const ant = spawnEntity(state, { kind: ENTITY_KIND.blackAnt, q: 0, r: 0, hp: 120, owner: -1 });
    const adjTarget = spawnEntity(state, { kind: ENTITY_KIND.harvester, q: 1, r: 0, hp: 100, owner: 0 });
    const farTarget = spawnEntity(state, { kind: ENTITY_KIND.harvester, q: 2, r: 0, hp: 100, owner: 0 });

    const { ctx: hitCtx, events: hitEvents } = makeTestContext(state, 10);
    const hitRes = fireLaserOrMelee(
      state,
      { attackerId: ant.id, targetId: adjTarget.id, weaponId: 'antBite', tick: 10 },
      hitCtx,
    );

    expect(hitRes).toEqual({ hit: true, damageDealt: 8, targetId: adjTarget.id, tick: 10 });
    expect(state.entities.cols.hp[rowOf(state.entities, adjTarget.id)]).toBe(92);
    expect(hitEvents).toHaveLength(2);
    expect(hitEvents[0]!.data).toMatchObject({ weaponKind: 'laser', speed: 0, impactTick: 10 });
    expect(hitEvents[1]!.data).toMatchObject({ weaponKind: 'laser', hitIds: [adjTarget.id], aoe: 0 });

    const { ctx: missCtx, events: missEvents } = makeTestContext(state, 11);
    const missRes = fireLaserOrMelee(
      state,
      { attackerId: ant.id, targetId: farTarget.id, weaponId: 'antBite', tick: 11 },
      missCtx,
    );
    expect(missRes).toEqual({ hit: false, damageDealt: 0 });
    expect(state.entities.cols.hp[rowOf(state.entities, farTarget.id)]).toBe(100);
    expect(missEvents).toHaveLength(0);

    setEntityCombatLayer(state, adjTarget.id, 'air', 12);
    const { ctx: airCtx, events: airEvents } = makeTestContext(state, 12);
    const airRes = fireLaserOrMelee(
      state,
      { attackerId: ant.id, targetId: adjTarget.id, weaponId: 'antBite', tick: 12 },
      airCtx,
    );
    expect(airRes).toEqual({ hit: false, damageDealt: 0 });
    expect(state.entities.cols.hp[rowOf(state.entities, adjTarget.id)]).toBe(92);
    expect(airEvents).toHaveLength(0);
  });

  it('clamps HQ HP at 1 and removes non-HQ entities when laser damage reduces HP to <= 0', () => {
    const state = createState({ planetId: 'p_laser_3', planetType: 'temperate', seed: 's3', radius: 10 });
    state.meta.tick = 20;

    const beetle = spawnEntity(state, { kind: ENTITY_KIND.blueBeetle, q: 0, r: 0, hp: 900, owner: -1 });
    const hq = spawnEntity(state, { kind: ENTITY_KIND.hq, q: 1, r: 0, hp: 10, owner: 0 });
    const lowRecon = spawnEntity(state, { kind: ENTITY_KIND.recon, q: 0, r: 1, hp: 20, owner: 0 });

    const hqRes = fireLaserOrMelee(state, {
      attackerId: beetle.id,
      targetId: hq.id,
      weaponId: 'beetleBite',
      tick: 20,
    });
    expect(hqRes.hit).toBe(true);
    expect(state.entities.cols.hp[rowOf(state.entities, hq.id)]).toBe(1);

    const reconRes = fireLaserOrMelee(state, {
      attackerId: beetle.id,
      targetId: lowRecon.id,
      weaponId: 'beetleBite',
      tick: 21,
    });
    expect(reconRes.hit).toBe(true);
    expect(rowOf(state.entities, lowRecon.id)).toBe(-1);
  });
});
