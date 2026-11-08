import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createRegistryPipeline,
  createState,
  DEPOSIT,
  ENTITY_KIND,
  ENTITY_STATE,
  getColonyQueue,
  getFootprintTileIndices,
  hexDistance,
  hexIndex,
  placeBuildingOrder,
  PREP,
  rowOf,
  setColonyStock,
  setTileDeposit,
  setTilePrep,
  setTileTerrain,
  spawnWorkerUnit,
  spawnHqUnit,
  startBuildingConstruction,
  step,
  TERRAIN,
  type WorkerTargetAssignment,
  type PlanetState,
  type SimCommand,
} from '../../src';

/**
 * The `anchors` tile layer is the territory claim count (W01-17), never "a building stands here". Regression: W02
 * construction wrote `anchors = 1` under a footprint and read `anchors !== 0` as occupied, so once a real Command Hub
 * claimed its territory every tile in it looked occupied (builds, TERRAFORM and harvest stand tiles refused) and a
 * demolish zeroed the territory count.
 */

const HUB = { q: 3, r: 0 };
let seq = 0;
const cmd = (kind: string, args: unknown): SimCommand => ({ commandId: `ta_${++seq}`, colonyIndex: 0, source: 'player', kind, args });

/** A level wild Flat world with colony 0 (founding), its HQ at (0, 0), and a W01 Command Hub completed at `HUB`. */
function colonyWithClaimedTerritory() {
  const state = createState({ planetId: 'p-ta', planetType: 'temperate', seed: 'territory-anchors', radius: 14 });
  const L = state.grid.layers;
  for (let k = 0; k < state.grid.count; k++) {
    setTileTerrain(state, k, TERRAIN.flat, 0);
    setTilePrep(state.grid, k, PREP.wild, 0);
    setTileDeposit(state, k, DEPOSIT.none, 0, 0);
    L.height[k] = 0;
    L.subDeposit[k] = 0;
    L.owner[k] = -1;
  }
  state.colonies[0] = {
    index: 0, id: 'col_0', name: 'Alpha', color: 0xff6b00, status: 'founding',
    caps: { metals: 600, minerals: 350, energy: 0, bio: 400, item: 0 }, changedAt: 0,
  };
  setColonyStock(state, 0, { 'metals.t1': 600, 'minerals.t1': 350, 'bio.biomass': 200, 'bio.water': 200 });
  spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
  const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });
  const hx = hexIndex(state.grid.radius);
  const at = (q: number, r: number) => hx.indexOf(q, r);
  for (let dr = -1; dr <= 1; dr++) for (let dq = -1; dq <= 1; dq++) setTilePrep(state.grid, at(HUB.q + dq, HUB.r + dr), PREP.prepared);

  // The real W01 path: placeBuildingOrder → construction site → applyHubCompletionEffects → claimTerritoryRadius.
  expect(placeBuildingOrder(state, { colonyId: 0, q: HUB.q, r: HUB.r, buildingKind: 'commandHub' }).ok).toBe(true);
  const run = (cmds: SimCommand[] = [], n = 1) => step(state, cmds, n, pipeline);
  run([], 120);
  return { state, at, run };
}

const hubRow = (state: PlanetState): number => {
  for (let r = 0; r < state.entities.count; r++) if (state.entities.cols.kind[r] === ENTITY_KIND.commandHub) return r;
  return -1;
};

