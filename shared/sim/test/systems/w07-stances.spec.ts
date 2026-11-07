import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  adminRelocateEntity,
  createRegistryPipeline,
  createState,
  ensureColonyLedger,
  ensureColonyRecord,
  ENTITY_KIND,
  ENTITY_STATE,
  getFactoryRallyPoint,
  getUnitStance,
  getUnitStanceRecord,
  hexDistance,
  insertRow,
  placeSpawnedEntity,
  PREP,
  rowOf,
  setBlob,
  SimHost,
  spawnHqUnit,
  TERRAIN,
  type PlanetState,
  type SimCommand,
} from '../../src';

function makeW07Host(seed = 'w07-stances-seed', radius = 18) {
  const flags = parseWaves('..07');
  const pipeline = createRegistryPipeline({ flags });
  const host = new SimHost(pipeline);
  const state = createState({
    planetId: 'pl-w07-stances',
    planetType: 'temperate',
    seed,
    radius,
  });
  state.grid.layers.terrain.fill(TERRAIN.flat);
  state.grid.layers.prep.fill(PREP.wild);

  const col0 = ensureColonyLedger(ensureColonyRecord(state, 0, 0));
  col0.status = 'active';
  col0.stock['metals.t1'] = 500;

  const col1 = ensureColonyLedger(ensureColonyRecord(state, 1, 0));
  col1.status = 'active';

  host.load(state);
  return { host, state, pipeline };
}

function stepTicks(host: SimHost, count: number): void {
  for (let i = 0; i < count; i++) {
    host.step(1);
  }
}

function submitAndStep(host: SimHost, cmd: SimCommand) {
  host.submit(cmd);
  return host.step(1);
}

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
): { id: number; row: number } {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, state.meta.tick);
  const cols = state.entities.cols;
  cols.kind[row] = opts.kind;
  cols.owner[row] = opts.owner;
  cols.hp[row] = opts.hp ?? 160;
  cols.hpMax[row] = opts.hp ?? 160;
  cols.state[row] = opts.entityState ?? ENTITY_STATE.idle;
  placeSpawnedEntity(state.entities, row, opts.q, opts.r, state.meta.tick);
  return { id, row };
}

describe('W07-12 · setStance handler and stance mirroring', () => {
  it('sets Hold, Defend, and Hunt stances for single or batch entityIds, mirrors to unit views, and validates ownership', () => {
    const { host, state } = makeW07Host('w07-set-stance');
    const r1 = spawnTestEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 1, r: -1 });
    const r2 = spawnTestEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 2, r: -1 });
    const enemy = spawnTestEntity(state, { kind: ENTITY_KIND.recon, owner: 1, q: 6, r: 0 });

    setBlob(state, 'units', { [r1.id]: { entityId: r1.id, kind: 'recon', owner: 0 } }, 0);
    state.colonies[0]!.units = [{ entityId: r1.id, kind: 'recon', owner: 0 }];

    expect(getUnitStance(state, r1.id)).toBe('defend');
    expect(getUnitStanceRecord(state, r1.row)).toMatchObject({
      entityId: r1.id,
      stance: 'defend',
      anchorQ: 1,
      anchorR: -1,
    });

    const holdRes = submitAndStep(host, {
      commandId: 'stance-hold-batch',
      colonyIndex: 0,
      source: 'player',
      kind: 'setStance',
      args: { entityIds: [r1.id, r2.id], stance: 'hold' },
    });
    expect(holdRes.outcomes[0]?.code).toBeUndefined();
    expect(getUnitStance(state, r1.id)).toBe('hold');
    expect(getUnitStance(state, r2.id)).toBe('hold');

    const unitBlob = state.blobs.units?.value as Record<number, { stance?: string }>;
    expect(unitBlob[r1.id]?.stance).toBe('hold');
    const colonyUnits = state.colonies[0]!.units as Array<{ stance?: string }> | undefined;
    expect(colonyUnits?.[0]?.stance).toBe('hold');

    const huntRes = submitAndStep(host, {
      commandId: 'stance-hunt-single',
      colonyIndex: 0,
      source: 'player',
      kind: 'setStance',
      args: { entityId: r1.id, stance: 'hunt' },
    });
    expect(huntRes.outcomes[0]?.code).toBeUndefined();
    expect(getUnitStance(state, r1.id)).toBe('hunt');

    const rejectEnemy = submitAndStep(host, {
      commandId: 'stance-not-own',
      colonyIndex: 0,
      source: 'player',
      kind: 'setStance',
      args: { entityIds: [enemy.id], stance: 'defend' },
    });
    expect(rejectEnemy.outcomes[0]?.code).toBe('not_own_colony');

    const rejectUnknown = submitAndStep(host, {
      commandId: 'stance-unknown',
      colonyIndex: 0,
      source: 'player',
      kind: 'setStance',
      args: { entityIds: [9999], stance: 'defend' },
    });
    expect(rejectUnknown.outcomes[0]?.code).toBe('unknown_entity');
  });
});

