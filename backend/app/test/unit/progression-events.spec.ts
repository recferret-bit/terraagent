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
  TERRAIN,
  type SimEvent,
} from '@terra/sim';
import { describe, expect, it } from 'vitest';
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
  wireProgressionEvents,
} from '../../src/game/progression-events.service';

let cmdSeq = 0;
function mkCmd(kind: string, args: unknown, colonyIndex = 0): SimCommandV1 {
  return { colonyIndex, source: 'player', commandId: `cmd_${++cmdSeq}`, kind, args } as SimCommandV1;
}

function createW01Host(radius = 12): SimHost {
  const host = new SimHost({ flags: parseWaves('..01') });
  host.load(createPlanet({ type: 'flat', seed: 'progression-events-test', radius }));
  return host;
}

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

    const seenPlanetEvents: BatchedTilePreparedEvent[] = [];
    const seenDirectEvents: BatchedTilePreparedEvent[] = [];
    const seenProgressionEvents: BatchedTilePreparedEvent[] = [];

    bus.onPlanetEvent('tilePrepared', (e) => seenPlanetEvents.push(e as unknown as BatchedTilePreparedEvent), { module: 'test' });
    bus.on('tilePrepared', (e) => seenDirectEvents.push(e), { module: 'test' });
    bus.on('progression.tilePrepared', (e) => seenProgressionEvents.push(e), { module: 'test' });

    wireProgressionEvents(host, bus);

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
    expect(seenDirectEvents.length).toBe(seenPlanetEvents.length);
    expect(seenProgressionEvents.length).toBe(seenPlanetEvents.length);

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

    const receivedPrepared: BatchedTilePreparedEvent[] = [];
    const receivedObstacles: BatchedObstacleRemovedEvent[] = [];

    bus.on('tilePrepared', (e) => receivedPrepared.push(e), { module: 'test' });
    bus.on('obstacleRemoved', (e) => receivedObstacles.push(e), { module: 'test' });

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

    const receivedFounded: BatchedColonyFoundedEvent[] = [];
    bus.on('colonyFounded', (e) => receivedFounded.push(e), { module: 'test' });
    bus.onPlanetEvent('colonyFounded', (e) => {
      expect(e.data.achievement).toBe('Landfall');
    }, { module: 'test' });

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
    const seen: BatchedTilePreparedEvent[] = [];
    bus.on('progression.tilePrepared', (e) => seen.push(e), { module: 'test' });

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

    const foundedEvents: BatchedColonyFoundedEvent[] = [];
    const obstacleEvents: BatchedObstacleRemovedEvent[] = [];

    bus.on('colonyFounded', (e) => foundedEvents.push(e), { module: 'test' });
    bus.on('obstacleRemoved', (e) => obstacleEvents.push(e), { module: 'test' });

    wireProgressionEvents(host, bus);

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
