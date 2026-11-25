import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createRegistryPipeline,
  createState,
  ensureColonyLedger,
  ensureColonyRecord,
  ENTITY_KIND,
  ENTITY_STATE,
  hexDistance,
  hexIndex,
  insertRow,
  isUnitKind,
  placeSpawnedEntity,
  PREP,
  restore,
  rowOf,
  setBlob,
  SimHost,
  spawnHiveSite,
  spawnHqUnit,
  TERRAIN,
  type PlanetState,
  type SimCommand,
} from '../../src';

function makeHost(seed = 'single-unit-hex-seed', radius = 16) {
  const flags = parseWaves('..07');
  const pipeline = createRegistryPipeline({ flags });
  const host = new SimHost(pipeline);
  const state = createState({
    planetId: 'pl-single-hex',
    planetType: 'temperate',
    seed,
    radius,
  });
  state.grid.layers.terrain.fill(TERRAIN.flat);
  state.grid.layers.prep.fill(PREP.wild);

  const col0 = ensureColonyLedger(ensureColonyRecord(state, 0, 0));
  col0.status = 'active';
  const col1 = ensureColonyLedger(ensureColonyRecord(state, 1, 0));
  col1.status = 'active';

  host.load(state);
  return { host, state, pipeline };
}

function submitAndStep(host: SimHost, cmd: SimCommand) {
  host.submit(cmd);
  return host.step(1);
}

function spawnUnit(state: PlanetState, kind: number, owner: number, q: number, r: number, hp = 300): number {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, state.meta.tick);
  state.entities.cols.kind[row] = kind;
  state.entities.cols.owner[row] = owner;
  state.entities.cols.hp[row] = hp;
  state.entities.cols.hpMax[row] = hp;
  state.entities.cols.state[row] = ENTITY_STATE.idle;
  placeSpawnedEntity(state.entities, row, q, r, state.meta.tick);
  return id;
}

function assertUniqueStationaryUnitHexes(state: PlanetState): void {
  const cols = state.entities.cols;
  const seen = new Map<string, number>();
  for (let row = 0; row < state.entities.count; row++) {
    if (cols.hp[row]! <= 0) continue;
    const kind = cols.kind[row]!;
    if (!isUnitKind(kind) || cols.state[row] === ENTITY_STATE.moving) continue;
    const key = `${Math.round(cols.q[row]!)},${Math.round(cols.r[row]!)}`;
    expect(seen.get(key), `duplicate stationary unit on (${key})`).toBeUndefined();
    seen.set(key, cols.id[row]!);
  }
}

