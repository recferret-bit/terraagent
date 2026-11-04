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
  notifyPylonOrBuildingRemoved,
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

describe('W03-05 Power graph v2 — acceptance check', () => {
  it('extractor 12 tiles from Hub: OFFLINE (no grid) -> 2 pylons -> ONLINE -> destroy middle pylon -> powerSevered & OFFLINE', () => {
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

    // Hub at (0, 0)
    spawnBuilding(state, ENTITY_KIND.commandHub, 0, 0, 3, 3, 1500);
    // Solar at (2, 0) to provide plenty of surplus
    spawnBuilding(state, ENTITY_KIND.solar, 2, 0, 2, 2, 400);
    // Extractor at (12, 0) with no pylons
    const extRow = spawnBuilding(state, ENTITY_KIND.metalsExtractor, 12, 0, 2, 2, 500);
    const extId = state.entities.cols.id[extRow];

    // Midday so solar is online
    setPlanetTime(state, { timeOfDay: 12 }, 0);
    step(state, [], 1, pipeline);

    const pInitial = getColonyPower(state, 0);
    expect(state.entities.cols.state[extRow]).toBe(ENTITY_STATE.offlineNoGrid);
    expect(pInitial.offlineReasons[extId]).toBe('offline: no grid');
    expect(pInitial.entityPower?.[extId]?.state).toBe('offline');
    expect(pInitial.entityPower?.[extId]?.reason).toBe('offline: no grid');
    expect(pInitial.unpoweredEntityIds).toContain(extId);

    // Chain 2 pylons at (5, 0) and (10, 0)
    const pylon1Row = spawnBuilding(state, ENTITY_KIND.pylon, 5, 0, 1, 1, 100);
    const pylon1Id = state.entities.cols.id[pylon1Row];
    spawnBuilding(state, ENTITY_KIND.pylon, 10, 0, 1, 1, 100);

    step(state, [], 1, pipeline);

    const pConnected = getColonyPower(state, 0);
    expect(state.entities.cols.state[extRow]).toBe(ENTITY_STATE.active);
    expect(pConnected.entityPower?.[extId]?.state).toBe('online');
    expect(pConnected.entityPower?.[extId]?.component).toBe(0);
    expect(pConnected.unpoweredEntityIds).not.toContain(extId);

    // Destroy middle pylon and verify immediate recompute via notifyPylonOrBuildingRemoved
    state.entities.cols.hp[pylon1Row] = 0;
    notifyPylonOrBuildingRemoved(state, pylon1Id, state.meta.tick);
    const pNotified = getColonyPower(state, 0);
    expect(pNotified.entityPower?.[extId]?.state).toBe('offline');

    // Step pipeline and check powerSevered event
    const stepRes = step(state, [], 1, pipeline);

    const pSevered = getColonyPower(state, 0);
    expect(state.entities.cols.state[extRow]).toBe(ENTITY_STATE.offlineNoGrid);
    expect(pSevered.offlineReasons[extId]).toBe('offline: no grid');
    expect(pSevered.entityPower?.[extId]?.state).toBe('offline');

    const severedEvent = stepRes.events.find((e) => e.kind === 'powerSevered');
    expect(severedEvent).toBeDefined();
    expect(severedEvent?.data.pylonId).toBe(pylon1Id);
    expect(severedEvent?.data.severedCount).toBeGreaterThanOrEqual(1);
    expect(severedEvent?.data.severedEntityIds).toContain(extId);
  });
});

