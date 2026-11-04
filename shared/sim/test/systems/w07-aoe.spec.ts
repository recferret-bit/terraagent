import { describe, expect, it } from 'vitest';
import { eventDef, parseWaves } from '@terra/contracts';
import { compileData } from '../../src/data';
import { ENTITY_KIND } from '../../src/ecs/columns';
import { placeSpawnedEntity } from '../../src/ecs/placement';
import { insertRow, rowOf } from '../../src/ecs/store';
import { hexIndex } from '../../src/grid/hex';
import { PREP } from '../../src/grid/layers';
import type { StepContext } from '../../src/kernel/context';
import type { SimEvent } from '../../src/kernel/events';
import { createState, type PlanetState } from '../../src/kernel/state';
import {
  SPLASH_DAMAGE_RATIO,
  applyAoeSplashDamage,
  collectAoeSplashTargets,
} from '../../src/systems/combat/aoe';
import {
  fireProjectile,
  stepProjectileImpacts,
} from '../../src/systems/combat/projectiles';

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
  opts: { kind: number; q: number; r: number; hp?: number; owner?: number; footprintW?: number; footprintD?: number },
): { id: number; row: number } {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, state.meta.tick);
  const cols = state.entities.cols;
  cols.kind[row] = opts.kind;
  cols.owner[row] = opts.owner ?? 0;
  cols.hp[row] = opts.hp ?? 100;
  cols.hpMax[row] = opts.hp ?? 100;
  if (opts.footprintW) cols.footprintW[row] = opts.footprintW;
  if (opts.footprintD) cols.footprintD[row] = opts.footprintD;
  placeSpawnedEntity(state.entities, row, opts.q, opts.r, state.meta.tick);
  return { id, row };
}

describe('W07-04 AoE splash damage acceptance check', () => {
  it('Artillery shell hits primary for 45 and neighbors within 2 tiles for 22.5, misses friendly units', () => {
    const state = createState({ planetId: 'p_aoe_1', planetType: 'temperate', seed: 's1', radius: 12 });
    state.meta.tick = 0;

    const attacker = spawnEntity(state, { kind: ENTITY_KIND.autocannon, q: 0, r: 0, owner: 0 });
    const primary = spawnEntity(state, { kind: ENTITY_KIND.blackAnt, q: 6, r: 0, hp: 100, owner: -1 });
    const neighbor1 = spawnEntity(state, { kind: ENTITY_KIND.blackAnt, q: 7, r: 0, hp: 100, owner: -1 });
    const neighbor2 = spawnEntity(state, { kind: ENTITY_KIND.blackAnt, q: 8, r: 0, hp: 100, owner: -1 });
    const neighborFar = spawnEntity(state, { kind: ENTITY_KIND.blackAnt, q: 9, r: 0, hp: 100, owner: -1 });
    const friendly = spawnEntity(state, { kind: ENTITY_KIND.recon, q: 6, r: 1, hp: 100, owner: 0 });

    const fireCtx = makeTestContext(state, 0);
    const pending = fireProjectile(
      state,
      {
        attackerId: attacker.id,
        attackerOwner: 0,
        targetId: primary.id,
        weaponId: 'artilleryShell',
        weaponKind: 'shell',
        from: { x: 0, y: 0, q: 0, r: 0 },
        to: { x: 6, y: 0, q: 6, r: 0 },
        damage: 45,
        aoe: 2,
        speed: 6,
      },
      fireCtx.ctx,
    );

    // dist = 6 tiles, speed = 6 tiles/s (1.2 tiles/tick) -> 5 ticks -> impactTick = 5
    expect(pending.impactTick).toBe(5);

    state.meta.tick = 5;
    const impactCtx = makeTestContext(state, 5);
    const resolved = stepProjectileImpacts(state, 5, impactCtx.ctx);

    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.hit).toBe(true);
    expect(resolved[0]!.hitIds).toEqual([primary.id, neighbor1.id, neighbor2.id]);

    const cols = state.entities.cols;
    expect(cols.hp[rowOf(state.entities, primary.id)]).toBe(55); // 100 - 45
    expect(cols.hp[rowOf(state.entities, neighbor1.id)]).toBe(77.5); // 100 - 22.5
    expect(cols.hp[rowOf(state.entities, neighbor2.id)]).toBe(77.5); // 100 - 22.5
    expect(cols.hp[rowOf(state.entities, neighborFar.id)]).toBe(100); // unaffected (dist 3 > aoe 2)
    expect(cols.hp[rowOf(state.entities, friendly.id)]).toBe(100); // no friendly fire

    expect(impactCtx.events).toHaveLength(1);
    expect(impactCtx.events[0]!.kind).toBe('projectileImpact');
    expect(eventDef('projectileImpact').data.safeParse(impactCtx.events[0]!.data).success).toBe(true);
    expect(impactCtx.events[0]!.data).toMatchObject({
      attackerId: attacker.id,
      targetId: primary.id,
      damage: 45,
      aoe: 2,
      hit: true,
      hitEntityIds: [primary.id, neighbor1.id, neighbor2.id],
    });
  });
});

