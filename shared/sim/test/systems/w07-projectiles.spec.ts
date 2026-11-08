import { describe, expect, it } from 'vitest';
import { eventDef, parseWaves } from '@terra/contracts';
import { compileData } from '../../src/data';
import { ENTITY_KIND } from '../../src/ecs/columns';
import { placeSpawnedEntity } from '../../src/ecs/placement';
import { insertRow, rowOf } from '../../src/ecs/store';
import type { StepContext } from '../../src/kernel/context';
import type { SimEvent } from '../../src/kernel/events';
import { createState, type PlanetState } from '../../src/kernel/state';
import {
  PROJECTILE_IMPACTS_BLOB,
  fireProjectile,
  getEntityHitRadius,
  getPendingProjectileImpacts,
  getProjectileImpactsBlob,
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

describe('W07-03 projectile queue scheduling and projectileFired emission', () => {
  it('fireProjectile does not add an ECS entity row, emits projectileFired with expected impactTick, and stores entry in state.blobs.projectileImpacts', () => {
    const state = createState({ planetId: 'p_proj_1', planetType: 'temperate', seed: 's1', radius: 12 });
    state.meta.tick = 10;
    const attacker = spawnEntity(state, { kind: ENTITY_KIND.autocannon, q: 0, r: 0, owner: 0 });
    const target = spawnEntity(state, { kind: ENTITY_KIND.blackAnt, q: 8, r: 0, hp: 120, owner: -1 });

    const countBefore = state.entities.count;
    const { ctx, events } = makeTestContext(state, 10);

    // 8 tiles at 4 tiles/s (0.8 tiles/tick) -> 10 ticks -> impactTick = 20
    const pending = fireProjectile(
      state,
      {
        attackerId: attacker.id,
        targetId: target.id,
        weaponId: 'artilleryShell',
        weaponKind: 'shell',
        from: { x: 0, y: 0, q: 0, r: 0 },
        to: { x: 8, y: 0, q: 8, r: 0 },
        damage: 90,
        speed: 4,
        aoe: 1.5,
      },
      ctx,
    );

    expect(state.entities.count).toBe(countBefore);
    expect(pending.impactTick).toBe(20);
    expect(pending.firedTick).toBe(10);

    const blob = getProjectileImpactsBlob(state);
    expect(state.blobs[PROJECTILE_IMPACTS_BLOB]).toBeDefined();
    expect(blob.nextProjectileId).toBe(2);
    expect(getPendingProjectileImpacts(state)).toHaveLength(1);
    expect(getPendingProjectileImpacts(state)[0]).toMatchObject({
      id: 1,
      attackerId: attacker.id,
      targetId: target.id,
      weaponKind: 'shell',
      speed: 4,
      damage: 90,
      aoe: 1.5,
      impactTick: 20,
    });

    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('projectileFired');
    expect(eventDef('projectileFired').data.safeParse(events[0]!.data).success).toBe(true);
    expect(events[0]!.data).toMatchObject({
      attackerId: attacker.id,
      targetId: target.id,
      speed: 4,
      impactTick: 20,
      aoe: 1.5,
      from: { x: 0, y: 0, q: 0, r: 0 },
      to: { x: 8, y: 0, q: 8, r: 0 },
    });
  });
});

describe('W07-03 stationary target hit vs moving target miss at impactTick', () => {
  it('firing at a stationary target hits at impactTick and deals damage', () => {
    const state = createState({ planetId: 'p_proj_2', planetType: 'temperate', seed: 's2', radius: 12 });
    state.meta.tick = 100;
    const attacker = spawnEntity(state, { kind: ENTITY_KIND.recon, q: 0, r: 0, owner: 0 });
    const target = spawnEntity(state, { kind: ENTITY_KIND.blackAnt, q: 6, r: 0, hp: 120, owner: -1 });

    const fireCtx = makeTestContext(state, 100);
    // dist = 6 tiles, speed = 6 tiles/s = 1.2 tiles/tick -> impactTick = 100 + 5 = 105
    const pending = fireProjectile(
      state,
      {
        attackerId: attacker.id,
        targetId: target.id,
        weaponId: 'reconGun',
        weaponKind: 'bullet',
        from: { x: 0, y: 0, q: 0, r: 0 },
        to: { x: 6, y: 0, q: 6, r: 0 },
        speed: 6,
        damage: 18,
      },
      fireCtx.ctx,
    );
    expect(pending.impactTick).toBe(105);

    for (let t = 101; t <= 104; t++) {
      state.meta.tick = t;
      const stepCtx = makeTestContext(state, t);
      const resolved = stepProjectileImpacts(state, t, stepCtx.ctx);
      expect(resolved).toHaveLength(0);
      expect(stepCtx.events).toHaveLength(0);
      expect(state.entities.cols.hp[rowOf(state.entities, target.id)]).toBe(120);
    }
    expect(getPendingProjectileImpacts(state)).toHaveLength(1);

    state.meta.tick = 105;
    const impactCtx = makeTestContext(state, 105);
    const resolved = stepProjectileImpacts(state, 105, impactCtx.ctx);

    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.hit).toBe(true);
    expect(resolved[0]!.hitIds).toEqual([target.id]);
    expect(state.entities.cols.hp[rowOf(state.entities, target.id)]).toBe(102);
    expect(getPendingProjectileImpacts(state)).toHaveLength(0);

    expect(impactCtx.events).toHaveLength(1);
    expect(impactCtx.events[0]!.kind).toBe('projectileImpact');
    expect(eventDef('projectileImpact').data.safeParse(impactCtx.events[0]!.data).success).toBe(true);
    expect(impactCtx.events[0]!.data).toMatchObject({
      attackerId: attacker.id,
      hit: true,
      hitIds: [target.id],
      hitEntityIds: [target.id],
      at: { x: 6, y: 0, q: 6, r: 0 },
    });
  });
});

