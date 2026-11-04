import { describe, expect, it } from 'vitest';
import { eventDef, parseWaves } from '@terra/contracts';
import {
  acquireClosestTargetInRange, adminRelocateEntity, applyAoeSplashDamage, applyDamage,
  canAttackerSpotOrFireOnTarget, canWeaponHitLayer, canWeaponHitTarget, compileData,
  createRegistryPipeline, createState, dataRow, ensureColonyLedger, ensureColonyRecord,
  ENTITY_KIND, ENTITY_STATE, fireLaserOrMelee, fireProjectile, getEntityCombatLayer,
  getEntityHitRadius, getEntitySpottingRadius, getFactoryRallyPoint, getPendingProjectileImpacts,
  getUnitCommand, getUnitStance, getUnitStanceRecord, hexDistance, hexIndex, insertRow,
  isLaserWeapon, isTargetSpottedByColony, isTileSpottedByColony, isUnitEvasive,
  pickClosestValidLayerTarget, placeSpawnedEntity, PREP, rowOf, setEntityCombatLayer,
  setEntityWeaponOverride, SimHost, spawnHiveEntity, spawnHqUnit, SPLASH_DAMAGE_RATIO,
  startBuildingConstruction, stepEvasiveUnit, stepHqSelfRepair, stepProjectileImpacts,
  TERRAIN, updateColonyVisionCache, type PlanetState, type SimEvent, type StepContext,
} from '../src';
import { runMovement } from '../src/units/movement/orchestrator';

const w07Data = compileData(parseWaves('..07'));

function makeStepCtx(state: PlanetState, tick = state.meta.tick, dt = 1): { ctx: StepContext; events: SimEvent[] } {
  state.meta.tick = tick;
  const events: SimEvent[] = [];
  const ctx: StepContext = {
    dt,
    tick,
    flags: new Set(parseWaves('..07').list),
    data: w07Data,
    events,
    postings: [],
    rng: (stream) => state.rng[stream],
    newEntityId: () => state.meta.nextEntityId++,
    emit: (e) => {
      events.push({ severity: 'info', colonyIds: [], data: {}, ...e, atTick: tick });
    },
    record: () => undefined,
  };
  return { ctx, events };
}

function makeHost(waves = '..07', seed = 'w07-combat-spec', radius = 18) {
  const flags = parseWaves(waves);
  const pipeline = createRegistryPipeline({ flags });
  const host = new SimHost(pipeline);
  const state = createState({ planetId: `pl-${seed}`, planetType: 'temperate', seed, radius });
  state.grid.layers.terrain.fill(TERRAIN.flat);
  state.grid.layers.prep.fill(PREP.wild);

  const col0 = ensureColonyLedger(ensureColonyRecord(state, 0, 0));
  col0.status = 'active';
  col0.stock['metals.t1'] = 600;
  col0.stock['minerals.t1'] = 500;

  const col1 = ensureColonyLedger(ensureColonyRecord(state, 1, 0));
  col1.status = 'active';

  host.load(state);
  return { host, state, pipeline, data: pipeline.config.data };
}

function stepN(host: SimHost, n: number): void {
  for (let i = 0; i < n; i++) host.step(1);
}

function spawnEntity(
  state: PlanetState,
  opts: { kind: number; owner?: number; q: number; r: number; hp?: number; entityState?: number },
): { id: number; row: number } {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, state.meta.tick);
  const cols = state.entities.cols;
  cols.kind[row] = opts.kind;
  cols.owner[row] = opts.owner ?? 0;
  cols.hp[row] = opts.hp ?? 160;
  cols.hpMax[row] = opts.hp ?? 160;
  cols.state[row] = opts.entityState ?? ENTITY_STATE.active;
  placeSpawnedEntity(state.entities, row, opts.q, opts.r, state.meta.tick);
  return { id, row };
}

