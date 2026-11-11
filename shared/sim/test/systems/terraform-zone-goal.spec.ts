import { parseWaves } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import {
  PREP,
  SimHost,
  TERRAIN,
  colonyTerraformStats,
  createPlanet,
  createRegistryPipeline,
  ensureColonyLedger,
  ensureColonyRecord,
  getColonyGoals,
  getOpenColonyGoals,
  hexIndex,
  isGoalExecutable,
  queueColonyGoal,
  selectDirectorSkills,
  setColonyStock,
  setTilePrep,
  setTileTerrain,
  spawnHqUnit,
  startBuildingConstruction,
} from '../../src';

describe('terraform_zone goal executor & director skills', () => {
  it('registers terraform_zone on W05+ and drives owned ground through Grade → Irrigate → Seed → Living', () => {
    const flags = parseWaves('..08');
    expect(isGoalExecutable('terraform_zone', flags)).toBe(true);
    expect(isGoalExecutable('terraform_zone', parseWaves('..04'))).toBe(false);

    const pipeline = createRegistryPipeline({ flags });
    const data = pipeline.config.data;
    const host = new SimHost(pipeline);
    const state = createPlanet({ type: 'flat', seed: 'tf-zone-goal', radius: 14 });
    state.grid.layers.terrain.fill(TERRAIN.flat);
    state.grid.layers.prep.fill(PREP.prepared);
    state.grid.layers.owner.fill(0);
    state.grid.layers.height.fill(0);
    state.grid.layers.deposit.fill(0);

    const col = ensureColonyLedger(ensureColonyRecord(state, 0, 0), { baseCap: 2000 });
    col.status = 'active';
    col.aiEnabled = true;
    col.stage = 4;
    col.unlockStage = 4;
    setColonyStock(state, 0, {
      'metals.t1': 400,
      'minerals.t1': 400,
      'bio.water': 400,
      'bio.biomass': 200,
    });

    spawnHqUnit(state, { owner: 0, q: -2, r: 0 });
    startBuildingConstruction(state, { owner: 0, building: 'commandHub', q: 0, r: 0, instant: true, costOverride: {}, data });
    startBuildingConstruction(state, { owner: 0, building: 'solar', q: 3, r: 0, instant: true, costOverride: {}, data });
    startBuildingConstruction(state, { owner: 0, building: 'wind', q: 3, r: 3, instant: true, costOverride: {}, data });
    startBuildingConstruction(state, { owner: 0, building: 'depot', q: -4, r: 3, instant: true, costOverride: {}, data });
    startBuildingConstruction(state, { owner: 0, building: 'turret', q: 0, r: 4, instant: true, costOverride: {}, data });

    const hx = hexIndex(state.grid.radius);
    setTileTerrain(state.grid, hx.indexOf(-3, 0), TERRAIN.flat);
    setTilePrep(state.grid, hx.indexOf(-3, 0), PREP.flat);
    setTileTerrain(state.grid, hx.indexOf(-3, 1), TERRAIN.flat);
    setTilePrep(state.grid, hx.indexOf(-3, 1), PREP.prepared);

    host.load(state);
    const qRes = queueColonyGoal(state, 0, {
      goal: 'terraform_zone',
      params: { target: 2, q: -3, r: 0, radius: 4 },
    });
    expect(qRes.ok).toBe(true);

    for (let i = 0; i < 120; i++) host.step(5);
    const stats = colonyTerraformStats(state, 0);
    expect(stats.livingTiles).toBeGreaterThanOrEqual(2);
    expect(getOpenColonyGoals(state, 0)).toHaveLength(0);
  });

  it('holds Water/Minerals reserves instead of starving colony stock when Water is low', () => {
    const flags = parseWaves('..08');
    const pipeline = createRegistryPipeline({ flags });
    const host = new SimHost(pipeline);
    const state = createPlanet({ type: 'flat', seed: 'tf-zone-reserve', radius: 10 });
    state.grid.layers.terrain.fill(TERRAIN.flat);
    state.grid.layers.prep.fill(PREP.prepared);
    state.grid.layers.owner.fill(0);
    state.grid.layers.height.fill(0);
    state.grid.layers.deposit.fill(0);

    const col = ensureColonyLedger(ensureColonyRecord(state, 0, 0), { baseCap: 1000 });
    col.status = 'active';
    col.aiEnabled = true;
    col.stage = 4;
    col.unlockStage = 4;
    setColonyStock(state, 0, { 'metals.t1': 100, 'minerals.t1': 100, 'bio.water': 10 });
    spawnHqUnit(state, { owner: 0, q: 0, r: 0 });

    host.load(state);
    queueColonyGoal(state, 0, { goal: 'terraform_zone', params: { target: 2, q: 0, r: 0, radius: 3 } });
    for (let i = 0; i < 10; i++) host.step(1);

    expect(colonyTerraformStats(state, 0).livingTiles).toBe(0);
    expect(getColonyGoals(state, 0)[0]?.detail).toContain('Holding Water/Minerals reserves');
  });

  it('offers defence on W07+, terraforming on W05+, and diplomacy when raidsPermitted is true on W18+', () => {
    const waves = new Set(parseWaves('..18').list);
    const skills = selectDirectorSkills({ waves, stage: 4, raidsPermitted: true }).map((s) => s.id);
    expect(skills).toContain('defence');
    expect(skills).toContain('terraforming');
    expect(skills).toContain('diplomacy');
  });
});