describe('W07-12 · Hold stance (fire in range, no move)', () => {
  it('fires at a hostile in weapon range without moving and does not chase a hostile outside weapon range', () => {
    const { host, state } = makeW07Host('w07-hold-stance');
    const recon = spawnTestEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 0, r: 0 });
    submitAndStep(host, {
      commandId: 'set-hold',
      colonyIndex: 0,
      source: 'player',
      kind: 'setStance',
      args: { entityIds: [recon.id], stance: 'hold' },
    });

    const outOfRangeAnt = spawnTestEntity(state, {
      kind: ENTITY_KIND.blackAnt,
      owner: -1,
      q: 6,
      r: 0,
      hp: 120,
    });

    stepTicks(host, 10);
    expect(state.entities.cols.q[recon.row]).toBe(0);
    expect(state.entities.cols.r[recon.row]).toBe(0);
    expect(state.entities.cols.x[recon.row]).toBe(0);
    expect(state.entities.cols.y[recon.row]).toBe(0);
    expect(state.entities.cols.hp[outOfRangeAnt.row]).toBe(120);

    const inRangeAnt = spawnTestEntity(state, {
      kind: ENTITY_KIND.blackAnt,
      owner: -1,
      q: 3,
      r: 0,
      hp: 120,
    });

    stepTicks(host, 10);
    expect(state.entities.cols.q[recon.row]).toBe(0);
    expect(state.entities.cols.r[recon.row]).toBe(0);
    expect(state.entities.cols.x[recon.row]).toBe(0);
    expect(state.entities.cols.y[recon.row]).toBe(0);
    expect(state.entities.cols.hp[inRangeAnt.row]).toBeLessThan(120);
  });
});

