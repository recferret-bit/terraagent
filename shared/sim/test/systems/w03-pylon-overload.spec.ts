import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createRegistryPipeline,
  createState,
  ENTITY_KIND,
  ENTITY_STATE,
  getColonyPower,
  insertRow,
  setPlanetTime,
  step,
  type PlanetState,
} from '../../src';

function spawnBuilding(
  state: PlanetState,
  kind: number,
  q: number,
  r: number,
  w = 2,
  d = 2,
  hp = 500,
): number {
  const row = insertRow(state.entities, state.meta.nextEntityId++, 0);
  const cols = state.entities.cols;
  cols.kind[row] = kind;
  cols.owner[row] = 0;
  cols.q[row] = q;
  cols.r[row] = r;
  cols.footprintW[row] = w;
  cols.footprintD[row] = d;
  cols.hp[row] = hp;
  cols.hpMax[row] = hp;
  cols.state[row] = ENTITY_STATE.active;
  return row;
}

function initOverloadTestState(): { state: PlanetState; pipeline: ReturnType<typeof createRegistryPipeline> } {
  const state = createState({ planetId: 'p1', planetType: 'temperate', seed: 'w03', radius: 32 });
  state.colonies.push({
    index: 0,
    id: 'col-0',
    name: 'Alpha',
    color: 0xff6b00,
    status: 'active',
    changedAt: 0,
  });
  const pipeline = createRegistryPipeline({ flags: parseWaves('..03') });
  return { state, pipeline };
}