describe('W07-31 · Projectile impact check (arrival tick, 0.3 shell & 0.6 acid radii)', () => {
  it('calculates arrival tick from distance/speed and resolves hit vs miss for 0.3 shell radius and 0.6 acid radius', () => {
    const state = createState({ planetId: 'p-impact', planetType: 'temperate', seed: 'imp-1', radius: 14 });
    state.meta.tick = 10;
    const attacker = spawnEntity(state, { kind: ENTITY_KIND.autocannon, owner: 0, q: 0, r: 0 });
    const antHit = spawnEntity(state, { kind: ENTITY_KIND.blackAnt, owner: -1, q: 8, r: 0, hp: 120 });
    const antMiss = spawnEntity(state, { kind: ENTITY_KIND.blackAnt, owner: -1, q: 8, r: -2, hp: 120 });

    expect(getEntityHitRadius(state, antHit.row, w07Data)).toBeCloseTo(0.3, 5);

    const { ctx: fireCtx, events: fireEvents } = makeStepCtx(state, 10);
    // 8 tiles at 4 tiles/s (0.8 tiles/tick) -> 10 ticks -> impactTick = 20
    const shellHit = fireProjectile(
      state,
      { attackerId: attacker.id, targetId: antHit.id, weaponId: 'artilleryShell', weaponKind: 'shell', damage: 90, speed: 4, aoe: 0 },
      fireCtx,
    );
    const shellMiss = fireProjectile(
      state,
      { attackerId: attacker.id, targetId: antMiss.id, weaponId: 'artilleryShell', weaponKind: 'shell', damage: 90, speed: 4, aoe: 0 },
      fireCtx,
    );
    expect(shellHit.impactTick).toBe(20);
    expect(shellMiss.impactTick).toBe(20);
    expect(getPendingProjectileImpacts(state)).toHaveLength(2);
    expect(eventDef('projectileFired').data.safeParse(fireEvents[0]!.data).success).toBe(true);

    // antHit stays within 0.3 tile (dx = 0.25); antMiss leaves 0.3 tile (moves to q = 9)
    state.entities.cols.x[antHit.row] = 8.25;
    state.entities.cols.x[antMiss.row] = 9;
    state.entities.cols.q[antMiss.row] = 9;

    const { ctx: impCtx } = makeStepCtx(state, 20);
    const resolved = stepProjectileImpacts(state, 20, impCtx);
    expect(resolved).toHaveLength(2);
    expect(resolved[0]!.hit).toBe(true);
    expect(resolved[1]!.hit).toBe(false);
    expect(state.entities.cols.hp[antHit.row]).toBe(30);
    expect(state.entities.cols.hp[antMiss.row]).toBe(120);

    // Acid impact check with 0.6 tile impact radius: target within 0.6 tile hits, target outside misses
    const spitter = spawnEntity(state, { kind: ENTITY_KIND.greenSpitter, owner: -1, q: 0, r: 2 });
    const acidTargetHit = spawnEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 4, r: 2, hp: 160 });
    const acidTargetMiss = spawnEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 4, r: -2, hp: 160 });

    const { ctx: acidFireCtx } = makeStepCtx(state, 30);
    const pAcidHit = fireProjectile(
      state,
      { attackerId: spitter.id, attackerOwner: -1, targetId: acidTargetHit.id, weaponId: 'spitterAcid', weaponKind: 'acid', damage: 20, speed: 4, aoe: 0.6 },
      acidFireCtx,
    );
    const pAcidMiss = fireProjectile(
      state,
      { attackerId: spitter.id, attackerOwner: -1, targetId: acidTargetMiss.id, weaponId: 'spitterAcid', weaponKind: 'acid', damage: 20, speed: 4, aoe: 0.6 },
      acidFireCtx,
    );
    expect(pAcidHit.impactTick).toBe(35);
    expect(pAcidMiss.impactTick).toBe(35);

    // Move acidTargetHit to 0.55 tiles from aim (within 0.6); move acidTargetMiss 2 tiles away
    state.entities.cols.x[acidTargetHit.row] = 4.55;
    state.entities.cols.x[acidTargetMiss.row] = 6;
    state.entities.cols.q[acidTargetMiss.row] = 6;

    const { ctx: acidImpCtx } = makeStepCtx(state, 35);
    const acidRes = stepProjectileImpacts(state, 35, acidImpCtx);
    expect(acidRes[0]!.hit).toBe(true);
    expect(acidRes[1]!.hit).toBe(false);
    expect(state.entities.cols.hp[acidTargetHit.row]).toBeLessThan(160);
    expect(state.entities.cols.hp[acidTargetMiss.row]).toBe(160);
  });
});