describe('W07-12 Acceptance Check 1 · Defend unit chases 8 tiles then returns to anchor', () => {
  it('chases a hostile within the 8-tile leash, stops at the 8-tile boundary when the hostile flees to (12, 0), and returns to anchor (0, 0)', () => {
    const { host, state } = makeW07Host('w07-defend-leash');
    const recon = spawnTestEntity(state, {
      kind: ENTITY_KIND.recon,
      owner: 0,
      q: 0,
      r: 0,
      hp: 160,
    });
    expect(getUnitStance(state, recon.id)).toBe('defend');
    expect(getUnitStanceRecord(state, recon.row)).toMatchObject({ anchorQ: 0, anchorR: 0 });

    const hostile = spawnTestEntity(state, {
      kind: ENTITY_KIND.blueBeetle,
      owner: -1,
      q: 6,
      r: 0,
      hp: 900,
    });

    // Step 1: hostile is at (6, 0) (within 8-tile leash, outside weapon range 4); Recon chases toward it
    stepTicks(host, 4);
    expect(state.entities.cols.x[recon.row]).toBeGreaterThan(1.5);
    expect(state.entities.cols.q[recon.row]).toBeGreaterThanOrEqual(2);

    // Step 2: move the hostile out to (12, 0) (beyond the 8-tile leash from anchor (0, 0))
    adminRelocateEntity(state.entities, hostile.row, 12, 0, host.tick);

    let maxDistFromAnchor = 0;
    let reachedLeashPerimeter = false;
    for (let i = 0; i < 35; i++) {
      host.step(1);
      const d = hexDistance(0, 0, state.entities.cols.x[recon.row]!, state.entities.cols.y[recon.row]!);
      if (d > maxDistFromAnchor) maxDistFromAnchor = d;
      if (state.entities.cols.q[recon.row] === 8 && state.entities.cols.r[recon.row] === 0) {
        reachedLeashPerimeter = true;
      }
    }

    // Verify Recon chased up to the 8-tile leash boundary, never exceeded 8 tiles, and returned to (0, 0)
    expect(reachedLeashPerimeter).toBe(true);
    expect(maxDistFromAnchor).toBeLessThanOrEqual(8 + 1e-4);
    expect(state.entities.cols.q[recon.row]).toBe(0);
    expect(state.entities.cols.r[recon.row]).toBe(0);
    expect(hexDistance(0, 0, state.entities.cols.x[recon.row]!, state.entities.cols.y[recon.row]!)).toBeLessThanOrEqual(1e-3);
  });
});

describe('W07-12 Acceptance Check 2 · Hunt unit ignores passive bug', () => {
  it('ignores a passive blackAnt at (5, 0) and engages an aggressive target at (10, 0); stays idle when only passive fauna is in 15 tiles', () => {
    const { host, state } = makeW07Host('w07-hunt-passive');
    const recon = spawnTestEntity(state, {
      kind: ENTITY_KIND.recon,
      owner: 0,
      q: 0,
      r: 0,
    });
    submitAndStep(host, {
      commandId: 'set-hunt',
      colonyIndex: 0,
      source: 'player',
      kind: 'setStance',
      args: { entityIds: [recon.id], stance: 'hunt' },
    });

    const passiveAnt = spawnTestEntity(state, {
      kind: ENTITY_KIND.blackAnt,
      owner: -1,
      q: 5,
      r: 0,
      hp: 120,
    });
    setBlob(state, 'faunaMode', { byEntityId: { [passiveAnt.id]: 'passive' } }, 0);

    // With only the passive bug at (5, 0), the Hunt unit stays idle and never attacks it
    stepTicks(host, 10);
    expect(state.entities.cols.q[recon.row]).toBe(0);
    expect(state.entities.cols.r[recon.row]).toBe(0);
    expect(state.entities.cols.hp[passiveAnt.row]).toBe(120);

    // Place an aggressive/hostile target at (10, 0) (within 15-tile Hunt search radius)
    const hostileTarget = spawnTestEntity(state, {
      kind: ENTITY_KIND.blueBeetle,
      owner: -1,
      q: 10,
      r: 0,
      hp: 400,
    });

    stepTicks(host, 20);
    // Recon completely ignored the passive bug at (5, 0) and engaged the aggressive target at (10, 0)
    expect(state.entities.cols.hp[passiveAnt.row]).toBe(120);
    expect(state.entities.cols.q[recon.row]).toBeGreaterThanOrEqual(6);
    expect(state.entities.cols.hp[hostileTarget.row]).toBeLessThan(400);
  });
});