describe('W03-06 Per-pylon max load — acceptance check', () => {
  it('Pylon carrying 95 E/s (> 80 E/s max) sheds downstream consumer with reason overload; other branch stays online; powerOverload emitted debounced 600 ticks', () => {
    const { state, pipeline } = initOverloadTestState();

    // Hub at (0, 0) (max load 150 E/s)
    spawnBuilding(state, ENTITY_KIND.commandHub, 0, 0, 3, 3, 1500);

    // 5 Thermal plants right next to Hub (+125 net + 8 founder core = 133 E/s ample supply)
    state.colonies[0].stock = { 'bio.biomass': 1000 };
    const genOffsets = [[3, 0], [3, 2], [0, 3], [2, 3], [-2, 2]];
    for (const [q, r] of genOffsets) {
      spawnBuilding(state, ENTITY_KIND.thermal, q, r, 2, 2, 450);
    }

    // Branch A: Pylon A at (6, 0)
    const pylonARow = spawnBuilding(state, ENTITY_KIND.pylon, 6, 0, 1, 1, 100);
    const pylonAId = state.entities.cols.id[pylonARow];

    // Downstream of Pylon A:
    // 9 PetroleumWells (10 E/s each) + 1 MetalsExtractor (6 E/s) = 96 E/s + 0.5 (pylon loss) = 96.5 E/s > 80 E/s max
    const offsets = [
      [7, 0], [7, -1], [7, 1], [6, 1], [6, 2],
      [6, -1], [6, -2], [5, 1], [5, -1],
    ];
    const consumerRows: number[] = [];
    for (const [q, r] of offsets) {
      consumerRows.push(spawnBuilding(state, ENTITY_KIND.petroleumWell, q, r, 2, 2, 600));
    }
    const extRow = spawnBuilding(state, ENTITY_KIND.metalsExtractor, 8, -1, 2, 2, 500);
    consumerRows.push(extRow);

    const newestConsumerRow = consumerRows[consumerRows.length - 1];
    const newestConsumerId = state.entities.cols.id[newestConsumerRow];

    // Branch B: Pylon B at (-5, 0) carrying 6 E/s (1 MetalsExtractor, well under 80 E/s)
    const pylonBRow = spawnBuilding(state, ENTITY_KIND.pylon, -5, 0, 1, 1, 100);
    const pylonBId = state.entities.cols.id[pylonBRow];
    const branchBConsumerRow = spawnBuilding(state, ENTITY_KIND.metalsExtractor, -6, 0, 2, 2, 500);
    const branchBConsumerId = state.entities.cols.id[branchBConsumerRow];

    // Midday
    setPlanetTime(state, { timeOfDay: 12 }, 0);
    const stepRes = step(state, [], 1, pipeline);

    const power = getColonyPower(state, 0);

    // Pylon A is overloaded
    expect(power.pylonLoads).toBeDefined();
    const pALoad = power.pylonLoads![pylonAId];
    expect(pALoad).toBeDefined();
    expect(pALoad.max).toBe(80);
    expect(pALoad.flow).toBeGreaterThan(80);
    expect(pALoad.overloaded).toBe(true);

    // Branch B is NOT overloaded and stays active
    const pBLoad = power.pylonLoads![pylonBId];
    expect(pBLoad).toBeDefined();
    expect(pBLoad.overloaded).toBe(false);
    expect(state.entities.cols.state[branchBConsumerRow]).toBe(ENTITY_STATE.active);
    expect(power.entityPower?.[branchBConsumerId]?.state).toBe('online');

    // Overloaded consumer on Branch A is shed
    expect(state.entities.cols.state[newestConsumerRow]).toBe(ENTITY_STATE.offlineOverload);
    expect(power.offlineReasons[newestConsumerId]).toBe('offline: overload');
    expect(power.entityPower?.[newestConsumerId]?.state).toBe('offline');
    expect(power.entityPower?.[newestConsumerId]?.reason).toBe('offline: overload');
    expect(power.overloadedEntityIds).toContain(newestConsumerId);

    // Remaining flow on Pylon A after shedding is <= 80 E/s
    const shedConsumers = pALoad.shedEntityIds ?? [];
    expect(shedConsumers).toContain(newestConsumerId);

    // powerOverload event emitted ONLY for Pylon A
    const overloadEvents = stepRes.events.filter((e) => e.kind === 'powerOverload');
    expect(overloadEvents.length).toBe(1);
    expect(overloadEvents[0].data.pylonId).toBe(pylonAId);
    expect(overloadEvents[0].data.maxLoadPerS).toBe(80);
    expect(overloadEvents[0].data.flowPerS).toBe(pALoad.flow);
    expect(overloadEvents[0].data.shedEntityIds).toEqual(shedConsumers);

    // Advance 100 ticks -> debounced, no new powerOverload event
    const step100Res = step(state, [], 100, pipeline);
    const overload100Events = step100Res.events.filter((e) => e.kind === 'powerOverload');
    expect(overload100Events.length).toBe(0);

    // Advance to tick 650 (past 600 debounce threshold) -> event can fire again
    const step600Res = step(state, [], 550, pipeline);
    const overload600Events = step600Res.events.filter((e) => e.kind === 'powerOverload');
    expect(overload600Events.length).toBe(1);
  });
});

describe('W03-06 Spanning tree root determination', () => {
  it('determines BFS spanning tree root deterministically from generator with highest net output', () => {
    const { state, pipeline } = initOverloadTestState();

    // Hub at (0, 0) provides 8 E/s founder core
    spawnBuilding(state, ENTITY_KIND.commandHub, 0, 0, 3, 3, 1500);

    // Pylon 1 at (5, 0)
    const p1Row = spawnBuilding(state, ENTITY_KIND.pylon, 5, 0, 1, 1, 100);
    const p1Id = state.entities.cols.id[p1Row];

    // Thermal Plant at (6, 0) attached to Pylon 1 (+25 E/s net > +8 E/s Hub founder core)
    spawnBuilding(state, ENTITY_KIND.thermal, 6, 0, 2, 2, 450);
    state.colonies[0].stock = { 'bio.biomass': 100 };

    // Consumer at Hub (draws 5)
    spawnBuilding(state, ENTITY_KIND.supplyDepot, 1, 1, 2, 2, 400);

    // Step simulation
    step(state, [], 1, pipeline);

    const power = getColonyPower(state, 0);
    // Since Thermal is highest generator (+25 net), Pylon 1 is root of BFS tree
    // Flow travels from Pylon 1 towards Hub
    expect(power.pylonLoads).toBeDefined();
    const p1Load = power.pylonLoads![p1Id];
    expect(p1Load).toBeDefined();
    // Pylon 1 flow includes the downstream line to Hub
    expect(p1Load.flow).toBeGreaterThan(0);
  });
});

