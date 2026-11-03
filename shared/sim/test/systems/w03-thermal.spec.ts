import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createRegistryPipeline,
  createState,
  ensureColonyLedger,
  evaluateColonyPower,
  getColonyPower,
  insertRow,
  step,
  ENTITY_KIND,
  ENTITY_STATE,
} from '../../src';

function setupPlanetWithHubAndThermal(initialBiomass = 0) {
  const state = createState({ planetId: 'p-thermal', planetType: 'temperate', seed: 'w03', radius: 16 });
  const colony = ensureColonyLedger({
    index: 0,
    id: 'col-0',
    name: 'Alpha',
    color: 0xff6b00,
    status: 'active',
    changedAt: 0,
  });
  colony.stock['bio.biomass'] = initialBiomass;
  state.colonies.push(colony);

  const pipeline = createRegistryPipeline({ flags: parseWaves('..03') });

  // Spawn completed Command Hub T1 at (0, 0)
  const hubRow = insertRow(state.entities, state.meta.nextEntityId++, 0);
  state.entities.cols.kind[hubRow] = ENTITY_KIND.commandHub;
  state.entities.cols.owner[hubRow] = 0;
  state.entities.cols.q[hubRow] = 0;
  state.entities.cols.r[hubRow] = 0;
  state.entities.cols.footprintW[hubRow] = 3;
  state.entities.cols.footprintD[hubRow] = 3;
  state.entities.cols.hp[hubRow] = 1500;
  state.entities.cols.hpMax[hubRow] = 1500;
  state.entities.cols.state[hubRow] = ENTITY_STATE.active;

  // Spawn completed Thermal Plant T1 at (3, 0) - attached to Hub
  const thermalRow = insertRow(state.entities, state.meta.nextEntityId++, 0);
  const thermalId = state.entities.cols.id[thermalRow];
  state.entities.cols.kind[thermalRow] = ENTITY_KIND.thermal;
  state.entities.cols.owner[thermalRow] = 0;
  state.entities.cols.q[thermalRow] = 3;
  state.entities.cols.r[thermalRow] = 0;
  state.entities.cols.footprintW[thermalRow] = 2;
  state.entities.cols.footprintD[thermalRow] = 2;
  state.entities.cols.hp[thermalRow] = 450;
  state.entities.cols.hpMax[thermalRow] = 450;
  state.entities.cols.state[thermalRow] = ENTITY_STATE.active;

  return { state, pipeline, thermalRow, thermalId, colony };
}

describe('W03-10 Thermal Plant T1 fuel consumption and power', () => {
  it('Test 1: Thermal Plant with 0 biomass is offline: no fuel and yields +0 E/s', () => {
    const { state, pipeline, thermalRow, thermalId } = setupPlanetWithHubAndThermal(0);

    // Initial evaluation with evaluateColonyPower
    const evalSummary = evaluateColonyPower(state, 0, undefined, state.meta.tick, 0);
    expect(state.entities.cols.state[thermalRow]).toBe(ENTITY_STATE.offlineNoFuel);
    expect(evalSummary.offlineReasons[thermalId]).toBe('offline: no fuel');
    expect(evalSummary.thermalNetPerS).toBe(0);
    expect(evalSummary.supply).toBe(8); // Hub Founder Core only

    // Stepping simulation keeps plant offline: no fuel
    step(state, [], 1, pipeline);
    const summary = getColonyPower(state, 0);
    expect(state.entities.cols.state[thermalRow]).toBe(ENTITY_STATE.offlineNoFuel);
    expect(summary.offlineReasons[thermalId]).toBe('offline: no fuel');
    expect(summary.thermalNetPerS).toBe(0);
    expect(summary.supply).toBe(8);
  });

  it('Test 2: Credit 10 biomass -> 5 ticks (1s) generates +25 E/s net, drains 0.375 biomass, and increments pollution', () => {
    const { state, pipeline, thermalRow, colony } = setupPlanetWithHubAndThermal(10);

    // Step 5 ticks (1 second at 5 Hz)
    for (let i = 0; i < 5; i++) {
      step(state, [], 1, pipeline);
    }

    const summary = getColonyPower(state, 0);
    expect(state.entities.cols.state[thermalRow]).toBe(ENTITY_STATE.active);
    expect(summary.thermalGrossPerS).toBe(28);
    expect(summary.thermalInternalDrainPerS).toBe(3);
    expect(summary.thermalNetPerS).toBe(25);
    expect(summary.supply).toBe(33); // 8 founder core + 25 thermal net
    expect(summary.demand).toBe(5); // 5 hub drain
    expect(summary.net).toBe(28);

    // Biomass decreased by 0.375 (from 10 to 9.625)
    expect(colony.stock['bio.biomass']).toBe(9.625);

    // Pollution increased (> 0)
    expect(Number(colony.pollution)).toBeGreaterThan(0);
    expect(Number(colony.pollution)).toBeCloseTo(1.0, 4);
  });
});

