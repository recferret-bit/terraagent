import { parseWaves, type SimCommandV1 } from '@terra/contracts';
import {
  createPlanet,
  hexIndex,
  isBuildablePrepared,
  placeBuildingOrder,
  PREP,
  setColonyStock,
  setTilePrep,
  setTileTerrain,
  SimHost,
  spawnHqUnit,
  spawnTerraformerUnit,
  startBuildingConstruction,
  TERRAIN,
  type SimEvent,
} from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { w01Host } from '../../../../shared/sim/test/helpers/host';
import type {
  BatchedColonyFoundedEvent,
  BatchedObstacleRemovedEvent,
  BatchedTilePreparedEvent,
} from '../../src/bus/channels';
import { EventBus } from '../../src/bus/event-bus';
import { HomeRepository } from '../../src/core/home/home.repository';
import {
  batchProgressionEventsForStep,
  ProgressionEventForwarder,
} from '../../src/game/progression-events.service';

/** Collects the batched `kind` events the forwarder publishes on `planet.event`. */
function collect<T>(bus: EventBus, kind: 'tilePrepared' | 'obstacleRemoved' | 'colonyFounded'): T[] {
  const seen: T[] = [];
  bus.onPlanetEvent(kind, (e) => seen.push(e as unknown as T), { module: 'test' });
  return seen;
}

/** Forwards every step's events of `host` (the bus bridge does the same for server planets). */
function forwardHost(host: SimHost, bus: EventBus, planetId = 'pl_test'): ProgressionEventForwarder {
  const forwarder = new ProgressionEventForwarder(bus);
  host.onEvents((events) => { forwarder.forwardStep(planetId, events); });
  return forwarder;
}

let cmdSeq = 0;
function mkCmd(kind: string, args: unknown, colonyIndex = 0): SimCommandV1 {
  return { colonyIndex, source: 'player', commandId: `cmd_${++cmdSeq}`, kind, args } as SimCommandV1;
}

/** The sim's shared W01 test host (XC-12), on this spec's seed. */
const createW01Host = (radius = 12): SimHost => w01Host({ seed: 'progression-events-test', radius });

describe('W01-31: Groundbreaker tilePrepared acceptance', () => {
  it('acceptance: prepares 9 tiles on SimHost -> sees total count of 9 across tilePrepared events on EventBus with playerId', () => {
    const bus = new EventBus();
    const host = createW01Host(12);
    const state = host.state;

    state.colonies[0] = {
      index: 0,
      id: 'col_0',
      playerId: 'pr_test1',
      name: 'Alpha Colony',
      color: 0xff6a2a,
      status: 'active',
      changedAt: 0,
    };
    spawnHqUnit(state, { owner: 0, q: 0, r: 0 });

    const seenPlanetEvents = collect<BatchedTilePreparedEvent>(bus, 'tilePrepared');
    const allPlanetEvents: unknown[] = [];
    bus.on('planet.event', (e) => allPlanetEvents.push(e), { module: 'test' });

    forwardHost(host, bus);

    const tiles = [
      { q: 0, r: 0 }, { q: 1, r: 0 }, { q: -1, r: 0 },
      { q: 0, r: 1 }, { q: 1, r: -1 }, { q: -1, r: 1 },
      { q: 0, r: -1 }, { q: 1, r: 1 }, { q: -1, r: -1 },
    ];
    host.submit(mkCmd('enqueueTask', { terraform: { op: 'grade', tiles } }, 0));

    for (let stepIdx = 0; stepIdx < 250; stepIdx++) {
      host.step(1);
      const hex = hexIndex(state.grid.radius);
      const allPrepared = tiles.every((t) => isBuildablePrepared(state.grid, hex.indexOf(t.q, t.r)));
      if (allPrepared) break;
    }

    const hex = hexIndex(state.grid.radius);
    for (const t of tiles) {
      expect(isBuildablePrepared(state.grid, hex.indexOf(t.q, t.r))).toBe(true);
    }

    expect(seenPlanetEvents.length).toBeGreaterThanOrEqual(1);
    expect(allPlanetEvents).toHaveLength(seenPlanetEvents.length); // each batch is published once, on planet.event only

    let totalCount = 0;
    for (const ev of seenPlanetEvents) {
      expect(ev.kind).toBe('tilePrepared');
      expect(ev.data.playerId).toBe('pr_test1');
      expect(ev.playerId).toBe('pr_test1');
      expect(ev.data.colonyId).toBe('col_0');
      expect(ev.colonyId).toBe('col_0');
      expect(ev.data.achievement).toBe('Groundbreaker');
      expect(ev.achievement).toBe('Groundbreaker');
      expect(ev.data.count).toBeGreaterThan(0);
      totalCount += ev.data.count;
    }

    expect(totalCount).toBe(9);
  });
});

