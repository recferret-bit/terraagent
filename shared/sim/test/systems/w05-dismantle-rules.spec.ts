import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createRegistryPipeline,
  createState,
  DEPOSIT,
  dismantleTargetReject,
  dismantleTargetRejectByName,
  ensureColonyLedger,
  ENTITY_KIND,
  ENTITY_STATE,
  getWorkJobsMap,
  hexDistance,
  insertRow,
  PREP,
  rowOf,
  setTileDeposit,
  setTilePrep,
  setTileTerrain,
  spawnBuilderUnit,
  spawnHarvesterUnit,
  spawnHqUnit,
  step,
  TERRAIN,
  type PlanetState,
  type SimCommand,
} from '../../src';
import { executeDismantleAtTile } from '../../src/systems/terraform-basic';

/**
 * Owner bug W05: "my drone self-dismantled" and "dismantle of drones works remotely". Dismantle is a worker action on a
 * finished own building, done on site by a Builder Drone or the HQ (`dismantleRule.ts`, `dismantleJob.ts`). A unit is
 * never a target (it was recycled at once, from anywhere, and a drone standing on the hex took the order itself).
 */
const FLAGS = parseWaves('..03');

function world(seed: string) {
  const state = createState({ planetId: `p-${seed}`, planetType: 'temperate', seed, radius: 10 });
  const colony = ensureColonyLedger({ index: 0, id: 'col-0', name: 'A', color: 0xff6b00, status: 'active', active: true, changedAt: 0 });
  for (const k of ['metals.t1', 'minerals.t1', 'bio.biomass', 'bio.water'] as const) colony.stock[k] = 200;
  state.colonies.push(colony);
  const L = state.grid.layers;
  for (let i = 0; i < state.grid.count; i++) {
    setTileTerrain(state, i, TERRAIN.flat, 0);
    setTilePrep(state.grid, i, PREP.prepared, 0);
    setTileDeposit(state, i, DEPOSIT.none, 0, 0);
    L.height[i] = 0;
    L.owner[i] = 0;
  }
  return { state, colony, pipeline: createRegistryPipeline({ flags: FLAGS }) };
}

function building(state: PlanetState, kind: number, q: number, r: number, opts: { owner?: number; st?: number; fp?: number } = {}): number {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, 0);
  const c = state.entities.cols;
  c.kind[row] = kind;
  c.owner[row] = opts.owner ?? 0;
  c.q[row] = c.x[row] = q;
  c.r[row] = c.y[row] = r;
  c.hp[row] = c.hpMax[row] = 300;
  c.tier[row] = 1;
  c.footprintW[row] = c.footprintD[row] = opts.fp ?? 2;
  c.state[row] = opts.st ?? ENTITY_STATE.active;
  c.progress[row] = 1;
  return id;
}

const alive = (s: PlanetState, id: number) => rowOf(s.entities, id) >= 0;
const dismantleCmd = (id: string, q: number, r: number, extra: Record<string, unknown> = {}): SimCommand =>
  ({ commandId: id, colonyIndex: 0, source: 'player', kind: 'enqueueTask', args: { terraform: { op: 'dismantle', tiles: [{ q, r }], ...extra } } });
const run = (s: PlanetState, p: ReturnType<typeof world>['pipeline'], cmds: SimCommand[] = [], n = 1) => {
  const first = step(s, cmds, 1, p);
  for (let i = 1; i < n; i++) step(s, [], 1, p);
  return first;
};
const stock = (s: PlanetState) => ({ ...(s.colonies[0]!.stock as Record<string, number>) });

describe('dismantle target rule (shared by the host and the client preview)', () => {
  it('units, the worker itself, HQ / Hub and unfinished sites are never a target', () => {
    expect(dismantleTargetReject(ENTITY_KIND.builder, ENTITY_STATE.idle)).toBe('cannot_dismantle_unit');
    expect(dismantleTargetReject(ENTITY_KIND.harvester, ENTITY_STATE.idle)).toBe('cannot_dismantle_unit');
    expect(dismantleTargetReject(ENTITY_KIND.builder, ENTITY_STATE.idle, { isSelf: true })).toBe('cannot_dismantle_self');
    expect(dismantleTargetReject(ENTITY_KIND.hq, ENTITY_STATE.idle)).toBe('cannot_dismantle_hq');
    expect(dismantleTargetReject(ENTITY_KIND.commandHub, ENTITY_STATE.active)).toBe('cannot_dismantle_hq');
    expect(dismantleTargetReject(ENTITY_KIND.solar, ENTITY_STATE.constructing)).toBe('dismantle_unfinished');
    expect(dismantleTargetReject(ENTITY_KIND.solar, ENTITY_STATE.active)).toBeNull();
    expect(dismantleTargetReject(ENTITY_KIND.pod, ENTITY_STATE.idle)).toBeNull();
    expect(dismantleTargetRejectByName('builder', ENTITY_STATE.idle)).toBe('cannot_dismantle_unit');
    expect(dismantleTargetRejectByName('solar', ENTITY_STATE.active)).toBeNull();
  });
});