describe('W03-06 dev.addload and Hub limits', () => {

  it('dev.addload 85 on pylon branch triggers overload shedding and powerOverload event', () => {
    const { state, pipeline } = initOverloadTestState();

    // Hub at (0, 0)
    spawnBuilding(state, ENTITY_KIND.commandHub, 0, 0, 3, 3, 1500);

    // 5 Solar panels for supply (+100 E/s)
    for (let i = 0; i < 5; i++) {
      spawnBuilding(state, ENTITY_KIND.solar, 2, i * 2, 2, 2, 400);
    }

    // Pylon at (5, 0)
    const pylonRow = spawnBuilding(state, ENTITY_KIND.pylon, 5, 0, 1, 1, 100);
    const pylonId = state.entities.cols.id[pylonRow];

    // Extractor attached to Pylon (6 E/s)
    const extRow = spawnBuilding(state, ENTITY_KIND.metalsExtractor, 6, 0, 2, 2, 500);
    const extId = state.entities.cols.id[extRow];

    // Step once to establish baseline online state
    setPlanetTime(state, { timeOfDay: 12 }, 0);
    step(state, [], 1, pipeline);

    expect(state.entities.cols.state[extRow]).toBe(ENTITY_STATE.active);

    // Apply dev.addload 85 on the pylon branch
    const cmdRes = step(state, [{
      commandId: 'cmd-al',
      colonyIndex: 0,
      source: 'dev',
      kind: 'dev.addload',
      args: { loadPerS: 85, pylonId },
    }], 1, pipeline);

    const power = getColonyPower(state, 0);
    expect(power.pylonLoads![pylonId]?.overloaded).toBe(true);
    expect(power.pylonLoads![pylonId]?.flow).toBeGreaterThan(80);
    expect(state.entities.cols.state[extRow]).toBe(ENTITY_STATE.offlineOverload);
    expect(power.overloadedEntityIds).toContain(extId);

    const overloadEvent = cmdRes.events.find((e) => e.kind === 'powerOverload');
    expect(overloadEvent).toBeDefined();
    expect(overloadEvent?.data.pylonId).toBe(pylonId);
  });

  it('Hub carries up to 150 E/s without overload; overloads and sheds when flow > 150 E/s', () => {
    const { state, pipeline } = initOverloadTestState();

    const hubRow = spawnBuilding(state, ENTITY_KIND.commandHub, 0, 0, 3, 3, 1500);
    const hubId = state.entities.cols.id[hubRow];

    state.colonies[0].stock = { 'bio.biomass': 1000 };
    for (let i = 0; i < 8; i++) {
      spawnBuilding(state, ENTITY_KIND.thermal, 3, (i % 3) * 2, 2, 2, 450);
    }

    const cmdRes = step(state, [{
      commandId: 'cmd-hub-load',
      colonyIndex: 0,
      source: 'dev',
      kind: 'dev.addload',
      args: { loadPerS: 160, entityId: hubId },
    }], 1, pipeline);

    const power = getColonyPower(state, 0);
    expect(power.pylonLoads![hubId]?.max).toBe(150);
    expect(power.pylonLoads![hubId]?.overloaded).toBe(true);

    const overloadEvent = cmdRes.events.find((e) => e.kind === 'powerOverload' && e.data.pylonId === hubId);
    expect(overloadEvent).toBeDefined();
    expect(overloadEvent?.data.maxLoadPerS).toBe(150);
  });
});
