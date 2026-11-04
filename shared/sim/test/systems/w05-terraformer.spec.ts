import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  calculateUnitDemand,
  claimTerritoryRadius,
  collectWorkLoad,
  compileData,
  createRegistryPipeline,
  createState,
  ensureColonyLedger,
  ensureColonyRecord,
  ENTITY_KIND,
  ENTITY_STATE,
  getUnitCommand,
  hexIndex,
  isWorkerEligibleForJob,
  PREP,
  revealVision,
  rowOf,
  setField,
  startBuildingConstruction,
  step,
  TERRAIN,
} from '../../src';

function setupColonyWithHub(seed = 'w05-tf-test') {
  const flags = parseWaves('..05');
  const data = compileData(flags);
  const state = createState({ planetId: 'p-w05-02', planetType: 'temperate', seed, radius: 12 });
  state.grid.layers.terrain.fill(TERRAIN.flat);
  state.grid.layers.height.fill(0);
  state.grid.layers.prep.fill(PREP.wild);

  const colony = ensureColonyLedger(ensureColonyRecord(state, 0, 0));
  colony.status = 'active';
  colony.stock['metals.t1'] = 400;
  colony.stock['minerals.t1'] = 400;
  colony.stock['bio.biomass'] = 400;
  colony.stock['bio.water'] = 400;

  const hubRes = startBuildingConstruction(state, {
    owner: 0,
    building: 'commandHub',
    q: 0,
    r: 0,
    instant: true,
    costOverride: {},
    data,
  });
  expect(hubRes.ok).toBe(true);
  claimTerritoryRadius(state, { colonyId: 0, q: 0, r: 0, tick: 0, data });
  revealVision(state, 0, 0, 0, 10, 0);

  const pipeline = createRegistryPipeline({ flags, data });
  return { state, colony, data, pipeline };
}

describe('W05-02 Terraformer drone in sim', () => {
  it('orders a Terraformer at the Hub -> it spawns and takes the next Terraform-lane entry at 1.0x rate', () => {
    const { state, pipeline } = setupColonyWithHub('w05-02-spawn');
    const idx = hexIndex(state.grid.radius);
    const targetTile = idx.indexOf(3, 0);
    expect(state.grid.layers.prep[targetTile]).toBe(PREP.wild);

    // Enqueue a manual Terraform-lane order (Grade at (3, 0)) while no terraform worker is on the map
    const enqTf = step(
      state,
      [
        {
          commandId: 'tf-grade-1',
          colonyIndex: 0,
          source: 'player',
          kind: 'enqueueTask',
          args: { terraform: { op: 'grade', tiles: [{ q: 3, r: 0 }] } },
        },
        {
          commandId: 'order-tf-drone',
          colonyIndex: 0,
          source: 'player',
          kind: 'enqueueTask',
          args: { buildUnit: { unit: 'terraformer', count: 1 } },
        },
      ],
      1,
      pipeline,
    );
    expect(enqTf.outcomes.every((o) => !o.code)).toBe(true);

    // Step 59 single ticks so the 12 s (60-tick) Terraformer Drone finishes printing on tick 60
    for (let i = 0; i < 59; i++) step(state, [], 1, pipeline);

    let tfEntityId = -1;
    let tfRow = -1;
    for (let r = 0; r < state.entities.count; r++) {
      if (state.entities.cols.kind[r] === ENTITY_KIND.terraformer) {
        tfRow = r;
        tfEntityId = state.entities.cols.id[r];
        break;
      }
    }
    expect(tfEntityId).toBeGreaterThan(0);
    expect(state.entities.cols.workRate[tfRow]).toBeCloseTo(1.0, 5);
    expect(getUnitCommand(state, tfEntityId)).toMatchObject({
      kind: 'terraform',
      q: 3,
      r: 0,
    });

    // Step 15 more 1-tick steps so the Terraformer finishes the 3 s (15 ticks at 1.0x) Grade op
    for (let i = 0; i < 15; i++) step(state, [], 1, pipeline);
    expect(state.grid.layers.prep[targetTile]).toBe(PREP.prepared);
  });
});

describe('W05-02 Terraformer eligibility & power drain', () => {
  it('enforces terraform-lane-only eligibility and 2.5 E/s + op energy power drain', () => {
    expect(isWorkerEligibleForJob(ENTITY_KIND.terraformer, 1, { kind: 'terraform', op: 'grade' })).toBe(true);
    expect(isWorkerEligibleForJob(ENTITY_KIND.terraformer, 1, { kind: 'terraform', op: 'level' })).toBe(true);
    expect(isWorkerEligibleForJob(ENTITY_KIND.terraformer, 1, { kind: 'terraform', op: 'deepReclaim' })).toBe(false);
    expect(isWorkerEligibleForJob(ENTITY_KIND.terraformer, 2, { kind: 'terraform', op: 'deepReclaim' })).toBe(true);
    expect(isWorkerEligibleForJob(ENTITY_KIND.terraformer, 1, { kind: 'linkedPrep', op: 'grade' })).toBe(true);
    expect(isWorkerEligibleForJob(ENTITY_KIND.terraformer, 1, { kind: 'build', tier: 1 })).toBe(false);
    expect(isWorkerEligibleForJob(ENTITY_KIND.terraformer, 1, { kind: 'terraform', op: 'dismantle' })).toBe(false);
    expect(isWorkerEligibleForJob(ENTITY_KIND.terraformer, 1, { kind: 'terraform', op: 'repair' })).toBe(false);

    const { state, data, pipeline } = setupColonyWithHub('w05-02-drain');
    step(
      state,
      [
        {
          commandId: 'order-tf-2',
          colonyIndex: 0,
          source: 'player',
          kind: 'enqueueTask',
          args: { buildUnit: { unit: 'terraformer', count: 1 } },
        },
      ],
      65,
      pipeline,
    );

    let tfEntityId = -1;
    for (let r = 0; r < state.entities.count; r++) {
      if (state.entities.cols.kind[r] === ENTITY_KIND.terraformer) {
        tfEntityId = state.entities.cols.id[r];
        break;
      }
    }
    expect(tfEntityId).toBeGreaterThan(0);
    const tfRow = rowOf(state.entities, tfEntityId);

    // Active unit demand = 2.5 E/s
    setField(state.entities, tfRow, 'state', ENTITY_STATE.moving, state.meta.tick);
    expect(calculateUnitDemand(state, 0, data)).toBeCloseTo(2.5, 5);

    // Enqueue a Grade op (20 E over 3 s = 6.6667 E/s at 1.0x) on the tile right next to the Terraformer
    const tfQ = state.entities.cols.q[tfRow];
    const tfR = state.entities.cols.r[tfRow];
    step(
      state,
      [
        {
          commandId: 'tf-adj-grade',
          colonyIndex: 0,
          source: 'player',
          kind: 'enqueueTask',
          args: { terraform: { op: 'grade', tiles: [{ q: tfQ + 1, r: tfR }] } },
        },
      ],
      2,
      pipeline,
    );

    expect(state.entities.cols.state[tfRow]).toBe(ENTITY_STATE.working);
    const workLoad = collectWorkLoad(state, 0, data);
    expect(workLoad.demand).toBeCloseTo(20 / 3, 3);
    expect(calculateUnitDemand(state, 0, data) + workLoad.demand).toBeCloseTo(2.5 + 20 / 3, 3);
  });
});