describe('W07-04 AoE splash damage on missed direct hit with near hostile', () => {
  it('missed direct hit still explodes at aim point and deals 22.5 splash damage to hostiles within 2 tiles', () => {
    const state = createState({ planetId: 'p_aoe_2', planetType: 'temperate', seed: 's2', radius: 12 });
    state.meta.tick = 10;

    const attacker = spawnEntity(state, { kind: ENTITY_KIND.autocannon, q: 0, r: 0, owner: 0 });
    const primary = spawnEntity(state, { kind: ENTITY_KIND.blackAnt, q: 6, r: 0, hp: 100, owner: -1 });
    const neighbor1 = spawnEntity(state, { kind: ENTITY_KIND.blackAnt, q: 7, r: 0, hp: 100, owner: -1 });
    const neighborFar = spawnEntity(state, { kind: ENTITY_KIND.blackAnt, q: 9, r: 0, hp: 100, owner: -1 });
    const friendly = spawnEntity(state, { kind: ENTITY_KIND.recon, q: 6, r: 1, hp: 100, owner: 0 });

    const fireCtx = makeTestContext(state, 10);
    const pending = fireProjectile(
      state,
      {
        attackerId: attacker.id,
        attackerOwner: 0,
        targetId: primary.id,
        weaponId: 'artilleryShell',
        weaponKind: 'shell',
        from: { x: 0, y: 0, q: 0, r: 0 },
        to: { x: 6, y: 0, q: 6, r: 0 },
        damage: 45,
        aoe: 2,
        speed: 6,
      },
      fireCtx.ctx,
    );
    expect(pending.impactTick).toBe(15);

    // Primary target moves 1 tile away to (7, -1). Hit radius is 0.3.
    // Distance from aim point (6, 0) is 1 > 0.3, so direct hit misses!
    // But distance 1 <= 2 (aoe), so primary target takes 22.5 splash damage instead of 45!
    const pRow = rowOf(state.entities, primary.id);
    state.entities.cols.q[pRow] = 7;
    state.entities.cols.r[pRow] = -1;
    state.entities.cols.x[pRow] = 7;
    state.entities.cols.y[pRow] = -1;

    state.meta.tick = 15;
    const impactCtx = makeTestContext(state, 15);
    const resolved = stepProjectileImpacts(state, 15, impactCtx.ctx);

    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.hit).toBe(true);
    // Both primary (now at dist 1) and neighbor1 (at dist 1) are hit by AoE splash!
    expect(resolved[0]!.hitIds).toContain(primary.id);
    expect(resolved[0]!.hitIds).toContain(neighbor1.id);
    expect(resolved[0]!.hitIds).not.toContain(neighborFar.id);
    expect(resolved[0]!.hitIds).not.toContain(friendly.id);

    const cols = state.entities.cols;
    expect(cols.hp[rowOf(state.entities, primary.id)]).toBe(77.5); // took 22.5 splash, not 45 direct
    expect(cols.hp[rowOf(state.entities, neighbor1.id)]).toBe(77.5); // took 22.5 splash
    expect(cols.hp[rowOf(state.entities, neighborFar.id)]).toBe(100);
    expect(cols.hp[rowOf(state.entities, friendly.id)]).toBe(100);

    expect(impactCtx.events).toHaveLength(1);
    expect(impactCtx.events[0]!.data).toMatchObject({
      hit: true,
      aimX: 6,
      aimY: 0,
      damage: 45,
      aoe: 2,
    });
  });
});