describe('W07-31 · AoE splash (50% splash, 1.5 shell & 0.8 acid, miss explosion, no friendly fire)', () => {
  it('deals 50% splash within 1.5 (shell) and 0.8 (acid), explodes at (targetQ, targetR) on miss, and deals 0 friendly fire', () => {
    expect(SPLASH_DAMAGE_RATIO).toBe(0.5);
    const state = createState({ planetId: 'p-aoe', planetType: 'temperate', seed: 'aoe-1', radius: 14 });
    state.meta.tick = 0;

    const artillery = spawnEntity(state, { kind: ENTITY_KIND.demoArtillery, owner: 0, q: 0, r: 0 });
    const primary = spawnEntity(state, { kind: ENTITY_KIND.blackAnt, owner: -1, q: 6, r: 0, hp: 120 });
    const splashBug = spawnEntity(state, { kind: ENTITY_KIND.greenSpitter, owner: -1, q: 7, r: 0, hp: 180 });
    const farBug = spawnEntity(state, { kind: ENTITY_KIND.blackAnt, owner: -1, q: 9, r: 0, hp: 120 });
    const friendly = spawnEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 6, r: 1, hp: 160 });

    const { ctx: c0 } = makeStepCtx(state, 0);
    fireProjectile(
      state,
      { attackerId: artillery.id, attackerOwner: 0, targetId: primary.id, weaponId: 'artilleryShell', weaponKind: 'shell', damage: 90, speed: 6, aoe: 1.5 },
      c0,
    );
    const { ctx: c5 } = makeStepCtx(state, 5);
    const res1 = stepProjectileImpacts(state, 5, c5);
    expect(res1[0]!.hitIds).toEqual([primary.id, splashBug.id]);
    expect(state.entities.cols.hp[primary.row]).toBe(30); // 120 - 90
    expect(state.entities.cols.hp[splashBug.row]).toBe(135); // 180 - 45 (50% splash)
    expect(state.entities.cols.hp[farBug.row]).toBe(120);
    expect(state.entities.cols.hp[friendly.row]).toBe(160); // 0 friendly fire

    // Miss still explodes at aim point (targetQ=6, targetR=0) and splashes splashBug
    const { ctx: c10 } = makeStepCtx(state, 10);
    fireProjectile(
      state,
      { attackerId: artillery.id, attackerOwner: 0, targetId: primary.id, weaponId: 'artilleryShell', weaponKind: 'shell', damage: 90, speed: 6, aoe: 1.5 },
      c10,
    );
    adminRelocateEntity(state.entities, primary.row, 11, 0, 12);
    const { ctx: c15 } = makeStepCtx(state, 15);
    const resMiss = stepProjectileImpacts(state, 15, c15);
    expect(resMiss[0]!.to).toMatchObject({ q: 6, r: 0 });
    expect(resMiss[0]!.hitIds).toEqual([splashBug.id]);
    expect(state.entities.cols.hp[primary.row]).toBe(30); // fled, untouched
    expect(state.entities.cols.hp[splashBug.row]).toBe(90); // took 45 splash from aim point (6, 0)
    expect(state.entities.cols.hp[friendly.row]).toBe(160);

    // Acid 0.8 splash radius: hits enemy unit within 0.8 + radius, 0 damage to friendly fauna (owner -1)
    const { ctx: c20 } = makeStepCtx(state, 20);
    const splashedByAcid = applyAoeSplashDamage(state, { x: 6, y: 1 }, 0.8, 12, -1, { ctx: c20 });
    expect(splashedByAcid).toEqual([friendly.id]);
    expect(state.entities.cols.hp[friendly.row]).toBe(154); // 160 - 6 (50% of 12)
    expect(state.entities.cols.hp[splashBug.row]).toBe(90); // owner -1 takes 0 friendly fire
  });
});