describe('W01-31: Per-step batching of progression events', () => {
  it('batches multiple tilePrepared and obstacleRemoved events in the same step per (colonyId, op)', () => {
    const bus = new EventBus();
    const forwarder = new ProgressionEventForwarder(bus);

    const receivedPrepared = collect<BatchedTilePreparedEvent>(bus, 'tilePrepared');
    const receivedObstacles = collect<BatchedObstacleRemovedEvent>(bus, 'obstacleRemoved');
    const emits: unknown[] = [];
    bus.on('planet.event', (e) => emits.push(e), { module: 'test' });

    const stepEvents: SimEvent[] = [
      { atTick: 50, kind: 'tilePrepared', severity: 'info', colonyIds: ['col_A'], data: { colonyId: 'col_A', playerId: 'p_A', count: 1, q: 0, r: 0 } },
      { atTick: 50, kind: 'tilePrepared', severity: 'info', colonyIds: ['col_A'], data: { colonyId: 'col_A', playerId: 'p_A', count: 1, q: 1, r: 0 } },
      { atTick: 50, kind: 'tilePrepared', severity: 'info', colonyIds: ['col_A'], data: { colonyId: 'col_A', playerId: 'p_A', count: 1, q: 2, r: 0 } },
      { atTick: 50, kind: 'tilePrepared', severity: 'info', colonyIds: ['col_B'], data: { colonyId: 'col_B', playerId: 'p_B', count: 2, q: 3, r: 0 } },
      { atTick: 50, kind: 'obstacleRemoved', severity: 'info', colonyIds: ['col_A'], data: { colonyId: 'col_A', playerId: 'p_A', op: 'clear', count: 1, q: 0, r: 1 } },
      { atTick: 50, kind: 'obstacleRemoved', severity: 'info', colonyIds: ['col_A'], data: { colonyId: 'col_A', playerId: 'p_A', op: 'clear', count: 1, q: 1, r: 1 } },
      { atTick: 50, kind: 'obstacleRemoved', severity: 'info', colonyIds: ['col_A'], data: { colonyId: 'col_A', playerId: 'p_A', op: 'break', count: 1, q: 2, r: 1 } },
    ];

    const batchedDirect = batchProgressionEventsForStep('pl_dev', stepEvents);
    expect(batchedDirect.tilePrepared).toHaveLength(2);
    expect(batchedDirect.obstacleRemoved).toHaveLength(2);

    const result = forwarder.forwardStep('pl_dev', stepEvents);

    expect(result.tilePrepared).toHaveLength(2);
    expect(result.obstacleRemoved).toHaveLength(2);
    expect(emits).toHaveLength(4); // one planet.event per batch, nothing else

    // one aggregator, both kinds: the same shape, the obstacle key adds `op`
    expect(result.obstacleRemoved.find((e) => e.op === 'clear')).toEqual({
      planetId: 'pl_dev', tick: 50, kind: 'obstacleRemoved', severity: 'info', colonyIds: ['col_A'],
      colonyId: 'col_A', playerId: 'p_A', op: 'clear', count: 2, q: 1, r: 1, achievement: 'Stone Mason',
      data: { colonyId: 'col_A', playerId: 'p_A', op: 'clear', count: 2, q: 1, r: 1, achievement: 'Stone Mason' },
    });
    expect(result.tilePrepared.find((e) => e.colonyId === 'col_A')).toEqual({
      planetId: 'pl_dev', tick: 50, kind: 'tilePrepared', severity: 'info', colonyIds: ['col_A'],
      colonyId: 'col_A', playerId: 'p_A', count: 3, q: 2, r: 0, achievement: 'Groundbreaker',
      data: { colonyId: 'col_A', playerId: 'p_A', count: 3, q: 2, r: 0, achievement: 'Groundbreaker' },
    });

    expect(receivedPrepared).toHaveLength(2);
    const colAPrep = receivedPrepared.find((e) => e.colonyId === 'col_A')!;
    expect(colAPrep.count).toBe(3);
    expect(colAPrep.playerId).toBe('p_A');
    expect(colAPrep.achievement).toBe('Groundbreaker');

    const colBPrep = receivedPrepared.find((e) => e.colonyId === 'col_B')!;
    expect(colBPrep.count).toBe(2);
    expect(colBPrep.playerId).toBe('p_B');

    expect(receivedObstacles).toHaveLength(2);
    const clearEv = receivedObstacles.find((e) => e.op === 'clear')!;
    expect(clearEv.count).toBe(2);
    expect(clearEv.colonyId).toBe('col_A');
    expect(clearEv.playerId).toBe('p_A');
    expect(clearEv.achievement).toBe('Stone Mason');

    const breakEv = receivedObstacles.find((e) => e.op === 'break')!;
    expect(breakEv.count).toBe(1);
    expect(breakEv.colonyId).toBe('col_A');
    expect(breakEv.playerId).toBe('p_A');
    expect(breakEv.achievement).toBe('Stone Mason');
  });
});