describe('anchors = territory only; building occupancy comes from the entities', () => {
  it('a completed Hub claims territory with anchors, and building, TERRAFORM, harvest and demolish inside it work', () => {
    const { state, at, run } = colonyWithClaimedTerritory();
    const L = state.grid.layers;
    expect(state.entities.cols.state[hubRow(state)]).toBe(ENTITY_STATE.active);
    // Precondition: the claim set the territory anchor count (otherwise this spec proves nothing).
    for (const [q, r] of [[6, 4], [0, 5], [-2, 2], [8, -3]] as const) {
      expect(hexDistance(HUB.q, HUB.r, q, r)).toBeLessThanOrEqual(10);
      expect(L.owner[at(q, r)]).toBe(0);
      expect(L.anchors[at(q, r)]).toBeGreaterThanOrEqual(1);
    }

    // (a) a Metals Extractor on a metals deposit inside territory is accepted and starts (not "tile occupied").
    setTileDeposit(state, at(6, 4), DEPOSIT.metals, 10000, state.meta.tick);
    const placed = run([cmd('enqueueTask', { task: { kind: 'build', building: 'metalsExtractor', q: 6, r: 4 } })]);
    expect(placed.outcomes[0]?.code).toBeUndefined();
    const entry = getColonyQueue(state, 0).find((e) => e.task.kind === 'build' && e.task.building === 'metalsExtractor');
    expect(entry?.waitDetail ?? '').not.toContain('occupied');
    expect(entry?.state).toBe('in_progress');
    const extractorId = entry!.entityId!;
    expect(rowOf(state.entities, extractorId)).toBeGreaterThanOrEqual(0);
    const fp = getFootprintTileIndices(state, 6, 4, 2, 2).indices;
    const anchorsBefore = fp.map((i) => L.anchors[i]);
    expect(anchorsBefore.every((n) => n >= 1)).toBe(true); // placing a building does not write the territory count

    // (b) TERRAFORM work on a forest tile inside territory is accepted.
    setTileTerrain(state, at(-2, 2), TERRAIN.forest, state.meta.tick);
    const tf = run([cmd('enqueueTask', { terraform: { op: 'work', intent: 'terraform', tiles: [{ q: -2, r: 2 }] } })]);
    expect(tf.outcomes[0]?.code).toBeUndefined();
    const jobs = (state.blobs.workJobs?.value as { byId?: Record<string, { tileIdx: number }> } | undefined)?.byId ?? {};
    expect(Object.values(jobs).some((j) => j.tileIdx === at(-2, 2))).toBe(true);

    // (c) a Worker finds the free deposit inside territory and a free stand tile next to it (the Extractor's deposit,
    // under a building, is not a target).
    setTileDeposit(state, at(8, -3), DEPOSIT.metals, 10000, state.meta.tick);
    const harvId = spawnWorkerUnit(state, { owner: 0, q: 8, r: -1 });
    run([], 3);
    const assignment = (state.blobs.harvest?.value as { assignments?: Record<number, WorkerTargetAssignment> } | undefined)?.assignments?.[harvId];
    expect(assignment).toMatchObject({ mode: 'harvest', tileIdx: at(8, -3) });
    expect(hexDistance(assignment!.standQ!, assignment!.standR!, 8, -3)).toBe(1);

    // (d) demolishing the Extractor leaves the territory anchor count of its tiles intact.
    const dem = run([cmd('demolish', { entityId: extractorId })]);
    expect(dem.outcomes[0]?.code).toBeUndefined();
    expect(rowOf(state.entities, extractorId)).toBe(-1);
    expect(fp.map((i) => L.anchors[i])).toEqual(anchorsBefore);
    expect(fp.every((i) => L.owner[i] === 0)).toBe(true);
  });

  it('a tile under a building is still occupied for W02 construction (by its footprint, not by anchors)', () => {
    const { state, at, run } = colonyWithClaimedTerritory();
    run([cmd('enqueueTask', { task: { kind: 'build', building: 'solar', q: 0, r: 5 } })]);
    const first = getColonyQueue(state, 0).find((e) => e.task.kind === 'build' && e.task.building === 'solar');
    expect(first?.state).toBe('in_progress');
    // A second Solar overlapping (1, 5) of the first one's 2x2 footprint is refused as occupied; next to it, accepted.
    expect(rowOf(state.entities, first!.entityId!)).toBeGreaterThanOrEqual(0);
    const solar = (q: number, r: number) => startBuildingConstruction(state, { owner: 0, building: 'solar', q, r, workRate: 1.5, costOverride: {} });
    expect(solar(1, 5)).toEqual({ ok: false, code: 'site_blocked', detail: 'tile occupied' });
    expect(solar(2, 5)).toMatchObject({ ok: true });
    expect(state.grid.layers.anchors[at(1, 5)]).toBeGreaterThanOrEqual(1); // territory, unchanged by the build
  });
});