describe('W07-31 · Instant-hit lasers (laserTower, hqAutoTurret) and range-1 melee bites (antBite, beetleBite)', () => {
  it('applies laserTower, hqAutoTurret, antBite, and beetleBite damage on the fire tick with 0 travel time', () => {
    const { host, state } = makeHost('..07', 'w07-lasers-bites');
    state.colonies[0]!.powerSupplyOverride = 100;

    expect(isLaserWeapon(dataRow(w07Data, 'weapons', 'laserTower'))).toBe(true);
    expect(isLaserWeapon(dataRow(w07Data, 'weapons', 'antBite'))).toBe(true);
    expect(isLaserWeapon(dataRow(w07Data, 'weapons', 'beetleBite'))).toBe(true);

    const tower = spawnEntity(state, { kind: ENTITY_KIND.laserTower, owner: 0, q: 0, r: 0, hp: 400 });
    const hqId = spawnHqUnit(state, { owner: 0, q: 0, r: 1 });
    const ant = spawnEntity(state, { kind: ENTITY_KIND.blackAnt, owner: -1, q: 2, r: 0, hp: 120 });
    const beetle = spawnEntity(state, { kind: ENTITY_KIND.blueBeetle, owner: -1, q: 4, r: 0, hp: 900 });
    const harv = spawnEntity(state, { kind: ENTITY_KIND.harvester, owner: 0, q: 2, r: 1, hp: 350 });

    const { ctx, events } = makeStepCtx(state, 1);
    const laserRes = fireLaserOrMelee(state, { attackerId: tower.id, targetId: ant.id, weaponId: 'laserTower', tick: 1 }, ctx);
    expect(laserRes).toEqual({ hit: true, damageDealt: 6, targetId: ant.id, tick: 1 });
    expect(state.entities.cols.hp[ant.row]).toBe(114);
    expect(events.find((e) => e.kind === 'projectileImpact')?.data).toMatchObject({ hit: true, hitEntityIds: [ant.id] });

    // Range-1 melee bites: antBite (8 dmg) and beetleBite (24 dmg) hit at dist 1, miss at dist > 1
    const biteHit = fireLaserOrMelee(state, { attackerId: ant.id, targetId: harv.id, weaponId: 'antBite', tick: 1 }, ctx);
    expect(biteHit).toEqual({ hit: true, damageDealt: 8, targetId: harv.id, tick: 1 });
    expect(state.entities.cols.hp[harv.row]).toBe(342);

    const beetleMiss = fireLaserOrMelee(state, { attackerId: beetle.id, targetId: harv.id, weaponId: 'beetleBite', tick: 1 }, ctx);
    expect(beetleMiss.hit).toBe(false);
    adminRelocateEntity(state.entities, beetle.row, 3, 1, 1); // dist 1 to harv (2, 1)
    const beetleHit = fireLaserOrMelee(state, { attackerId: beetle.id, targetId: harv.id, weaponId: 'beetleBite', tick: 1 }, ctx);
    expect(beetleHit).toEqual({ hit: true, damageDealt: 24, targetId: harv.id, tick: 1 });
    expect(state.entities.cols.hp[harv.row]).toBe(318);

    // Step combatSystem: laserTower and hqAutoTurret both fire at ant in range
    const hpBeforeStep = state.entities.cols.hp[ant.row]!;
    host.step(2);
    expect(hqId).toBeGreaterThan(0);
    expect(state.entities.cols.hp[ant.row]).toBeLessThan(hpBeforeStep);
  });
});