describe('Single-unit-per-hexagon movement, pathfinding, and spawning', () => {
  it('routes direct moveUnit onto a friendly-occupied hex to an adjacent free standable hex while rejecting hostile unit hexes', () => {
    const { host, state } = makeHost();
    spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const mover = spawnUnit(state, ENTITY_KIND.recon, 0, 1, 0);
    const parkedAlly = spawnUnit(state, ENTITY_KIND.worker, 0, 3, 0);
    const parkedEnemy = spawnUnit(state, ENTITY_KIND.demoTank, 1, 6, 0);
    expect(parkedAlly).toBeGreaterThan(0);
    expect(parkedEnemy).toBeGreaterThan(0);

    const rEnemy = submitAndStep(host, { colonyIndex: 0, source: 'player', commandId: 'mv-enemy', kind: 'moveUnit', args: { entityId: mover, q: 6, r: 0 } });
    expect(rEnemy.outcomes[0]?.code).toBe('site_blocked');

    const rAlly = submitAndStep(host, { colonyIndex: 0, source: 'player', commandId: 'mv-ally', kind: 'moveUnit', args: { entityId: mover, q: 3, r: 0 } });
    expect(rAlly.outcomes[0]?.code).toBeUndefined();
    for (let i = 0; i < 20; i++) host.step(1);
    assertUniqueStationaryUnitHexes(state);
    const moverRow = rowOf(state.entities, mover), allyRow = rowOf(state.entities, parkedAlly);
    expect(state.entities.cols.q[allyRow]).toBe(3);
    expect(state.entities.cols.r[allyRow]).toBe(0);
    expect(hexDistance(state.entities.cols.q[moverRow]!, state.entities.cols.r[moverRow]!, 3, 0)).toBe(1);
  });

  it('re-seats a racing latecomer onto an adjacent free hex when two units target the same empty hex', () => {
    const { host, state } = makeHost();
    const u1 = spawnUnit(state, ENTITY_KIND.recon, 0, 1, 0);
    const u2 = spawnUnit(state, ENTITY_KIND.recon, 0, 0, 2);

    host.submit({ colonyIndex: 0, source: 'player', commandId: 'race-1', kind: 'moveUnit', args: { entityId: u1, q: 5, r: 0 } });
    host.submit({ colonyIndex: 0, source: 'player', commandId: 'race-2', kind: 'moveUnit', args: { entityId: u2, q: 5, r: 0 } });
    const first = host.step(1);
    expect(first.outcomes.every((o) => o.code === undefined)).toBe(true);

    for (let i = 0; i < 40; i++) host.step(1);

    const r1 = rowOf(state.entities, u1);
    const r2 = rowOf(state.entities, u2);
    expect(state.entities.cols.state[r1]).toBe(ENTITY_STATE.idle);
    expect(state.entities.cols.state[r2]).toBe(ENTITY_STATE.idle);
    const q1 = Math.round(state.entities.cols.q[r1]!), rr1 = Math.round(state.entities.cols.r[r1]!);
    const q2 = Math.round(state.entities.cols.q[r2]!), rr2 = Math.round(state.entities.cols.r[r2]!);
    expect(`${q1},${rr1}`).not.toBe(`${q2},${rr2}`);
    expect(hexDistance(q1, rr1, 5, 0)).toBeLessThanOrEqual(1);
    expect(hexDistance(q2, rr2, 5, 0)).toBeLessThanOrEqual(1);
    assertUniqueStationaryUnitHexes(state);
  });
});