describe('W07-12 · setRally, attackMove, and attackTarget handlers', () => {
  it('handles setRally, attackMove engaging hostiles en route, and attackTarget provoking a passive bug', () => {
    const { host, state } = makeW07Host('w07-army-commands');
    const factory = spawnTestEntity(state, {
      kind: ENTITY_KIND.roboticsFactory,
      owner: 0,
      q: -3,
      r: 0,
      hp: 800,
      entityState: ENTITY_STATE.active,
    });
    const rallyRes = submitAndStep(host, {
      commandId: 'cmd-rally',
      colonyIndex: 0,
      source: 'player',
      kind: 'setRally',
      args: { producerId: factory.id, q: 4, r: -2 },
    });
    expect(rallyRes.outcomes[0]?.code).toBeUndefined();
    expect(getFactoryRallyPoint(state, 0, factory.id)).toEqual({ q: 4, r: -2 });

    const recon = spawnTestEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 0, r: 0 });
    const blockerAnt = spawnTestEntity(state, {
      kind: ENTITY_KIND.blackAnt,
      owner: -1,
      q: 4,
      r: 0,
      hp: 30,
    });
    const atkMoveRes = submitAndStep(host, {
      commandId: 'cmd-attack-move',
      colonyIndex: 0,
      source: 'player',
      kind: 'attackMove',
      args: { entityIds: [recon.id], q: 6, r: 0 },
    });
    expect(atkMoveRes.outcomes[0]?.code).toBeUndefined();

    stepTicks(host, 25);
    expect(rowOf(state.entities, blockerAnt.id)).toBe(-1);
    expect(state.entities.cols.q[recon.row]).toBe(6);
    expect(state.entities.cols.r[recon.row]).toBe(0);
    expect(getUnitStanceRecord(state, recon.row).attackMoveGoal).toBeNull();
    expect(getUnitStanceRecord(state, recon.row)).toMatchObject({ anchorQ: 6, anchorR: 0 });

    const passiveBug = spawnTestEntity(state, {
      kind: ENTITY_KIND.blackAnt,
      owner: -1,
      q: 9,
      r: 0,
      hp: 120,
    });
    setBlob(state, 'faunaMode', { byEntityId: { [passiveBug.id]: 'passive' } }, host.tick);

    const atkTargetRes = submitAndStep(host, {
      commandId: 'cmd-attack-target',
      colonyIndex: 0,
      source: 'player',
      kind: 'attackTarget',
      args: { entityIds: [recon.id], targetId: passiveBug.id },
    });
    expect(atkTargetRes.outcomes[0]?.code).toBeUndefined();

    stepTicks(host, 10);
    expect(state.entities.cols.hp[passiveBug.row]).toBeLessThan(120);
    const modeBlob = state.blobs.faunaMode?.value as { byEntityId?: Record<number, string> };
    expect(modeBlob.byEntityId?.[passiveBug.id]).toBe('aggressive');
  });
});

describe('W07-12 · stationary defense turrets and HQ auto-turret firing', () => {
  it('fires stationary defense turrets (laserTower, autocannon) and HQ auto-turret in combatSystem', () => {
    const { host, state } = makeW07Host('w07-turrets-hq');
    state.colonies[0]!.powerSupplyOverride = 100;

    spawnTestEntity(state, {
      kind: ENTITY_KIND.commandHub,
      owner: 0,
      q: 0,
      r: 0,
      hp: 1200,
      entityState: ENTITY_STATE.active,
    });
    const hqId = spawnHqUnit(state, { owner: 0, q: 1, r: 0 });
    const hqRow = rowOf(state.entities, hqId);
    expect(hqRow).toBeGreaterThanOrEqual(0);

    spawnTestEntity(state, {
      kind: ENTITY_KIND.laserTower,
      owner: 0,
      q: 0,
      r: 2,
      hp: 450,
      entityState: ENTITY_STATE.active,
    });
    spawnTestEntity(state, {
      kind: ENTITY_KIND.autocannon,
      owner: 0,
      q: 0,
      r: -2,
      hp: 450,
      entityState: ENTITY_STATE.active,
    });

    const ant = spawnTestEntity(state, {
      kind: ENTITY_KIND.blackAnt,
      owner: -1,
      q: 3,
      r: 0,
      hp: 300,
    });

    stepTicks(host, 6);
    // At the configured rates: 5 laser hits (30), 2 arrived autocannon bullets (18), 2 HQ bullets (12).
    // Tick-6 bullets are still in flight.
    expect(state.entities.cols.hp[ant.row]).toBe(240);
  });
});