describe('W03-10 Thermal Plant T1 depletion and grid connectivity', () => {
  it('Test 3: Drain biomass to 0 -> next step transitions back to offline: no fuel', () => {
    const { state, pipeline, thermalRow, thermalId, colony } = setupPlanetWithHubAndThermal(10);

    // Run for 2 ticks while fueled
    step(state, [], 2, pipeline);
    expect(state.entities.cols.state[thermalRow]).toBe(ENTITY_STATE.active);

    // Drain biomass to 0
    colony.stock['bio.biomass'] = 0;

    // Next step transitions to offline: no fuel
    step(state, [], 1, pipeline);
    const summary = getColonyPower(state, 0);
    expect(state.entities.cols.state[thermalRow]).toBe(ENTITY_STATE.offlineNoFuel);
    expect(summary.offlineReasons[thermalId]).toBe('offline: no fuel');
    expect(summary.thermalNetPerS).toBe(0);
    expect(summary.supply).toBe(8);
  });

  it('marks unattached thermal plant as offline: unpowered', () => {
    const state = createState({ planetId: 'p-thermal-unattached', planetType: 'temperate', seed: 'w03', radius: 32 });
    const colony = ensureColonyLedger({
      index: 0,
      id: 'col-0',
      name: 'Alpha',
      color: 0xff6b00,
      status: 'active',
      changedAt: 0,
    });
    colony.stock['bio.biomass'] = 100;
    state.colonies.push(colony);
    const pipeline = createRegistryPipeline({ flags: parseWaves('..03') });

    // Spawn Hub at (0, 0)
    const hubRow = insertRow(state.entities, state.meta.nextEntityId++, 0);
    state.entities.cols.kind[hubRow] = ENTITY_KIND.commandHub;
    state.entities.cols.owner[hubRow] = 0;
    state.entities.cols.q[hubRow] = 0;
    state.entities.cols.r[hubRow] = 0;
    state.entities.cols.footprintW[hubRow] = 3;
    state.entities.cols.footprintD[hubRow] = 3;
    state.entities.cols.hp[hubRow] = 1500;
    state.entities.cols.state[hubRow] = ENTITY_STATE.active;

    // Spawn Thermal Plant far away at (20, 0)
    const farThermalRow = insertRow(state.entities, state.meta.nextEntityId++, 0);
    const farThermalId = state.entities.cols.id[farThermalRow];
    state.entities.cols.kind[farThermalRow] = ENTITY_KIND.thermal;
    state.entities.cols.owner[farThermalRow] = 0;
    state.entities.cols.q[farThermalRow] = 20;
    state.entities.cols.r[farThermalRow] = 0;
    state.entities.cols.footprintW[farThermalRow] = 2;
    state.entities.cols.footprintD[farThermalRow] = 2;
    state.entities.cols.hp[farThermalRow] = 450;
    state.entities.cols.state[farThermalRow] = ENTITY_STATE.active;

    step(state, [], 1, pipeline);
    const summary = getColonyPower(state, 0);
    expect(state.entities.cols.state[farThermalRow]).toBe(ENTITY_STATE.offlineUnpowered);
    expect(summary.unpoweredEntityIds).toContain(farThermalId);
    expect(summary.offlineReasons[farThermalId]).toBe('offline: unpowered');
    // Unpowered plant does not consume fuel
    expect(colony.stock['bio.biomass']).toBe(100);
  });
});