describe('Single-unit-per-hexagon group march and combat stances', () => {
  it('routes moveGroup around parked outsider units and lands every squad member on a unique hex', () => {
    const { host, state } = makeHost();
    const squad = [
      spawnUnit(state, ENTITY_KIND.worker, 0, -2, 0),
      spawnUnit(state, ENTITY_KIND.worker, 0, -2, 1),
      spawnUnit(state, ENTITY_KIND.worker, 0, -1, 1),
      spawnUnit(state, ENTITY_KIND.worker, 0, -1, 0),
    ];
    const blocker = spawnUnit(state, ENTITY_KIND.demoTank, 0, 4, 0);

    const res = submitAndStep(host, {
      colonyIndex: 0,
      source: 'player',
      commandId: 'grp-1',
      kind: 'moveGroup',
      args: { entityIds: squad, q: 4, r: 0 },
    });
    expect(res.outcomes[0]?.code).toBeUndefined();

    for (let i = 0; i < 45; i++) host.step(1);

    assertUniqueStationaryUnitHexes(state);
    const blockerRow = rowOf(state.entities, blocker);
    expect(Math.round(state.entities.cols.q[blockerRow]!)).toBe(4);
    expect(Math.round(state.entities.cols.r[blockerRow]!)).toBe(0);
    for (const id of squad) {
      const r = rowOf(state.entities, id);
      const q = Math.round(state.entities.cols.q[r]!), rr = Math.round(state.entities.cols.r[r]!);
      expect(`${q},${rr}`).not.toBe('4,0');
      expect(hexDistance(q, rr, 4, 0)).toBeLessThanOrEqual(2);
    }
  });

  it('spreads 6 units across distinct hexes on attackMove and attackTarget and de-overlaps mid-transit stopUnit', () => {
    const { host, state } = makeHost();
    const attackers = [
      spawnUnit(state, ENTITY_KIND.demoTank, 0, -4, 0),
      spawnUnit(state, ENTITY_KIND.demoTank, 0, -4, 1),
      spawnUnit(state, ENTITY_KIND.demoTank, 0, -3, 1),
      spawnUnit(state, ENTITY_KIND.recon, 0, -3, 0),
      spawnUnit(state, ENTITY_KIND.recon, 0, -5, 1),
      spawnUnit(state, ENTITY_KIND.recon, 0, -5, 2),
    ];

    expect(
      submitAndStep(host, {
        colonyIndex: 0,
        source: 'player',
        commandId: 'am-1',
        kind: 'attackMove',
        args: { unitIds: attackers, q: 2, r: 0 },
      }).outcomes[0]?.code,
    ).toBeUndefined();

    for (let i = 0; i < 45; i++) host.step(1);
    assertUniqueStationaryUnitHexes(state);

    const targetBuilding = state.meta.nextEntityId++;
    const bRow = insertRow(state.entities, targetBuilding, state.meta.tick);
    state.entities.cols.kind[bRow] = ENTITY_KIND.commandHub;
    state.entities.cols.owner[bRow] = 1;
    state.entities.cols.hp[bRow] = 50000;
    state.entities.cols.hpMax[bRow] = 50000;
    state.entities.cols.state[bRow] = ENTITY_STATE.active;
    placeSpawnedEntity(state.entities, bRow, 9, 0, state.meta.tick);

    expect(
      submitAndStep(host, {
        colonyIndex: 0,
        source: 'player',
        commandId: 'at-1',
        kind: 'attackTarget',
        args: { unitIds: attackers, targetId: targetBuilding },
      }).outcomes[0]?.code,
    ).toBeUndefined();

    for (let i = 0; i < 45; i++) host.step(1);
    assertUniqueStationaryUnitHexes(state);

    const parked = spawnUnit(state, ENTITY_KIND.worker, 0, 0, -4);
    const passer = spawnUnit(state, ENTITY_KIND.recon, 0, 0, -2);
    expect(parked).toBeGreaterThan(0);
    expect(
      submitAndStep(host, { colonyIndex: 0, source: 'player', commandId: 'pass-1', kind: 'moveUnit', args: { entityId: passer, q: 0, r: -7 } })
        .outcomes[0]?.code,
    ).toBeUndefined();
    for (let i = 0; i < 12; i++) {
      host.step(1);
      const pr = rowOf(state.entities, passer);
      if (Math.round(state.entities.cols.q[pr]!) === 0 && Math.round(state.entities.cols.r[pr]!) === -4) {
        submitAndStep(host, { colonyIndex: 0, source: 'player', commandId: 'stop-1', kind: 'stopUnit', args: { entityId: passer } });
        break;
      }
    }
    for (let i = 0; i < 15; i++) host.step(1);
    assertUniqueStationaryUnitHexes(state);
  });
});

describe('Single-unit-per-hexagon spawns and snapshot/restore parity', () => {
  it('places dev.spawnunit batches, hive spawns, and snapshot/restored searches onto unique hexes', () => {
    const { host, state, pipeline } = makeHost('spawn-parity-seed');
    expect(
      submitAndStep(host, {
        colonyIndex: 0,
        source: 'dev',
        commandId: 'sp-batch',
        kind: 'dev.spawnunit',
        args: { unit: 'recon', q: 0, r: 0, count: 6, colonyIndex: 0 },
      }).outcomes[0]?.code,
    ).toBeUndefined();
    expect(
      submitAndStep(host, {
        colonyIndex: 0,
        source: 'dev',
        commandId: 'sp-repeat',
        kind: 'dev.spawnunit',
        args: { unit: 'demoTank', q: 0, r: 0, count: 2, colonyIndex: 0 },
      }).outcomes[0]?.code,
    ).toBeUndefined();

    spawnHiveSite(state, { species: 'blackAnt', q: 8, r: -4, initialResidents: 5, popCap: 6 }, state.meta.tick);
    assertUniqueStationaryUnitHexes(state);

    const ids: number[] = [];
    for (let row = 0; row < state.entities.count; row++) {
      if (state.entities.cols.owner[row] === 0) ids.push(state.entities.cols.id[row]!);
    }
    host.submit({ colonyIndex: 0, source: 'player', commandId: 'grp-snap', kind: 'moveGroup', args: { entityIds: ids, q: -5, r: 3 } });
    host.step(1);
    const snap = host.snapshot();
    const hostB = new SimHost(pipeline);
    hostB.load(restore(snap));

    for (let i = 0; i < 35; i++) {
      host.step(1);
      hostB.step(1);
    }
    assertUniqueStationaryUnitHexes(host.state);
    assertUniqueStationaryUnitHexes(hostB.state);
    for (const id of ids) {
      const ra = rowOf(host.state.entities, id);
      const rb = rowOf(hostB.state.entities, id);
      expect(hostB.state.entities.cols.q[rb]).toBe(host.state.entities.cols.q[ra]);
      expect(hostB.state.entities.cols.r[rb]).toBe(host.state.entities.cols.r[ra]);
    }
  });
});