describe('W07-03 fast moving target miss at impactTick', () => {
  it('firing at a fast target that leaves the tile before impactTick misses and deals 0 damage', () => {
    const state = createState({ planetId: 'p_proj_3', planetType: 'temperate', seed: 's3', radius: 12 });
    state.meta.tick = 50;
    const attacker = spawnEntity(state, { kind: ENTITY_KIND.autocannon, q: 0, r: 0, owner: 0 });
    const target = spawnEntity(state, { kind: ENTITY_KIND.blackAnt, q: 6, r: 0, hp: 120, owner: -1 });

    expect(getEntityHitRadius(state, target.row, data)).toBeCloseTo(0.3, 5);

    const fireCtx = makeTestContext(state, 50);
    const pending = fireProjectile(
      state,
      {
        attackerId: attacker.id,
        targetId: target.id,
        weaponId: 'spitterAcid',
        weaponKind: 'acid',
        from: { x: 0, y: 0, q: 0, r: 0 },
        to: { x: 6, y: 0, q: 6, r: 0 },
        speed: 6,
        damage: 25,
      },
      fireCtx.ctx,
    );
    expect(pending.impactTick).toBe(55);

    const tRow = rowOf(state.entities, target.id);
    state.entities.cols.q[tRow] = 8;
    state.entities.cols.r[tRow] = 0;
    state.entities.cols.x[tRow] = 8;
    state.entities.cols.y[tRow] = 0;

    state.meta.tick = 55;
    const impactCtx = makeTestContext(state, 55);
    const resolved = stepProjectileImpacts(state, 55, impactCtx.ctx);

    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.hit).toBe(false);
    expect(resolved[0]!.hitIds).toEqual([]);
    expect(state.entities.cols.hp[rowOf(state.entities, target.id)]).toBe(120);

    expect(impactCtx.events).toHaveLength(1);
    expect(impactCtx.events[0]!.kind).toBe('projectileImpact');
    expect(eventDef('projectileImpact').data.safeParse(impactCtx.events[0]!.data).success).toBe(true);
    expect(impactCtx.events[0]!.data).toMatchObject({
      attackerId: attacker.id,
      hit: false,
      hitIds: [],
      hitEntityIds: [],
      at: { x: 6, y: 0, q: 6, r: 0 },
    });
  });
});

describe('W07-03 AoE splash damage and entity hit radii', () => {
  it('applies 50% AoE splash to nearby hostiles without friendly fire and resolves hit radii', () => {
    const state = createState({ planetId: 'p_proj_4', planetType: 'temperate', seed: 's4', radius: 12 });
    state.meta.tick = 10;
    const attacker = spawnEntity(state, { kind: ENTITY_KIND.autocannon, q: 0, r: 0, owner: 0 });
    const primary = spawnEntity(state, { kind: ENTITY_KIND.blackAnt, q: 4, r: 0, hp: 120, owner: -1 });
    const neighborHostile = spawnEntity(state, { kind: ENTITY_KIND.greenSpitter, q: 5, r: 0, hp: 180, owner: -1 });
    const friendlyUnit = spawnEntity(state, { kind: ENTITY_KIND.recon, q: 4, r: 1, hp: 160, owner: 0 });
    const beetle = spawnEntity(state, { kind: ENTITY_KIND.blueBeetle, q: 10, r: 0, hp: 900, owner: -1 });
    const factory = spawnEntity(state, { kind: ENTITY_KIND.roboticsFactory, q: -4, r: 0, hp: 800, owner: 0 });

    expect(getEntityHitRadius(state, primary.row, data)).toBeCloseTo(0.3, 5);
    expect(getEntityHitRadius(state, neighborHostile.row, data)).toBeCloseTo(0.4, 5);
    expect(getEntityHitRadius(state, beetle.row, data)).toBeCloseTo(0.8, 5);
    expect(getEntityHitRadius(state, attacker.row, data)).toBeCloseTo(0.65, 5);
    expect(getEntityHitRadius(state, factory.row, data)).toBeCloseTo(1.5, 5);

    const fireCtx = makeTestContext(state, 10);
    const pending = fireProjectile(
      state,
      {
        attackerId: attacker.id,
        targetId: primary.id,
        weaponId: 'artilleryShell',
        weaponKind: 'shell',
        from: { x: 0, y: 0, q: 0, r: 0 },
        to: { x: 4, y: 0, q: 4, r: 0 },
        speed: 4,
        damage: 90,
        aoe: 1.5,
      },
      fireCtx.ctx,
    );
    expect(pending.impactTick).toBe(15);

    state.meta.tick = 15;
    const impactCtx = makeTestContext(state, 15);
    const resolved = stepProjectileImpacts(state, 15, impactCtx.ctx);

    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.hitIds).toEqual([primary.id, neighborHostile.id]);
    expect(state.entities.cols.hp[rowOf(state.entities, primary.id)]).toBe(30);
    expect(state.entities.cols.hp[rowOf(state.entities, neighborHostile.id)]).toBe(135);
    expect(state.entities.cols.hp[rowOf(state.entities, friendlyUnit.id)]).toBe(160);
  });
});
