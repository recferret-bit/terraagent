import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  BUILDING_KIND,
  ENTITY_KIND,
  ENTITY_STATE,
  UNIT_KIND,
  computeColonyThreatStage,
  createRegistryPipeline,
  createState,
  demolishBuilding,
  ensureColonyRecord,
  getColonyProgression,
  insertRow,
  ownsStageGatingBuilding,
  placeSpawnedEntity,
  spawnColonyLanding,
  spawnHqUnit,
  step,
  syncColonyThreatStage,
  view,
  type PlanetState,
} from '../../src';

function createThreatStagePlanet(seed = 'w08-08-test', waves = '..08') {
  const state = createState({ planetId: `pl-${seed}`, planetType: 'temperate', seed, radius: 16 });
  const colony = ensureColonyRecord(state, 0, 0);
  colony.status = 'active';
  spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
  const pipeline = createRegistryPipeline({ flags: parseWaves(waves) });
  return { state, colony, pipeline };
}

function spawnEntity(
  state: PlanetState,
  opts: {
    kind: number;
    owner?: number;
    q?: number;
    r?: number;
    tier?: number;
    hp?: number;
    state?: number;
  },
): { id: number; row: number } {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, state.meta.tick);
  const cols = state.entities.cols;
  cols.kind[row] = opts.kind;
  cols.owner[row] = opts.owner ?? 0;
  cols.tier[row] = opts.tier ?? 1;
  placeSpawnedEntity(state.entities, row, opts.q ?? 0, opts.r ?? 0, state.meta.tick);
  cols.hp[row] = opts.hp ?? 500;
  cols.hpMax[row] = opts.hp ?? 500;
  cols.state[row] = opts.state ?? ENTITY_STATE.active;
  cols.progress[row] = cols.state[row] === ENTITY_STATE.constructing ? 0.5 : 1;
  return { id, row };
}

describe('W08-08 · ThreatStage calculation from owned gating buildings (UO-T-06)', () => {
  it('Acceptance check: destroy the colony only Factory T1 at S4 -> threatStage drops to 2 within one step', () => {
    const { state, colony, pipeline } = createThreatStagePlanet('s4-destroy-factory');
    colony.stage = 4;
    colony.unlockStage = 4;

    // Own S1 (Hub), S2 (extractor + generator), and S3/S4 (1 Factory T1)
    spawnEntity(state, { kind: ENTITY_KIND.commandHub, q: 2, r: 0 });
    spawnEntity(state, { kind: ENTITY_KIND.metalsExtractor, q: 4, r: 0 });
    spawnEntity(state, { kind: ENTITY_KIND.solar, q: 2, r: 2 });
    const factory = spawnEntity(state, { kind: BUILDING_KIND.roboticsFactory, q: 5, r: 0 });

    step(state, [], 1, pipeline);
    expect(colony.stage).toBe(4);
    expect(colony.threatStage).toBe(4);
    expect(getColonyProgression(state, 0).threatStage).toBe(4);
    expect(view(state).colonies[0].threatStage).toBe(4);

    // Destroy the only Factory T1 (hp = 0) and step once (1 tick)
    state.entities.cols.hp[factory.row] = 0;
    step(state, [], 1, pipeline);

    expect(colony.stage).toBe(4);
    expect(colony.unlockStage).toBe(4);
    expect(colony.threatStage).toBe(2);
    expect(getColonyProgression(state, 0).threatStage).toBe(2);
    expect(view(state).colonies[0].threatStage).toBe(2);
  });

  it('drops threatStage from 4 to 2 immediately when the only Factory T1 at S4 is demolished', () => {
    const { state, colony, pipeline } = createThreatStagePlanet('s4-demolish-factory');
    colony.stage = 4;
    colony.unlockStage = 4;

    spawnEntity(state, { kind: ENTITY_KIND.commandHub, q: 2, r: 0 });
    spawnEntity(state, { kind: ENTITY_KIND.metalsExtractor, q: 4, r: 0 });
    spawnEntity(state, { kind: ENTITY_KIND.solar, q: 2, r: 2 });
    const factory = spawnEntity(state, { kind: BUILDING_KIND.roboticsFactory, q: 5, r: 0 });

    step(state, [], 1, pipeline);
    expect(colony.threatStage).toBe(4);

    const dem = demolishBuilding(state, factory.id, 0);
    expect(dem.ok).toBe(true);
    expect(colony.threatStage).toBe(2);

    step(state, [], 1, pipeline);
    expect(colony.threatStage).toBe(2);
  });
});