describe('Single-unit-per-hexagon W11 Atlas bands, staggered arrivals, and 1-hex bottlenecks', () => {
  it('preserves bandGoalBlocked on W11 Atlas planets and reseats staggered in-transit exact goals', () => {
    const { host, state } = makeHost('atlas-band-and-transit', 20);
    setBlob(state, 'atlas', { sectorRadius: 48 }, 0);

    const squad = [
      spawnUnit(state, ENTITY_KIND.demoTank, 0, -4, 0),
      spawnUnit(state, ENTITY_KIND.demoTank, 0, -4, 1),
      spawnUnit(state, ENTITY_KIND.demoTank, 0, -3, 1),
      spawnUnit(state, ENTITY_KIND.recon, 0, -3, 0),
      spawnUnit(state, ENTITY_KIND.recon, 0, -5, 1),
    ];
    const enemyHub = state.meta.nextEntityId++;
    const hRow = insertRow(state.entities, enemyHub, state.meta.tick);
    state.entities.cols.kind[hRow] = ENTITY_KIND.commandHub;
    state.entities.cols.owner[hRow] = 1;
    state.entities.cols.hp[hRow] = 80000;
    state.entities.cols.hpMax[hRow] = 80000;
    state.entities.cols.state[hRow] = ENTITY_STATE.active;
    placeSpawnedEntity(state.entities, hRow, 6, 0, state.meta.tick);

    expect(
      submitAndStep(host, {
        colonyIndex: 0,
        source: 'player',
        commandId: 'atlas-atk',
        kind: 'attackTarget',
        args: { unitIds: squad, targetId: enemyHub },
      }).outcomes[0]?.code,
    ).toBeUndefined();
    for (let i = 0; i < 40; i++) host.step(1);
    assertUniqueStationaryUnitHexes(state);
    const standHexes = new Set(
      squad.map((id) => {
        const r = rowOf(state.entities, id);
        return `${Math.round(state.entities.cols.q[r]!)},${Math.round(state.entities.cols.r[r]!)}`;
      }),
    );
    expect(standHexes.size).toBe(squad.length);

    const lead = spawnUnit(state, ENTITY_KIND.worker, 0, -6, 12);
    const late = spawnUnit(state, ENTITY_KIND.recon, 0, -4, 12);
    expect(
      submitAndStep(host, { colonyIndex: 0, source: 'player', commandId: 'stagger-1', kind: 'moveUnit', args: { entityId: lead, q: 2, r: 12 } })
        .outcomes[0]?.code,
    ).toBeUndefined();
    host.step(2);
    expect(
      submitAndStep(host, { colonyIndex: 0, source: 'player', commandId: 'stagger-2', kind: 'moveUnit', args: { entityId: late, q: 2, r: 12 } })
        .outcomes[0]?.code,
    ).toBeUndefined();
    for (let i = 0; i < 55; i++) host.step(1);
    assertUniqueStationaryUnitHexes(state);
    const rLead = rowOf(state.entities, lead);
    const rLate = rowOf(state.entities, late);
    const pLead = `${state.entities.cols.q[rLead]},${state.entities.cols.r[rLead]}`;
    const pLate = `${state.entities.cols.q[rLate]},${state.entities.cols.r[rLate]}`;
    expect(pLead).not.toBe(pLate);
    expect([pLead, pLate]).toContain('2,12');
    expect(hexDistance(state.entities.cols.q[rLead]!, state.entities.cols.r[rLead]!, 2, 12)).toBeLessThanOrEqual(1);
    expect(hexDistance(state.entities.cols.q[rLate]!, state.entities.cols.r[rLate]!, 2, 12)).toBeLessThanOrEqual(1);
  });
});