describe('dismantle never targets a unit', () => {
  it('a drone on an empty hex: typed reject, the drone lives, nothing refunded, no job', () => {
    const { state, pipeline } = world('d-unit');
    const builder = spawnBuilderUnit(state, { owner: 0, q: 2, r: 0 });
    const before = stock(state);
    const res = run(state, pipeline, [dismantleCmd('d1', 2, 0)]);
    expect(res.outcomes[0]!.code).toBe('cannot_dismantle_unit');
    expect(alive(state, builder)).toBe(true);
    expect(stock(state)).toEqual(before);
    expect(getWorkJobsMap(state)).toEqual({});
  });

  it('a Harvester and a Builder named by entityId (queue form) are refused as units; the worker itself as self', () => {
    const { state } = world('d-unit-id');
    const builder = spawnBuilderUnit(state, { owner: 0, q: 2, r: 0 });
    const harvester = spawnHarvesterUnit(state, { owner: 0, q: -2, r: 0 });
    expect(executeDismantleAtTile(state, 0, 2, 0, 1, undefined, builder)).toEqual({ ok: false, reason: 'cannot_dismantle_unit' });
    expect(executeDismantleAtTile(state, 0, -2, 0, 1, undefined, harvester)).toEqual({ ok: false, reason: 'cannot_dismantle_unit' });
    expect(executeDismantleAtTile(state, 0, 2, 0, 1, undefined, builder, undefined, builder)).toEqual({ ok: false, reason: 'cannot_dismantle_self' });
    expect(alive(state, builder) && alive(state, harvester)).toBe(true);
  });

  it('the drone standing on a building hex is not the target: the building is (the old self-dismantle)', () => {
    const { state, pipeline } = world('d-self');
    const builder = spawnBuilderUnit(state, { owner: 0, q: 4, r: 0 });
    const ext = building(state, ENTITY_KIND.metalsExtractor, 4, 0);
    const res = run(state, pipeline, [dismantleCmd('d1', 4, 0, { workerId: builder })]);
    expect(res.outcomes[0]!.code).toBeUndefined();
    expect(alive(state, builder)).toBe(true);
    expect(getWorkJobsMap(state).d1).toMatchObject({ mode: 'dismantle', targetEntityId: ext, workerEntityId: builder });
  });

  it('the HQ Drone and the Command Hub are refused as before', () => {
    const { state, pipeline } = world('d-hq');
    spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    building(state, ENTITY_KIND.commandHub, 5, 0, { fp: 3 });
    expect(run(state, pipeline, [dismantleCmd('a', 0, 0)]).outcomes[0]!.code).toBe('cannot_dismantle_hq');
    expect(run(state, pipeline, [dismantleCmd('b', 5, 0)]).outcomes[0]!.code).toBe('cannot_dismantle_hq');
  });
});

describe('dismantle target checks', () => {
  it('a building under construction, a foreign and an unknown entity are typed rejects', () => {
    const { state } = world('d-checks');
    spawnBuilderUnit(state, { owner: 0, q: 0, r: 0 });
    const site = building(state, ENTITY_KIND.solar, 3, 0, { st: ENTITY_STATE.constructing });
    const foreign = building(state, ENTITY_KIND.solar, -3, 0, { owner: 1 });
    expect(executeDismantleAtTile(state, 0, 3, 0)).toEqual({ ok: false, reason: 'dismantle_unfinished' });
    expect(alive(state, site)).toBe(true);
    expect(executeDismantleAtTile(state, 0, -3, 0, 1, undefined, foreign)).toEqual({ ok: false, reason: 'not_own_colony' });
    expect(executeDismantleAtTile(state, 0, -3, 0)).toEqual({ ok: false, reason: 'site_blocked' });
    expect(executeDismantleAtTile(state, 0, 0, 0, 1, undefined, 99999)).toEqual({ ok: false, reason: 'unknown_entity' });
    expect(alive(state, foreign)).toBe(true);
  });

  it('the landed pod is scrapped only with a worker next to it (no remote scrap)', () => {
    const { state } = world('d-pod');
    const pod = building(state, ENTITY_KIND.pod, 0, 0, { fp: 1, st: ENTITY_STATE.idle });
    building(state, ENTITY_KIND.commandHub, 6, 0, { fp: 3 });
    const far = spawnBuilderUnit(state, { owner: 0, q: -6, r: 0 });
    expect(executeDismantleAtTile(state, 0, 0, 0)).toEqual({ ok: false, reason: 'no_worker_in_reach' });
    expect(alive(state, pod)).toBe(true);
    const row = rowOf(state.entities, far);
    state.entities.cols.q[row] = 1;
    state.entities.cols.r[row] = 0;
    expect(executeDismantleAtTile(state, 0, 0, 0)).toMatchObject({ ok: true, entityId: pod });
    expect(alive(state, pod)).toBe(false);
  });
});

describe('dismantle is done on site, never remotely or instantly', () => {
  it('no progress and no refund while the worker is out of reach; the building stays until it arrives', () => {
    const { state, pipeline } = world('d-remote');
    const builder = spawnBuilderUnit(state, { owner: 0, q: -8, r: 0 });
    const ext = building(state, ENTITY_KIND.metalsExtractor, 4, 0);
    const before = stock(state);
    run(state, pipeline, [dismantleCmd('d1', 4, 0)]);
    const bRow = rowOf(state.entities, builder);
    const c = state.entities.cols;
    expect(alive(state, ext)).toBe(true); // ordered, not done
    let sawAway = false;
    for (let i = 0; i < 400 && alive(state, ext); i++) {
      run(state, pipeline);
      const job = getWorkJobsMap(state).d1;
      if (!job) break;
      const d = hexDistance(c.q[bRow], c.r[bRow], 4, 0);
      if (d > 1.5) {
        sawAway = true;
        expect(job.progress).toBe(0);
        expect(job.elapsedTicks).toBe(0);
        expect(stock(state)['metals.t1']).toBe(before['metals.t1']);
        expect(alive(state, ext)).toBe(true);
      }
    }
    expect(sawAway).toBe(true);
    expect(alive(state, ext)).toBe(false); // finished only after the worker walked there and worked
    expect(stock(state)['metals.t1'] - before['metals.t1']).toBeCloseTo(65 * 0.5, 6);
  });
});