describe('W07-31 · Combat layers (ground | air) and hitsGround / hitsAir target filters', () => {
  it('prevents ground-only weapons from acquiring air targets while allowing autocannon and laserTower to hit air', () => {
    const state = createState({ planetId: 'p-layers', planetType: 'temperate', seed: 'lay-1', radius: 12 });
    const recon = spawnEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 0, r: 0 });
    const hq = spawnEntity(state, { kind: ENTITY_KIND.hq, owner: 0, q: 0, r: 1 });
    const autocannon = spawnEntity(state, { kind: ENTITY_KIND.autocannon, owner: 0, q: 0, r: -1 });
    const laserTower = spawnEntity(state, { kind: ENTITY_KIND.laserTower, owner: 0, q: -1, r: 0 });

    const closerAir = spawnEntity(state, { kind: ENTITY_KIND.recon, owner: 1, q: 1, r: 0, hp: 160 });
    const fartherGround = spawnEntity(state, { kind: ENTITY_KIND.blackAnt, owner: -1, q: 3, r: 0, hp: 120 });
    setEntityCombatLayer(state, closerAir.id, 'air');

    expect(getEntityCombatLayer(state, closerAir.row, w07Data)).toBe('air');
    expect(getEntityCombatLayer(state, fartherGround.row, w07Data)).toBe('ground');

    const reconGun = dataRow(w07Data, 'weapons', 'reconGun')!;
    const aaGun = dataRow(w07Data, 'weapons', 'autocannon')!;
    expect(canWeaponHitLayer(reconGun, 'air')).toBe(false);
    expect(canWeaponHitLayer(aaGun, 'air')).toBe(true);
    expect(canWeaponHitTarget(state, reconGun, closerAir.row, w07Data)).toBe(false);
    expect(canWeaponHitTarget(state, aaGun, closerAir.row, w07Data)).toBe(true);

    updateColonyVisionCache(state, 0, w07Data, true);
    expect(pickClosestValidLayerTarget(state, 0, 0, reconGun, [closerAir.row, fartherGround.row], w07Data)).toBe(fartherGround.row);
    expect(acquireClosestTargetInRange(state, recon.row, { data: w07Data })).toBe(fartherGround.row);
    expect(acquireClosestTargetInRange(state, hq.row, { data: w07Data })).toBe(fartherGround.row);
    expect(acquireClosestTargetInRange(state, autocannon.row, { data: w07Data })).toBe(closerAir.row);
    expect(acquireClosestTargetInRange(state, laserTower.row, { data: w07Data })).toBe(closerAir.row);
  });
});