describe('W03-05 Wind Turbine T1 output & overrides', () => {
  it('produces +12 net at windFactor 1.0, scales with windFactor override, operates day and night', () => {
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
    spawnBuilding(state, ENTITY_KIND.wind, 3, 0, 2, 2, 350);

    // Explicit medium wind for the baseline.
    (state.colonies[0] as { windFactorOverride?: number }).windFactorOverride = 1;
    step(state, [], 1, pipeline);
    const p1 = getColonyPower(state, 0);
    expect(p1.windGrossPerS).toBe(13);
    expect(p1.windInternalDrainPerS).toBe(1);
    expect(p1.windNetPerS).toBe(12);

    // Override to low wind factor 0.25
    (state.colonies[0] as { windFactorOverride?: number }).windFactorOverride = 0.25;
    step(state, [], 1, pipeline);
    const pMin = getColonyPower(state, 0);
    expect(pMin.windGrossPerS).toBe(4);
    expect(pMin.windNetPerS).toBe(3);

    // Override to high wind factor 1.5
    (state.colonies[0] as { windFactorOverride?: number }).windFactorOverride = 1.5;
    step(state, [], 1, pipeline);
    const pMax = getColonyPower(state, 0);
    expect(pMax.windGrossPerS).toBe(19);
    expect(pMax.windNetPerS).toBe(18);

    // Operates at night (midnight)
    setPlanetTime(state, { timeOfDay: 0 }, state.meta.tick);
    step(state, [], 1, pipeline);
    const pNight = getColonyPower(state, 0);
    expect(pNight.windNetPerS).toBe(18);
    expect(pNight.supply).toBeGreaterThanOrEqual(18);
  });
});

describe('W03-05 Capacitor Bank T1 charging & brownout mitigation', () => {
  it('charges on daytime surplus and discharges on deficit up to 30 E/s to prevent brownout', () => {
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
    spawnBuilding(state, ENTITY_KIND.solar, 2, 0, 2, 2, 400);
    const capRow = spawnBuilding(state, ENTITY_KIND.capacitor, 3, 0, 2, 2, 300);

    // Midday surplus -> charges capacitor
    setPlanetTime(state, { timeOfDay: 12 }, 0);
    step(state, [], 10, pipeline); // 10 ticks = 2s

    const pCharged = getColonyPower(state, 0);
    expect(pCharged.capacitorStoredE).toBeGreaterThan(0);
    expect(pCharged.capacitorCapacityE).toBe(1500);

    // Set stored energy manually to 500 E and switch to midnight with a heavy consumer
    state.entities.cols.cell[capRow] = 500;
    const extRow = spawnBuilding(state, ENTITY_KIND.metalsExtractor, 0, 3, 2, 2, 500);
    spawnBuilding(state, ENTITY_KIND.metalsExtractor, -3, 0, 2, 2, 500);
    setPlanetTime(state, { timeOfDay: 0 }, state.meta.tick);

    // Hub (+16), Solar (offline at night), Capacitor drain (2), Hub drain (7), 2 Extractors (8 each)
    // Demand = 7 + 2 + 16 = 25. Gen supply = 16. Deficit = 9 E/s (no HQ cell here: the bank carries it all).
    step(state, [], 1, pipeline);

    const pNight = getColonyPower(state, 0);
    expect(pNight.capacitorDischargePerS).toBeCloseTo(9, 1);
    expect(pNight.brownout).toBe(false);
    expect(state.entities.cols.state[extRow]).toBe(ENTITY_STATE.active);
    expect(state.entities.cols.cell[capRow]).toBeLessThan(500);
  });
});

describe('W03-05 Isolated power components', () => {
  it('supports isolated power island powered by local wind turbine', () => {
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

    // Isolated component at (20, 20): Pylon, Wind turbine, and Extractor
    spawnBuilding(state, ENTITY_KIND.pylon, 20, 20, 1, 1, 100);
    spawnBuilding(state, ENTITY_KIND.wind, 21, 20, 2, 2, 350);
    const islandExt = spawnBuilding(state, ENTITY_KIND.metalsExtractor, 22, 20, 2, 2, 500);
    const islandExtId = state.entities.cols.id[islandExt];

    step(state, [], 1, pipeline);

    const power = getColonyPower(state, 0);
    expect(power.components?.length).toBe(2);
    expect(power.entityPower?.[islandExtId]?.state).toBe('online');
    expect(power.entityPower?.[islandExtId]?.component).toBe(1);
    expect(state.entities.cols.state[islandExt]).toBe(ENTITY_STATE.active);
  });
});