describe('W08-08 · ThreatStage progression S0..S10 & veteran unlockStage separation', () => {
  it('progresses threatStage 0 -> 1 -> 2 -> 3 -> 4 as gating buildings complete and stages advance', () => {
    const { state, colony, pipeline } = createThreatStagePlanet('threat-0-to-4');

    // S0: no buildings or under-construction Hub -> threatStage = 0
    step(state, [], 1, pipeline);
    expect(colony.threatStage).toBe(0);

    const hub = spawnEntity(state, {
      kind: ENTITY_KIND.commandHub,
      q: 2,
      r: 0,
      state: ENTITY_STATE.constructing,
    });
    step(state, [], 1, pipeline);
    expect(colony.threatStage).toBe(0);

    // Complete Hub -> threatStage = 1 within one step
    state.entities.cols.state[hub.row] = ENTITY_STATE.active;
    state.entities.cols.progress[hub.row] = 1;
    step(state, [], 1, pipeline);
    expect(colony.threatStage).toBe(1);

    // Complete only extractor -> still 1 until generator also completes
    spawnEntity(state, { kind: ENTITY_KIND.metalsExtractor, q: 4, r: 0 });
    step(state, [], 1, pipeline);
    expect(colony.threatStage).toBe(1);

    // Complete generator -> threatStage = 2
    spawnEntity(state, { kind: ENTITY_KIND.solar, q: 2, r: 2 });
    step(state, [], 1, pipeline);
    expect(colony.threatStage).toBe(2);

    // Complete Factory T1 while at S0..S3 -> threatStage = 3
    spawnEntity(state, { kind: BUILDING_KIND.roboticsFactory, q: 5, r: 0 });
    step(state, [], 1, pipeline);
    expect(colony.threatStage).toBe(3);

    // Advance colony through S1, S2, S3, S4 -> records s2ReachedAtTick, s3ReachedAtTick, and threatStage = 4 at S4
    spawnEntity(state, { kind: BUILDING_KIND.mineralsExtractor, q: 6, r: 0 });
    spawnEntity(state, { kind: BUILDING_KIND.wind, q: 3, r: 2 });
    spawnEntity(state, { kind: BUILDING_KIND.depot, q: 1, r: 2 });
    spawnEntity(state, { kind: UNIT_KIND.scout, q: 7, r: 0 });

    step(state, [], 300, pipeline); // S1
    expect(colony.stage).toBe(1);
    expect(colony.threatStage).toBe(3);

    step(state, [], 600, pipeline); // S2
    expect(colony.stage).toBe(2);
    expect(colony.s2ReachedAtTick).toBeTypeOf('number');

    step(state, [], 900, pipeline); // S3
    expect(colony.stage).toBe(3);
    expect(colony.s3ReachedAtTick).toBeTypeOf('number');
    expect(colony.threatStage).toBe(3);

    step(state, [], 900, pipeline); // S4
    expect(colony.stage).toBe(4);
    expect(colony.threatStage).toBe(4);
  });
});

describe('W08-08 · Veteran unlockStage and S5..S10 gating buildings', () => {
  it('spawning a colony with unlockStage=4 keeps threatStage=0 until gating buildings are built (UO-LC-06)', () => {
    const state = createState({ planetId: 'pl-vet', planetType: 'temperate', seed: 'vet', radius: 16 });
    const pipeline = createRegistryPipeline({ flags: parseWaves('..08') });

    const landed = spawnColonyLanding(state, { colonyId: 0, unlockStage: 4, q: 0, r: 0 });
    expect(landed.ok).toBe(true);

    const colony = state.colonies[0];
    expect(colony.unlockStage).toBe(4);
    expect(colony.threatStage).toBe(0);

    step(state, [], 35, pipeline); // Pod lands and deploys HQ
    expect(colony.unlockStage).toBe(4);
    expect(colony.threatStage).toBe(0);
    expect(view(state).colonies[0].unlockStage).toBe(4);
    expect(view(state).colonies[0].threatStage).toBe(0);
  });

  it('evaluates S5..S10 gating buildings and drops threatStage when Factory T2 is lost', () => {
    const { state, colony } = createThreatStagePlanet('s5-to-s10', 'all');
    colony.stage = 6;
    colony.unlockStage = 6;

    spawnEntity(state, { kind: ENTITY_KIND.commandHub, q: 2, r: 0 });
    spawnEntity(state, { kind: ENTITY_KIND.metalsExtractor, q: 4, r: 0 });
    spawnEntity(state, { kind: ENTITY_KIND.solar, q: 2, r: 2 });
    spawnEntity(state, { kind: BUILDING_KIND.smelter, q: 3, r: 0 });
    const factoryT2 = spawnEntity(state, { kind: BUILDING_KIND.roboticsFactory, q: 5, r: 0, tier: 2 });

    expect(ownsStageGatingBuilding(state, 0, 5)).toBe(true);
    expect(ownsStageGatingBuilding(state, 0, 6)).toBe(true);
    expect(syncColonyThreatStage(state, 0)).toBe(6);
    expect(colony.threatStage).toBe(6);

    // Lose Factory T2 -> drops to S5 (smelter still alive)
    state.entities.cols.hp[factoryT2.row] = 0;
    expect(computeColonyThreatStage(state, 0)).toBe(5);

    // Add S7..S10 gating buildings
    spawnEntity(state, { kind: BUILDING_KIND.heavyFoundry, q: 6, r: 0 });
    expect(computeColonyThreatStage(state, 0)).toBe(7);

    state.entities.cols.tier[1] = 3; // Hub T3
    expect(computeColonyThreatStage(state, 0)).toBe(8);

    spawnEntity(state, { kind: BUILDING_KIND.orbitalUplink, q: 7, r: 0 });
    expect(computeColonyThreatStage(state, 0)).toBe(9);

    spawnEntity(state, { kind: BUILDING_KIND.launchPad, q: 8, r: 0 });
    expect(computeColonyThreatStage(state, 0)).toBe(10);
  });
});