describe('W07-04 AoE splash damage when primary flees', () => {
  it('missed direct hit when primary flees far away still explodes at aim point and splashes hostiles in aoe', () => {
    const state = createState({ planetId: 'p_aoe_3', planetType: 'temperate', seed: 's3', radius: 12 });
    state.meta.tick = 20;

    const attacker = spawnEntity(state, { kind: ENTITY_KIND.autocannon, q: 0, r: 0, owner: 0 });
    const primary = spawnEntity(state, { kind: ENTITY_KIND.blackAnt, q: 6, r: 0, hp: 100, owner: -1 });
    const bystanderHostile = spawnEntity(state, { kind: ENTITY_KIND.greenSpitter, q: 7, r: 0, hp: 150, owner: -1 });

    const fireCtx = makeTestContext(state, 20);
    fireProjectile(
      state,
      {
        attackerId: attacker.id,
        targetId: primary.id,
        weaponId: 'artilleryShell',
        weaponKind: 'shell',
        damage: 45,
        aoe: 2,
        speed: 6,
      },
      fireCtx.ctx,
    );

    // Primary target completely flees to (12, 0) (outside 2-tile AoE of aim point (6, 0))
    const pRow = rowOf(state.entities, primary.id);
    state.entities.cols.q[pRow] = 12;
    state.entities.cols.r[pRow] = 0;
    state.entities.cols.x[pRow] = 12;
    state.entities.cols.y[pRow] = 0;

    state.meta.tick = 25;
    const impactCtx = makeTestContext(state, 25);
    const resolved = stepProjectileImpacts(state, 25, impactCtx.ctx);

    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.hit).toBe(true);
    expect(resolved[0]!.hitIds).toEqual([bystanderHostile.id]);

    const cols = state.entities.cols;
    expect(cols.hp[rowOf(state.entities, primary.id)]).toBe(100); // untouched
    expect(cols.hp[rowOf(state.entities, bystanderHostile.id)]).toBe(127.5); // 150 - 22.5
  });

  it('missed projectile with no hostiles anywhere near aim point explodes harmlessly with hit=false', () => {
    const state = createState({ planetId: 'p_aoe_4', planetType: 'temperate', seed: 's4', radius: 12 });
    state.meta.tick = 30;

    const attacker = spawnEntity(state, { kind: ENTITY_KIND.autocannon, q: 0, r: 0, owner: 0 });
    const primary = spawnEntity(state, { kind: ENTITY_KIND.blackAnt, q: 6, r: 0, hp: 100, owner: -1 });
    const friendly = spawnEntity(state, { kind: ENTITY_KIND.recon, q: 6, r: 1, hp: 100, owner: 0 });

    const fireCtx = makeTestContext(state, 30);
    fireProjectile(
      state,
      {
        attackerId: attacker.id,
        targetId: primary.id,
        weaponId: 'artilleryShell',
        weaponKind: 'shell',
        damage: 45,
        aoe: 2,
        speed: 6,
      },
      fireCtx.ctx,
    );

    // Primary flees to (12, 0); only friendly unit is near (6, 0)
    const pRow = rowOf(state.entities, primary.id);
    state.entities.cols.q[pRow] = 12;
    state.entities.cols.r[pRow] = 0;
    state.entities.cols.x[pRow] = 12;
    state.entities.cols.y[pRow] = 0;

    state.meta.tick = 35;
    const impactCtx = makeTestContext(state, 35);
    const resolved = stepProjectileImpacts(state, 35, impactCtx.ctx);

    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.hit).toBe(false);
    expect(resolved[0]!.hitIds).toEqual([]);
    expect(state.entities.cols.hp[rowOf(state.entities, friendly.id)]).toBe(100);

    expect(impactCtx.events).toHaveLength(1);
    expect(impactCtx.events[0]!.kind).toBe('projectileImpact');
    expect(impactCtx.events[0]!.data).toMatchObject({
      hit: false,
      aimX: 6,
      aimY: 0,
      hitEntityIds: [],
    });
  });
});