describe('W07-31 · Evasive Recon Drone vs slow artilleryShell / autocannon (>= 30% miss rate over 20 shots)', () => {
  function runTwentyShots(evasive: boolean, seed: string, projSpeed = 12): { hits: number; misses: number; missRate: number } {
    const state = createState({ planetId: 'p-ev', planetType: 'temperate', seed, radius: 12 });
    state.grid.layers.terrain.fill(TERRAIN.flat);
    state.grid.layers.prep.fill(PREP.wild);
    const shooter = spawnEntity(state, { kind: ENTITY_KIND.autocannon, owner: 1, q: 0, r: 0, hp: 450 });
    const recon = spawnEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 5, r: 0, hp: 5000 });

    let fired = 0;
    let hits = 0;
    let misses = 0;
    for (let tick = 1; fired < 20 || getPendingProjectileImpacts(state).length > 0; tick++) {
      const { ctx } = makeStepCtx(state, tick);
      if (fired < 20 && (tick - 1) % 2 === 0) {
        fireProjectile(
          state,
          { attackerId: shooter.id, attackerOwner: 1, targetId: recon.id, weaponId: 'artilleryShell', weaponKind: 'shell', damage: 10, speed: projSpeed, aoe: 0 },
          ctx,
        );
        fired++;
      }
      if (evasive) {
        stepEvasiveUnit(state, recon.row, shooter.id, ctx, 5);
        runMovement(state, ctx);
      }
      for (const imp of stepProjectileImpacts(state, tick, ctx)) {
        if (imp.hit) hits++;
        else misses++;
      }
    }
    return { hits, misses, missRate: misses / (hits + misses) };
  }

  it('hits 20/20 on stationary target, misses >= 30% on evasive Recon, and reproduces deterministically from combat PRNG', () => {
    expect(isUnitEvasive(ENTITY_KIND.recon, w07Data)).toBe(true);
    expect(isUnitEvasive(ENTITY_KIND.blackAnt, w07Data)).toBe(false);

    const stationary = runTwentyShots(false, 'ev-seed-1', 12);
    expect(stationary.hits).toBe(20);
    expect(stationary.missRate).toBe(0);

    const evasiveAutoA = runTwentyShots(true, 'ev-seed-1', 12);
    const evasiveAutoB = runTwentyShots(true, 'ev-seed-1', 12);
    expect(evasiveAutoA).toEqual(evasiveAutoB);
    expect(evasiveAutoA.missRate).toBeGreaterThanOrEqual(0.3);

    const evasiveShell = runTwentyShots(true, 'ev-seed-1', 4);
    expect(evasiveShell.missRate).toBeGreaterThanOrEqual(0.8);
  });
});

describe('W07-31 · Shared colony spotting (viewRadius, 5-tick vision cache, long-range artillery spotter)', () => {
  it('updates shared colony view every 5 ticks and requires a spotter for long-range artillery at dist 12', () => {
    const state = createState({ planetId: 'p-vis', planetType: 'temperate', seed: 'vis-1', radius: 16 });
    expect(getEntitySpottingRadius(ENTITY_KIND.recon, w07Data)).toBe(10);
    expect(getEntitySpottingRadius(ENTITY_KIND.autocannon, w07Data)).toBe(5);

    const artillery = spawnEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 0, r: 0 });
    setEntityWeaponOverride(state, artillery.id, 'artilleryShell');
    // Put artillery inside a 1x1 turret's view only by using an autocannon as the sole initial unit at (-3, 0)
    adminRelocateEntity(state.entities, artillery.row, 0, 0, 0);
    state.entities.cols.kind[artillery.row] = ENTITY_KIND.autocannon; // spotting radius = 5
    const target = spawnEntity(state, { kind: ENTITY_KIND.blackAnt, owner: -1, q: 12, r: 0, hp: 120 });

    updateColonyVisionCache(state, 0, w07Data, true);
    expect(isTargetSpottedByColony(state, 0, target.row, w07Data)).toBe(false);
    expect(canAttackerSpotOrFireOnTarget(state, artillery.row, target.row, 14, w07Data)).toBe(false);
    expect(acquireClosestTargetInRange(state, artillery.row, { data: w07Data })).toBe(-1);

    // Spawn a Recon spotter at (6, 0) on tick 1 (distance 6 to target <= Recon viewRadius 10)
    spawnEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 6, r: 0 });
    state.meta.tick = 2;
    updateColonyVisionCache(state, 2, w07Data); // before 5-tick boundary -> cache not yet refreshed
    expect(isTileSpottedByColony(state, 0, 12, 0, w07Data)).toBe(false);

    state.meta.tick = 5;
    updateColonyVisionCache(state, 5, w07Data); // 5-tick cadence refresh
    expect(isTargetSpottedByColony(state, 0, target.row, w07Data)).toBe(true);
    expect(canAttackerSpotOrFireOnTarget(state, artillery.row, target.row, 14, w07Data)).toBe(true);
    expect(acquireClosestTargetInRange(state, artillery.row, { data: w07Data })).toBe(target.row);
  });
});

