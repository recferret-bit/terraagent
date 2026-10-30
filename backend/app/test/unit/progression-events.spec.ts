import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createRegistryPipeline,
  createState,
  creditResource,
  DEPOSIT,
  ensureColonyLedger,
  hexIndex,
  placeMetalsExtractor,
  setTileDeposit,
  spawnHqUnit,
  startBuildingConstruction,
  step,
  type Pipeline,
  type PlanetState,
  type SimEvent,
} from '@terra/sim';
import { EventBus } from '../../src/bus/event-bus';
import {
  ProgressionEventsService,
  ProgressionEventBridge,
  type BuildingCompletedEvent,
  type ResourceProducedEvent,
  WINDOW_S,
} from '../../src/modules/progression-events';

interface ScenarioContext {
  readonly state: PlanetState;
  readonly pipeline: Pipeline;
  readonly bus: EventBus;
  readonly service: ProgressionEventsService;
  readonly buildingEvents: BuildingCompletedEvent[];
  readonly resourceEvents: ResourceProducedEvent[];
  readonly planetEvents: Array<{ kind: string; data: unknown }>;
}

function setupSolarAndExtractorScenario(): ScenarioContext {
  const state = createState({ planetId: 'p1', planetType: 'temperate', seed: 'w02', radius: 8 });
  const colony = ensureColonyLedger({
    index: 0,
    id: 'col-0',
    name: 'Alpha',
    color: 0xff6b00,
    status: 'active',
    changedAt: 0,
  });
  state.colonies.push(colony);

  creditResource(colony, 'metals.t1', 60, 0);
  creditResource(colony, 'minerals.t1', 75, 0);
  creditResource(colony, 'bio.biomass', 10, 0);
  creditResource(colony, 'bio.water', 5, 0);

  const hqId = spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
  const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });

  const idx = hexIndex(state.grid.radius);
  const depTile = idx.indexOf(2, -1);
  setTileDeposit(state, depTile, DEPOSIT.metals, 10000, 0);
  placeMetalsExtractor(state, { owner: 0, q: 1, r: -1 });

  startBuildingConstruction(state, {
    owner: 0,
    building: 'solar',
    q: -2,
    r: 1,
    workerEntityId: hqId,
  });

  const bus = new EventBus();
  const service = new ProgressionEventsService(bus);
  const buildingEvents: BuildingCompletedEvent[] = [];
  const resourceEvents: ResourceProducedEvent[] = [];
  const planetEvents: Array<{ kind: string; data: unknown }> = [];

  bus.on('buildingCompleted', (e) => buildingEvents.push(e), { module: 'test' });
  bus.on('resourceProduced', (e) => resourceEvents.push(e), { module: 'test' });
  bus.on('planet.event', (e) => planetEvents.push(e as { kind: string; data: unknown }), { module: 'test' });

  return { state, pipeline, bus, service, buildingEvents, resourceEvents, planetEvents };
}

function stepSimulation(ctx: ScenarioContext, ticks: number): void {
  for (let t = 0; t < ticks; t++) {
    const stepRes = step(ctx.state, [], 1, ctx.pipeline);
    ctx.service.processSimStep('p1', ctx.state, stepRes, ctx.bus);
  }
}