describe('W01-31: Landfall & Stone Mason forwarding and player resolution', () => {
  it('publishes colonyFounded (Landfall) carrying playerId, colonyId, planetId, q, r, achievement: Landfall', () => {
    const bus = new EventBus();
    const forwarder = new ProgressionEventForwarder(bus);

    const receivedFounded = collect<BatchedColonyFoundedEvent>(bus, 'colonyFounded');

    const foundedSimEvents: SimEvent[] = [
      {
        atTick: 100,
        kind: 'colonyFounded',
        severity: 'info',
        colonyIds: ['col_hq'],
        data: { colonyId: 'col_hq', playerId: 'player_hero', hubId: 42, q: 3, r: 2 },
      },
    ];

    forwarder.forwardStep('pl_dune', foundedSimEvents);

    expect(receivedFounded).toHaveLength(1);
    const ev = receivedFounded[0];
    expect(ev.planetId).toBe('pl_dune');
    expect(ev.tick).toBe(100);
    expect(ev.colonyId).toBe('col_hq');
    expect(ev.playerId).toBe('player_hero');
    expect(ev.hubId).toBe(42);
    expect(ev.q).toBe(3);
    expect(ev.r).toBe(2);
    expect(ev.achievement).toBe('Landfall');
    expect(ev.data.achievement).toBe('Landfall');
  });

  it('resolves playerId from HomeRepository when event.data.playerId is omitted', async () => {
    const bus = new EventBus();
    const homeRepo = new HomeRepository();
    await homeRepo.createColony({
      id: 'col_persisted',
      playerId: 'pr_from_db',
      planetId: 'pl_test',
      colonyIndex: 0,
      name: 'Persisted Colony',
      spawnQ: 0,
      spawnR: 0,
    });

    const forwarder = new ProgressionEventForwarder(bus, homeRepo);
    const seen = collect<BatchedTilePreparedEvent>(bus, 'tilePrepared');

    const rawEvent: SimEvent = {
      atTick: 10,
      kind: 'tilePrepared',
      severity: 'info',
      colonyIds: ['col_persisted'],
      data: { colonyId: 'col_persisted', count: 1, q: 0, r: 0 },
    };

    forwarder.forwardStep('pl_test', [rawEvent]);

    expect(seen).toHaveLength(1);
    expect(seen[0].playerId).toBe('pr_from_db');
    expect(seen[0].data.playerId).toBe('pr_from_db');
  });

  it('skips (with a warning) an event whose player cannot be resolved, never guessing it from the colony id', () => {
    const bus = new EventBus();
    const warnings: unknown[] = [];
    const forwarder = new ProgressionEventForwarder(bus, undefined, { warn: (o: unknown) => { warnings.push(o); } } as never);
    const seen: unknown[] = [];
    bus.on('planet.event', (e) => seen.push(e), { module: 'test' });

    const orphan: SimEvent[] = [
      { atTick: 7, kind: 'tilePrepared', severity: 'info', colonyIds: ['col_unknown'], data: { colonyId: 'col_unknown', count: 1, q: 0, r: 0 } },
      { atTick: 7, kind: 'colonyFounded', severity: 'info', colonyIds: [], data: { q: 1, r: 1 } },
    ];
    const batched = forwarder.forwardStep('pl_test', orphan);
    expect([...batched]).toEqual([]);
    expect(seen).toEqual([]);
    expect(warnings).toEqual([
      { planetId: 'pl_test', kind: 'tilePrepared', colonyIds: ['col_unknown'], tick: 7 },
      { planetId: 'pl_test', kind: 'colonyFounded', colonyIds: [], tick: 7 },
    ]);

    forwarder.registerColony('col_unknown', 'pr_seated'); // registered at seating: now it resolves
    expect(forwarder.forwardStep('pl_test', [orphan[0]!]).tilePrepared.map((e) => e.playerId)).toEqual(['pr_seated']);
  });
});