describe('W07-04 AoE splash destruction and damage pipeline integration', () => {
  it('splash kill removes unit, emits faunaKilled / unitDestroyed, and leaves building footprint Prepared', () => {
    const state = createState({ planetId: 'p_aoe_5', planetType: 'temperate', seed: 's5', radius: 12 });
    state.meta.tick = 40;

    const attacker = spawnEntity(state, { kind: ENTITY_KIND.autocannon, q: 0, r: 0, owner: 0 });
    const primary = spawnEntity(state, { kind: ENTITY_KIND.blueBeetle, q: 6, r: 0, hp: 300, owner: -1 });
    const weakBug = spawnEntity(state, { kind: ENTITY_KIND.blackAnt, q: 7, r: 0, hp: 15, owner: -1 });
    const enemyBuilding = spawnEntity(state, {
      kind: ENTITY_KIND.pylon,
      q: 6,
      r: 1,
      hp: 15,
      owner: 1,
      footprintW: 1,
      footprintD: 1,
    });

    const fireCtx = makeTestContext(state, 40);
    fireProjectile(
      state,
      {
        attackerId: attacker.id,
        targetId: primary.id,
        weaponId: 'artilleryShell',
        weaponKind: 'shell',
        damage: 45,
        aoe: 2,
        speed: 6,
      },
      fireCtx.ctx,
    );

    state.meta.tick = 45;
    const impactCtx = makeTestContext(state, 45);
    const resolved = stepProjectileImpacts(state, 45, impactCtx.ctx);

    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.hitIds).toContain(weakBug.id);
    expect(resolved[0]!.hitIds).toContain(enemyBuilding.id);

    // weakBug had 15 HP, took 22.5 splash -> destroyed
    expect(rowOf(state.entities, weakBug.id)).toBe(-1);
    // enemyBuilding had 15 HP, took 22.5 splash -> destroyed
    expect(rowOf(state.entities, enemyBuilding.id)).toBe(-1);

    // Building footprint tile at (6, 1) is now PREP.prepared!
    const idx = hexIndex(state.grid.radius).indexOf(6, 1);
    expect(state.grid.layers.prep[idx]).toBe(PREP.prepared);

    // Check destruction events fired
    const faunaEvents = impactCtx.events.filter((e) => e.kind === 'faunaKilled');
    expect(faunaEvents).toHaveLength(1);
    expect(faunaEvents[0]!.data).toMatchObject({ entityId: weakBug.id, species: 'blackAnt' });

    const bldgEvents = impactCtx.events.filter((e) => e.kind === 'buildingDestroyed');
    expect(bldgEvents).toHaveLength(1);
    expect(bldgEvents[0]!.data).toMatchObject({ entityId: enemyBuilding.id, building: 'pylon' });
  });

  it('standalone collectAoeSplashTargets and applyAoeSplashDamage behave consistently with SPLASH_DAMAGE_RATIO', () => {
    expect(SPLASH_DAMAGE_RATIO).toBe(0.5);

    const state = createState({ planetId: 'p_aoe_6', planetType: 'temperate', seed: 's6', radius: 12 });
    state.meta.tick = 50;

    const b1 = spawnEntity(state, { kind: ENTITY_KIND.blackAnt, q: 2, r: 0, hp: 100, owner: -1 });
    const b2 = spawnEntity(state, { kind: ENTITY_KIND.greenSpitter, q: 3, r: 0, hp: 100, owner: -1 });
    const friendly = spawnEntity(state, { kind: ENTITY_KIND.recon, q: 2, r: 1, hp: 100, owner: 0 });

    const targets = collectAoeSplashTargets(state, { x: 2, y: 0 }, 1.5, 0, b1.id, data);
    expect(targets).toEqual([b2.id]); // b1 is excluded, friendly is excluded, b2 is included

    const { ctx } = makeTestContext(state, 50);
    const splashed = applyAoeSplashDamage(state, { x: 2, y: 0 }, 1.5, 40, 0, {
      ctx,
      excludeEntityId: b1.id,
    });
    expect(splashed).toEqual([b2.id]);
    expect(state.entities.cols.hp[rowOf(state.entities, b2.id)]).toBe(80); // 100 - (40 * 0.5)
    expect(state.entities.cols.hp[rowOf(state.entities, friendly.id)]).toBe(100);
  });
});