describe('Single-unit-per-hexagon fast-mover arrivals and 1-hex bottlenecks', () => {
  it('prevents fast-mover 1-hex arrival overlap and routes 8 units through a 1-hex bottleneck onto unique hexes', () => {
    const { host, state } = makeHost('fast-arrival-and-choke', 18);
    const fastA = spawnUnit(state, ENTITY_KIND.recon, 0, 4, 5);
    const fastB = spawnUnit(state, ENTITY_KIND.recon, 0, 5, 4);
    host.submit({ colonyIndex: 0, source: 'player', commandId: 'fast-a', kind: 'moveUnit', args: { entityId: fastA, q: 5, r: 5 } });
    host.submit({ colonyIndex: 0, source: 'player', commandId: 'fast-b', kind: 'moveUnit', args: { entityId: fastB, q: 5, r: 5 } });
    for (let i = 0; i < 20; i++) host.step(1);
    assertUniqueStationaryUnitHexes(state);

    const idx = hexIndex(state.grid.radius);
    for (let r = -8; r <= 8; r++) {
      if (r === 0) continue;
      const ti = idx.indexOf(0, r);
      if (ti >= 0) state.grid.layers.terrain[ti] = TERRAIN.deep;
    }
    state.meta.pathEpoch = (state.meta.pathEpoch ?? 0) + 1;

    const column: number[] = [];
    for (let i = 0; i < 8; i++) {
      column.push(spawnUnit(state, ENTITY_KIND.recon, 0, -3 - (i % 4), Math.floor(i / 4) - 1));
    }
    expect(
      submitAndStep(host, {
        colonyIndex: 0,
        source: 'player',
        commandId: 'choke-grp',
        kind: 'moveGroup',
        args: { entityIds: column, q: 4, r: 0 },
      }).outcomes[0]?.code,
    ).toBeUndefined();
    for (let i = 0; i < 80; i++) host.step(1);
    assertUniqueStationaryUnitHexes(state);
    for (const id of column) {
      const r = rowOf(state.entities, id);
      expect(state.entities.cols.q[r]!).toBeGreaterThan(0);
    }
  });
});

describe('Single-unit-per-hexagon mobile fauna, hold/work de-overlap, and group re-anchoring', () => {
  it('prevents mobile fauna from stacking on dev.spawnunit batches or aggressive melee raids while keeping melee reachable', () => {
    const { host, state } = makeHost('fauna-no-overlap-seed', 16);
    const defender = spawnUnit(state, ENTITY_KIND.demoTank, 0, 0, 0, 5000);
    expect(defender).toBeGreaterThan(0);

    const spawnRes = submitAndStep(host, {
      colonyIndex: 0,
      source: 'dev',
      commandId: 'sp-ants',
      kind: 'dev.spawnunit',
      args: { unit: 'blackAnt', q: 4, r: 0, count: 6, mode: 'aggressive', targetColony: 0 },
    });
    expect(spawnRes.outcomes[0]?.code).toBeUndefined();
    assertUniqueStationaryUnitHexes(state);

    for (let i = 0; i < 45; i++) host.step(1);
    assertUniqueStationaryUnitHexes(state);

    const defRow = rowOf(state.entities, defender);
    expect(state.entities.cols.hp[defRow]!).toBeLessThan(5000);
    for (let row = 0; row < state.entities.count; row++) {
      if (state.entities.cols.hp[row]! <= 0 || state.entities.cols.owner[row]! >= 0) continue;
      if (!isUnitKind(state.entities.cols.kind[row]!)) continue;
      const d = hexDistance(
        Math.round(state.entities.cols.q[row]!),
        Math.round(state.entities.cols.r[row]!),
        Math.round(state.entities.cols.q[defRow]!),
        Math.round(state.entities.cols.r[defRow]!),
      );
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(2);
    }
  });
});