describe('W01-31: Live SimHost gameplay progression events', () => {
  it('emits colonyFounded and obstacleRemoved on SimHost during actual gameplay operations', () => {
    const bus = new EventBus();
    const host = createW01Host(12);
    const state = host.state;

    state.colonies[0] = {
      index: 0,
      id: 'col_0',
      playerId: 'pr_sim_player',
      name: 'Base Alpha',
      color: 0xff6a2a,
      status: 'active',
      changedAt: 0,
    };
    spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    setColonyStock(state, 0, {
      'metals.t1': 600,
      'minerals.t1': 350,
      'bio.biomass': 200,
      'bio.water': 200,
    });

    const foundedEvents = collect<BatchedColonyFoundedEvent>(bus, 'colonyFounded');
    const obstacleEvents = collect<BatchedObstacleRemovedEvent>(bus, 'obstacleRemoved');

    forwardHost(host, bus);

    const tileIdx = hexIndex(state.grid.radius).indexOf(1, 0);
    setTileTerrain(state.grid, tileIdx, TERRAIN.forest);
    setTilePrep(state.grid, tileIdx, PREP.wild);

    host.submit(mkCmd('enqueueTask', { terraform: { op: 'clear', tiles: [{ q: 1, r: 0 }] } }, 0));
    for (let t = 0; t < 25; t++) {
      host.step(1);
      if (obstacleEvents.length > 0) break;
    }

    expect(obstacleEvents).toHaveLength(1);
    expect(obstacleEvents[0].op).toBe('clear');
    expect(obstacleEvents[0].playerId).toBe('pr_sim_player');
    expect(obstacleEvents[0].achievement).toBe('Stone Mason');

    const hubFootprint = [
      { q: 3, r: 0 }, { q: 4, r: 0 }, { q: 2, r: 0 },
      { q: 3, r: 1 }, { q: 4, r: -1 }, { q: 2, r: 1 },
      { q: 3, r: -1 }, { q: 4, r: 1 }, { q: 2, r: -1 },
    ];
    const hex = hexIndex(state.grid.radius);
    for (const pos of hubFootprint) {
      setTilePrep(state.grid, hex.indexOf(pos.q, pos.r), PREP.prepared);
    }

    placeBuildingOrder(state, { colonyId: 0, q: 3, r: 0, buildingKind: 'commandHub' });

    for (let t = 0; t < 120; t++) {
      host.step(1);
      if (foundedEvents.length > 0) break;
    }

    expect(foundedEvents).toHaveLength(1);
    expect(foundedEvents[0].colonyId).toBe('col_0');
    expect(foundedEvents[0].playerId).toBe('pr_sim_player');
    expect(foundedEvents[0].achievement).toBe('Landfall');
  });
});