describe('W02-28 Progression events: Solar & Extractor production', () => {
  it('complete a Solar and run 60 s of Extractor production -> both events appear on the bus', () => {
    const ctx = setupSolarAndExtractorScenario();

    stepSimulation(ctx, 59);
    expect(ctx.buildingEvents).toHaveLength(0);
    expect(ctx.resourceEvents).toHaveLength(0);

    stepSimulation(ctx, 1);
    expect(ctx.buildingEvents).toHaveLength(1);
    expect(ctx.buildingEvents[0]).toMatchObject({
      kind: 'solar',
      building: 'solar',
      planetId: 'p1',
      colonyIndex: 0,
    });

    stepSimulation(ctx, 300);
    expect(ctx.resourceEvents).toHaveLength(1);
    expect(ctx.resourceEvents[0]).toMatchObject({
      res: 'metals.t1',
      amount: 60,
      windowS: 60,
      playerId: 'col-0',
      planetId: 'p1',
      colonyIndex: 0,
    });
  });

  it('delivers typed events on planet.event channel', () => {
    const ctx = setupSolarAndExtractorScenario();
    stepSimulation(ctx, 60);
    stepSimulation(ctx, 300);

    const planetBuilding = ctx.planetEvents.find((e) => e.kind === 'buildingCompleted');
    expect(planetBuilding?.data).toMatchObject({
      building: 'solar',
      kind: 'solar',
      colonyId: 'col-0',
      tier: 1,
    });

    const planetResource = ctx.planetEvents.find((e) => e.kind === 'resourceProduced');
    expect(planetResource?.data).toMatchObject({
      res: 'metals.t1',
      amount: 60,
      colonyId: 'col-0',
    });
  });

  it('emits second 60s resourceProduced batch after 2 minutes of production', () => {
    const ctx = setupSolarAndExtractorScenario();
    stepSimulation(ctx, 60);
    stepSimulation(ctx, 300);
    expect(ctx.resourceEvents).toHaveLength(1);

    stepSimulation(ctx, 300);
    expect(ctx.resourceEvents).toHaveLength(2);
    expect(ctx.resourceEvents[1]).toMatchObject({
      res: 'metals.t1',
      amount: 60,
      windowS: 60,
    });
    expect(ctx.buildingEvents).toHaveLength(1);
  });
});

describe('W02-28 Progression events: API & integration hooks', () => {
  it('supports direct recordBuildingCompleted and recordProductionStep calls', () => {
    const bus = new EventBus();
    const service = new ProgressionEventBridge(bus);
    const buildingEvents: BuildingCompletedEvent[] = [];
    const resourceEvents: ResourceProducedEvent[] = [];
    bus.on('buildingCompleted', (e) => buildingEvents.push(e), { module: 'test' });
    bus.on('resourceProduced', (e) => resourceEvents.push(e), { module: 'test' });

    service.recordBuildingCompleted({
      entityId: 42,
      building: 'commandHub',
      kind: 'commandHub',
      tier: 1,
      q: 1,
      r: 2,
      playerId: 'player-1',
      colonyId: 'col-1',
      planetId: 'planet-dev',
      colonyIndex: 1,
      tick: 10,
    });

    expect(buildingEvents).toHaveLength(1);
    expect(buildingEvents[0]).toMatchObject({
      entityId: 42,
      building: 'commandHub',
      kind: 'commandHub',
    });

    const state = createState({ planetId: 'p2', planetType: 'temperate', seed: 'w02', radius: 4 });
    const colony = ensureColonyLedger({
      index: 0,
      id: 'c0',
      name: 'Beta',
      color: 0x00ff00,
      status: 'active',
      changedAt: 0,
    });
    state.colonies.push(colony);

    state.meta.tick = 300;
    colony.production.produced['metals.t1'] = 120;
    service.recordProductionStep('p2', state, 300, bus);

    expect(resourceEvents).toHaveLength(1);
    expect(resourceEvents[0]).toMatchObject({
      res: 'metals.t1',
      amount: 120,
      windowS: WINDOW_S,
      colonyIndex: 0,
      tick: 300,
    });
  });

  it('attach hooks into planets.onEvents stream', () => {
    const bus = new EventBus();
    const service = new ProgressionEventsService(bus);
    const seen: BuildingCompletedEvent[] = [];
    bus.on('buildingCompleted', (e) => seen.push(e), { module: 'test' });

    let listener: ((planetId: string, events: readonly SimEvent[]) => void) | undefined;
    const fakePlanets = {
      onEvents: (l: (planetId: string, events: readonly SimEvent[]) => void) => {
        listener = l;
        return () => { listener = undefined; };
      },
    };

    const unbind = service.attach(fakePlanets, bus);
    expect(listener).toBeDefined();

    listener?.('planet-x', [
      {
        kind: 'buildingCompleted',
        severity: 'info',
        atTick: 123,
        colonyIds: ['col-x'],
        data: { entityId: 7, building: 'solar', kind: 'solar', q: 0, r: 0, colonyId: 'col-x' },
      },
    ]);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      entityId: 7,
      building: 'solar',
      planetId: 'planet-x',
      tick: 123,
    });

    unbind();
    expect(listener).toBeUndefined();
  });
});