describe('W07-31 · Stances (Hold, Defend 8-tile leash, Hunt 15-tile search) & explicit attackTarget provocation', () => {
  it('enforces Hold no-move, Defend 8-tile leash return, Hunt 15-tile passive ignore, and explicit attackTarget hive provocation', () => {
    const { host, state, data } = makeHost('..07', 'w07-stances-all', 20);
    const recon = spawnEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 0, r: 0 });

    // 1. Hold stance: fires in range (dist 3), never moves to chase (dist 6)
    host.submit({ commandId: 's-hold', colonyIndex: 0, source: 'player', kind: 'setStance', args: { entityId: recon.id, stance: 'hold' } });
    const farBug = spawnEntity(state, { kind: ENTITY_KIND.blackAnt, owner: -1, q: 6, r: 0, hp: 120 });
    stepN(host, 8);
    expect(state.entities.cols.q[recon.row]).toBe(0);
    expect(state.entities.cols.hp[farBug.row]).toBe(120);

    // 2. Defend stance: chases within 8-tile leash, returns to anchor (0, 0) when target flees to (12, 0)
    host.submit({ commandId: 's-def', colonyIndex: 0, source: 'player', kind: 'setStance', args: { entityId: recon.id, stance: 'defend' } });
    stepN(host, 5);
    expect(state.entities.cols.x[recon.row]).toBeGreaterThan(1.0);
    adminRelocateEntity(state.entities, farBug.row, 12, 0, host.tick);
    for (let i = 0; i < 35; i++) {
      host.step(1);
      expect(hexDistance(0, 0, state.entities.cols.x[recon.row]!, state.entities.cols.y[recon.row]!)).toBeLessThanOrEqual(8 + 1e-4);
    }
    expect(state.entities.cols.q[recon.row]).toBe(0);
    expect(state.entities.cols.r[recon.row]).toBe(0);

    // 3. Hunt stance: ignores passive hive/bugs within 15 tiles, engages aggressive bug at (12, 0)
    const passiveHiveId = spawnHiveEntity(state, { species: 'blackAnt', q: 5, r: 0, initialResidents: 1 }, host.tick, data);
    host.submit({ commandId: 's-hunt', colonyIndex: 0, source: 'player', kind: 'setStance', args: { entityId: recon.id, stance: 'hunt' } });
    stepN(host, 22);
    expect(state.entities.cols.hp[rowOf(state.entities, passiveHiveId)]).toBe(1500);
    expect(state.entities.cols.hp[farBug.row]).toBeLessThan(120);

    // 4. Explicit attackTarget provokes passive hive
    host.submit({ commandId: 'atk-hive', colonyIndex: 0, source: 'player', kind: 'attackTarget', args: { entityId: recon.id, targetId: passiveHiveId } });
    stepN(host, 20);
    expect(state.entities.cols.hp[rowOf(state.entities, passiveHiveId)]).toBeLessThan(1500);
    expect((state.blobs.faunaMode?.value as { byEntityId?: Record<number, string> })?.byEntityId?.[passiveHiveId]).toBe('aggressive');
  });
});

