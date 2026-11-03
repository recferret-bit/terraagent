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
} from '../../src';

function spawnBuilding(
  state: ReturnType<typeof createState>,
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

function spawnHarvester(state: ReturnType<typeof createState>, active = true): number {
  const row = insertRow(state.entities, state.meta.nextEntityId++, 1);
  const cols = state.entities.cols;
  cols.kind[row] = ENTITY_KIND.harvester;
  cols.owner[row] = 0;
  cols.hp[row] = 160;
  cols.hpMax[row] = 160;
  cols.state[row] = active ? ENTITY_STATE.working : ENTITY_STATE.idle;
  return row;
}

describe('W03-07 Per-component brownout shedding', () => {
  it('island A in deficit sheds; island B in surplus keeps running', () => {
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

    // Component A (Hub component at 0, 0): Hub provides +8, draws 5. Extractor draws 6.
    // Total supply = 8, total demand = 11 -> Deficit = 3 -> Extractor A sheds.
    spawnBuilding(state, ENTITY_KIND.commandHub, 0, 0, 3, 3, 1500);
    const extARow = spawnBuilding(state, ENTITY_KIND.metalsExtractor, 3, 0, 2, 2, 500);
    const extAId = state.entities.cols.id[extARow];

    // Component B (Island B at 20, 20): Pylon (0.5) + Wind (+15 net) + Extractor (6).
    // Total supply = 15, total demand = 6.5 -> Surplus = 8.5 -> Extractor B stays active.
    spawnBuilding(state, ENTITY_KIND.pylon, 20, 20, 1, 1, 100);
    spawnBuilding(state, ENTITY_KIND.wind, 21, 20, 2, 2, 350);
    const extBRow = spawnBuilding(state, ENTITY_KIND.metalsExtractor, 22, 20, 2, 2, 500);
    const extBId = state.entities.cols.id[extBRow];

    const res = step(state, [], 1, pipeline);
    const power = getColonyPower(state, 0);

    expect(power.components?.length).toBe(2);
    // Island A sheds Extractor A
    expect(power.components?.[0].shedEntityIds).toContain(extAId);
    expect(state.entities.cols.state[extARow]).toBe(ENTITY_STATE.offlineBrownout);

    // Island B keeps running
    expect(power.components?.[1].shedEntityIds).toEqual([]);
    expect(state.entities.cols.state[extBRow]).toBe(ENTITY_STATE.active);
    expect(power.entityPower?.[extBId]?.state).toBe('online');

    // brownoutShed event emitted for Component A
    const shedEvent = res.events.find((e) => e.kind === 'brownoutShed');
    expect(shedEvent).toBeDefined();
    expect(shedEvent?.data.componentId).toBe(0);
    expect(shedEvent?.data.shedEntityIds).toContain(extAId);
    expect(shedEvent?.data.groups).toContain(3);
    expect(shedEvent?.data.deficitPerS).toBe(3);
  });

  it('robot drain counts only on the Hub component, not on isolated island components', () => {
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

    // Hub component at (0, 0)
    spawnBuilding(state, ENTITY_KIND.commandHub, 0, 0, 3, 3, 1500);

    // Island B at (20, 20): Pylon (0.5) + Wind (+15 net) + Extractor (6) -> demand 6.5
    spawnBuilding(state, ENTITY_KIND.pylon, 20, 20, 1, 1, 100);
    spawnBuilding(state, ENTITY_KIND.wind, 21, 20, 2, 2, 350);
    const extBRow = spawnBuilding(state, ENTITY_KIND.metalsExtractor, 22, 20, 2, 2, 500);

    // Spawn 4 active Harvesters (4 * 1.5 = 6 E/s robot demand)
    spawnHarvester(state, true);
    spawnHarvester(state, true);
    spawnHarvester(state, true);
    spawnHarvester(state, true);

    step(state, [], 1, pipeline);
    const power = getColonyPower(state, 0);

    // Island B demand remains 6.5 (does not pay robot demand)
    const compB = power.components?.[1];
    expect(compB).toBeDefined();
    expect(compB?.demand).toBe(6.5);
    expect(compB?.rawDemand).toBe(6.5);
    expect(compB?.shedEntityIds).toEqual([]);
    expect(state.entities.cols.state[extBRow]).toBe(ENTITY_STATE.active);

    // Hub component pays the 6 E/s unit demand + 5 Hub drain = 11 E/s
    const compA = power.components?.[0];
    expect(compA?.rawDemand).toBe(11);
  });
});

describe('W03-07 nightSurvived event', () => {
  it('emits nightSurvived at dawn when night survived without shedding beyond group 1', () => {
    const state = createState({ planetId: 'p1', planetType: 'temperate', seed: 'w03', radius: 16 });
    state.colonies.push({
      index: 0,
      id: 'col-0',
      name: 'Alpha',
      color: 0xff6b00,
      status: 'active',
      changedAt: 0,
    });
    const pipeline = createRegistryPipeline({ flags: parseWaves('..03') });

    spawnBuilding(state, ENTITY_KIND.commandHub, 0, 0, 3, 3, 1500);
    spawnBuilding(state, ENTITY_KIND.wind, 3, 0, 2, 2, 350); // +15 net at night
    const capRow = spawnBuilding(state, ENTITY_KIND.capacitor, 0, 3, 2, 2, 300);
    state.entities.cols.cell[capRow] = 500;

    // Start at night (midnight)
    setPlanetTime(state, { timeOfDay: 0 }, 0);
    step(state, [], 1, pipeline);

    const pNight = getColonyPower(state, 0);
    expect(pNight.phase).toBe('night');
    expect(pNight.shedGroupsActive.filter((g) => g > 1)).toEqual([]);

    // Transition to dawn (solar hour 6 = day)
    setPlanetTime(state, { timeOfDay: 6 }, state.meta.tick);
    const dawnRes = step(state, [], 1, pipeline);

    const nightSurvivedEvent = dawnRes.events.find((e) => e.kind === 'nightSurvived');
    expect(nightSurvivedEvent).toBeDefined();
    expect(nightSurvivedEvent?.data.dayNumber).toBeGreaterThanOrEqual(0);
    expect(nightSurvivedEvent?.data.capacitorChargeRemainingE).toBeGreaterThanOrEqual(0);
  });

  it('does NOT emit nightSurvived if shedding beyond group 1 occurred during the night', () => {
    const state = createState({ planetId: 'p1', planetType: 'temperate', seed: 'w03', radius: 16 });
    state.colonies.push({
      index: 0,
      id: 'col-0',
      name: 'Alpha',
      color: 0xff6b00,
      status: 'active',
      changedAt: 0,
    });
    const pipeline = createRegistryPipeline({ flags: parseWaves('..03') });

    // Hub (+8 supply, 5 drain) + Extractor (6 drain, group 3) = 11 demand -> deficit 3
    spawnBuilding(state, ENTITY_KIND.commandHub, 0, 0, 3, 3, 1500);
    spawnBuilding(state, ENTITY_KIND.metalsExtractor, 3, 0, 2, 2, 500);

    // Midnight -> group 3 is shed
    setPlanetTime(state, { timeOfDay: 0 }, 0);
    step(state, [], 1, pipeline);

    const pNight = getColonyPower(state, 0);
    expect(pNight.shedGroupsActive).toContain(3);

    // Transition to dawn
    setPlanetTime(state, { timeOfDay: 6 }, state.meta.tick);
    const dawnRes = step(state, [], 1, pipeline);

    const nightSurvivedEvent = dawnRes.events.find((e) => e.kind === 'nightSurvived');
    expect(nightSurvivedEvent).toBeUndefined();
  });
});