describe('Single-unit-per-hexagon hold/work de-overlap and group re-anchoring', () => {
  it('de-overlaps units stacked on one hex in hold or working state and re-anchors moveGroup inside memberSet', () => {
    const { host, state } = makeHost('hold-and-reanchor-seed', 16);
    const h1 = spawnUnit(state, ENTITY_KIND.demoTank, 0, 2, 2);
    const h2 = spawnUnit(state, ENTITY_KIND.recon, 0, 2, 2);
    const h3 = spawnUnit(state, ENTITY_KIND.demoArtillery, 0, 2, 2);
    expect(submitAndStep(host, { colonyIndex: 0, source: 'player', commandId: 'st-hold', kind: 'setStance', args: { unitIds: [h1, h2, h3], stance: 'hold' } }).outcomes[0]?.code).toBeUndefined();

    for (let i = 0; i < 20; i++) host.step(1);
    assertUniqueStationaryUnitHexes(state);
    const holdCoords = new Set([h1, h2, h3].map((id) => { const r = rowOf(state.entities, id); return `${Math.round(state.entities.cols.q[r]!)},${Math.round(state.entities.cols.r[r]!)}`; }));
    expect(holdCoords.size).toBe(3);

    const squad = [spawnUnit(state, ENTITY_KIND.recon, 0, -4, 0), spawnUnit(state, ENTITY_KIND.recon, 0, -3, 0), spawnUnit(state, ENTITY_KIND.recon, 0, -4, 1)];
    expect(submitAndStep(host, { colonyIndex: 0, source: 'player', commandId: 'grp-self-1', kind: 'moveGroup', args: { entityIds: squad, q: -4, r: 0 } }).outcomes[0]?.code).toBeUndefined();
    expect(submitAndStep(host, { colonyIndex: 0, source: 'player', commandId: 'grp-self-2', kind: 'moveGroup', args: { entityIds: squad, q: -4, r: 0 } }).outcomes[0]?.code).toBeUndefined();

    for (let i = 0; i < 25; i++) host.step(1);
    assertUniqueStationaryUnitHexes(state);
    const squadCoords = new Set(
      squad.map((id) => {
        const r = rowOf(state.entities, id);
        return `${Math.round(state.entities.cols.q[r]!)},${Math.round(state.entities.cols.r[r]!)}`;
      }),
    );
    expect(squadCoords.size).toBe(3);
    expect(squadCoords.has('-4,0')).toBe(true);

    // Lower-ID idle unit stacked on a higher-ID actively working unit yields the hex to the working unit
    const lowerIdle = spawnUnit(state, ENTITY_KIND.recon, 0, -8, 4);
    const higherWorking = spawnUnit(state, ENTITY_KIND.worker, 0, -8, 4);
    const hwRow = rowOf(state.entities, higherWorking);
    state.entities.cols.state[hwRow] = ENTITY_STATE.working;
    host.step(1);
    state.entities.cols.state[rowOf(state.entities, higherWorking)] = ENTITY_STATE.working;
    for (let i = 0; i < 15; i++) {
      state.entities.cols.state[rowOf(state.entities, higherWorking)] = ENTITY_STATE.working;
      host.step(1);
    }
    const liRow = rowOf(state.entities, lowerIdle);
    expect(`${state.entities.cols.q[liRow]},${state.entities.cols.r[liRow]}`).not.toBe('-8,4');
  });
});