describe('W07-31 · HP & damage core (unit death, UO-TF-04 Prepared pad, UO-HQ-03 1-HP clamp, <40% retreat, 1%/s repair)', () => {
  it('removes dead units, reverts destroyed buildings to PREP.prepared, clamps HQ at 1 HP, retreats <40% HP, and repairs at 1%/s', () => {
    const { host, state, data } = makeHost('..07', 'w07-hp-core', 16);
    const idx = hexIndex(state.grid.radius);
    for (let i = 0; i < state.grid.count; i++) {
      state.grid.layers.prep[i] = PREP.prepared;
      state.grid.layers.owner[i] = 0;
    }

    const hubRes = startBuildingConstruction(state, { owner: 0, building: 'commandHub', q: 0, r: 0, instant: true, costOverride: {}, data });
    expect(hubRes.ok).toBe(true);
    const solarRes = startBuildingConstruction(state, { owner: 0, building: 'solar', q: 4, r: 0, instant: true, costOverride: {}, data });
    expect(solarRes.ok).toBe(true);
    const solarId = solarRes.ok ? solarRes.entityId : -1;
    state.grid.layers.prep[idx.indexOf(4, 0)] = PREP.wild;

    const unit = spawnEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 2, r: 0, hp: 50 });
    expect(applyDamage(state, unit.id, 60).destroyed).toBe(true);
    expect(rowOf(state.entities, unit.id)).toBe(-1);

    expect(applyDamage(state, solarId, 999).destroyed).toBe(true);
    expect(rowOf(state.entities, solarId)).toBe(-1);
    expect(state.grid.layers.prep[idx.indexOf(4, 0)]).toBe(PREP.prepared);

    const hqId = spawnHqUnit(state, { owner: 0, q: 7, r: 0 });
    const hqRow = rowOf(state.entities, hqId);
    state.entities.cols.hp[hqRow] = 600;
    state.entities.cols.hpMax[hqRow] = 600;

    // Damage HQ to 35% (210/600) -> retreats toward Hub at (0, 0)
    const retreatRes = applyDamage(state, hqId, 390, { tick: host.tick });
    expect(retreatRes.retreatedHq).toBe(true);
    expect(getUnitCommand(state, hqId)).toMatchObject({ kind: 'move', q: 0, r: 0 });

    // Lethal damage clamps HQ at 1 HP
    const clampRes = applyDamage(state, hqId, 9999, { tick: host.tick });
    expect(clampRes.clampedHq).toBe(true);
    expect(state.entities.cols.hp[hqRow]).toBe(1);

    // Same-tick self-repair does not heal; 5 ticks (1 s) later heals 1% of 600 = +6 HP -> 7 HP
    stepHqSelfRepair(state, { tick: host.tick, dt: 1, data });
    expect(state.entities.cols.hp[hqRow]).toBe(1);
    host.step(5);
    expect(state.entities.cols.hp[hqRow]).toBeCloseTo(7, 4);
  });
});

describe('W07-31 · Wave flag disabled (..06): combat commands and combatSystem inactive', () => {
  it('excludes combatSystem and rejects setStance, setRally, attackMove, and attackTarget with wave_disabled on ..06', () => {
    const { host, state, pipeline } = makeHost('..06', 'w06-combat-disabled', 14);
    expect(pipeline.systems.some((s) => s.id === 'combat.stances')).toBe(false);

    const recon = spawnEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 0, r: 0 });
    const ant = spawnEntity(state, { kind: ENTITY_KIND.blackAnt, owner: -1, q: 2, r: 0, hp: 120 });

    host.submit({ commandId: 'c1', colonyIndex: 0, source: 'player', kind: 'setStance', args: { entityId: recon.id, stance: 'hunt' } });
    host.submit({ commandId: 'c2', colonyIndex: 0, source: 'player', kind: 'setRally', args: { q: 3, r: 0 } });
    host.submit({ commandId: 'c3', colonyIndex: 0, source: 'player', kind: 'attackMove', args: { entityId: recon.id, q: 3, r: 0 } });
    host.submit({ commandId: 'c4', colonyIndex: 0, source: 'player', kind: 'attackTarget', args: { entityId: recon.id, targetId: ant.id } });

    const res = host.step(5);
    expect(res.outcomes.map((o) => o.code)).toEqual(['wave_disabled', 'wave_disabled', 'wave_disabled', 'wave_disabled']);
    expect(state.entities.cols.hp[ant.row]).toBe(120);
    expect(state.blobs.combatVision).toBeUndefined();
    expect(getFactoryRallyPoint(state, 0)).toBeNull();
    expect(getUnitStance(state, recon.id)).toBe('defend');
    expect(getUnitStanceRecord(state, recon.row).explicitTargetId).toBeNull();
  });
});