describe('W05-29: W05 progression events (obstacleRemoved + family mapping)', () => {
  it('acceptance: Seed 3 tiles -> the progression bus logs 3 obstacleRemoved { op: "seed" } with achievement Green Thumb', () => {
    const bus = new EventBus();
    const host = new SimHost({ flags: parseWaves('..05') });
    host.load(createPlanet({ type: 'flat', seed: 'w05-seed-bus', radius: 12 }));
    const state = host.state;

    state.colonies[0] = {
      index: 0,
      id: 'col_0',
      playerId: 'pr_w05',
      name: 'Green Colony',
      color: 0xff6a2a,
      status: 'active',
      changedAt: 0,
      powerSupplyOverride: 500,
    };
    setColonyStock(state, 0, {
      'metals.t1': 500,
      'minerals.t1': 500,
      'bio.biomass': 500,
      'bio.water': 500,
    });
    startBuildingConstruction(state, {
      owner: 0,
      building: 'commandHub',
      q: 0,
      r: 0,
      instant: true,
      costOverride: {},
    });
    const tiles = [
      { q: 3, r: 0 },
      { q: 3, r: 1 },
      { q: 4, r: -1 },
    ];
    const hex = hexIndex(state.grid.radius);
    for (const t of tiles) {
      setTilePrep(state.grid, hex.indexOf(t.q, t.r), PREP.irrigated, 0);
    }

    spawnTerraformerUnit(state, { owner: 0, q: 4, r: 0 });

    const obstacleEvents = collect<BatchedObstacleRemovedEvent>(bus, 'obstacleRemoved');
    forwardHost(host, bus, 'pl_w05');

    host.submit(mkCmd('enqueueTask', { terraform: { op: 'seed', tiles } }, 0));
    for (let t = 0; t < 300; t++) {
      host.step(1);
      const totalSeeded = obstacleEvents.reduce((sum, e) => sum + (e.op === 'seed' ? e.count : 0), 0);
      if (totalSeeded >= 3) break;
    }

    const seedEvents = obstacleEvents.filter((e) => e.op === 'seed');
    expect(seedEvents.reduce((sum, e) => sum + e.count, 0)).toBe(3);
    for (const ev of seedEvents) {
      expect(ev.op).toBe('seed');
      expect(ev.achievement).toBe('Green Thumb');
      expect(ev.data.achievement).toBe('Green Thumb');
      expect(ev.playerId).toBe('pr_w05');
    }
  });

  it('maps level/fill to Stone Mason, reclaim/deepReclaim to Hydro Engineer, and seed to Green Thumb', () => {
    const bus = new EventBus();
    const forwarder = new ProgressionEventForwarder(bus);
    const stepEvents: SimEvent[] = [
      { atTick: 10, kind: 'obstacleRemoved', severity: 'info', colonyIds: ['col_A'], data: { colonyId: 'col_A', playerId: 'p_A', op: 'level', count: 2, q: 1, r: 0 } },
      { atTick: 10, kind: 'obstacleRemoved', severity: 'info', colonyIds: ['col_A'], data: { colonyId: 'col_A', playerId: 'p_A', op: 'fill', count: 1, q: 2, r: 0 } },
      { atTick: 10, kind: 'obstacleRemoved', severity: 'info', colonyIds: ['col_A'], data: { colonyId: 'col_A', playerId: 'p_A', op: 'reclaim', count: 3, q: 3, r: 0 } },
      { atTick: 10, kind: 'obstacleRemoved', severity: 'info', colonyIds: ['col_A'], data: { colonyId: 'col_A', playerId: 'p_A', op: 'deepReclaim', count: 1, q: 4, r: 0 } },
      { atTick: 10, kind: 'obstacleRemoved', severity: 'info', colonyIds: ['col_A'], data: { colonyId: 'col_A', playerId: 'p_A', op: 'seed', count: 3, q: 5, r: 0 } },
    ];

    const batched = forwarder.forwardStep('pl_w05', stepEvents);
    expect(batched.obstacleRemoved.map((e) => [e.op, e.count, e.achievement])).toEqual([
      ['level', 2, 'Stone Mason'],
      ['fill', 1, 'Stone Mason'],
      ['reclaim', 3, 'Hydro Engineer'],
      ['deepReclaim', 1, 'Hydro Engineer'],
      ['seed', 3, 'Green Thumb'],
    ]);
  });
});

