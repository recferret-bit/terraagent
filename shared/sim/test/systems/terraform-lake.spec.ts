import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createRegistryPipeline,
  createState,
  DEPOSIT,
  ensureColonyLedger,
  getTerraformOpSpec,
  getWorkJobsMap,
  hexIndex,
  HEX_DIRS,
  isTileUneven,
  PREP,
  rowOf,
  setColonyStock,
  setTileDeposit,
  setTilePrep,
  setTileTerrain,
  spawnHqUnit,
  spawnWorkerUnit,
  step,
  TERRAIN,
  TICK_MS,
  type PlanetState,
  type SimCommand,
  type WorkJobRecord,
} from '../../src';

/**
 * A level wild Flat world. The only worker is a T1 Worker (reach 1): it cannot step onto water and cannot
 * reach a pond's centre until a shore tile is flat.
 */
function pondWorld(seed: string) {
  const radius = 8;
  const state = createState({ planetId: `p-${seed}`, planetType: 'temperate', seed, radius });
  state.colonies.push(ensureColonyLedger({ index: 0, id: 'col-0', name: 'A', color: 0xff6b00, status: 'active', changedAt: 0 }));
  const L = state.grid.layers;
  for (let k = 0; k < state.grid.count; k++) {
    setTileTerrain(state, k, TERRAIN.flat, 0);
    setTilePrep(state.grid, k, PREP.wild, 0);
    setTileDeposit(state, k, DEPOSIT.none, 0, 0);
    L.height[k] = 0;
    L.subDeposit[k] = 0;
    L.owner[k] = -1;
  }
  const hx = hexIndex(radius);
  const at = (q: number, r: number) => hx.indexOf(q, r);
  spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
  const worker = spawnWorkerUnit(state, { owner: 0, q: 0, r: 0, tier: 1 });
  const pipeline = createRegistryPipeline({ flags: parseWaves('..05') });
  setColonyStock(state, 0, { 'metals.t1': 800, 'minerals.t1': 400 });
  const run = (cmds: SimCommand[] = [], n = 1) => step(state, cmds, n, pipeline);
  return { state, at, worker, run, pipeline, layers: L };
}

const work = (id: string, tiles: Array<{ q: number; r: number }>, workerId: number): SimCommand => ({
  commandId: id, colonyIndex: 0, source: 'player', kind: 'enqueueTask',
  args: { terraform: { op: 'work', intent: 'terraform', tiles, workerId } },
});

const jobsOf = (state: PlanetState) => (state.blobs.workJobs?.value as { byId?: Record<string, WorkJobRecord> } | undefined)?.byId ?? {};

function runUntil(run: () => unknown, done: () => boolean, max = 8000): number {
  for (let t = 1; t <= max; t++) {
    run();
    if (done()) return t;
  }
  return -1;
}

/** Centre plus its six neighbours, stamped as water (height below the shore, so a reclaim must level them). */
function stampPond(w: ReturnType<typeof pondWorld>, center: { q: number; r: number }, centerTerrain: number) {
  const tiles = [center, ...HEX_DIRS.map(([dq, dr]) => ({ q: center.q + dq, r: center.r + dr }))];
  for (const t of tiles) {
    const i = w.at(t.q, t.r);
    setTileTerrain(w.state, i, t.q === center.q && t.r === center.r ? centerTerrain : TERRAIN.shallow, 0);
    w.layers.height[i] = -0.4;
  }
  return tiles;
}

function workerOnWater(w: ReturnType<typeof pondWorld>): boolean {
  const row = rowOf(w.state.entities, w.worker);
  const i = w.at(w.state.entities.cols.q[row]!, w.state.entities.cols.r[row]!);
  const t = w.layers.terrain[i];
  return t === TERRAIN.shallow || t === TERRAIN.deep;
}

describe('a TERRAFORM click finishes a small lake', () => {
  it('one work order reclaims every shallow tile; a second order is already terraformed', () => {
    const w = pondWorld('lake-shallow');
    const center = { q: 4, r: 0 };
    const tiles = stampPond(w, center, TERRAIN.shallow);
    const spec = getTerraformOpSpec('reclaim', w.pipeline.config.data);
    expect(w.run([work('w1', [tiles[1]!], w.worker)]).outcomes[0].code).toBeUndefined();
    const first = jobsOf(w.state).w1!;
    expect(first).toMatchObject({
      workOp: 'reclaim',
      terrainKey: 'shallow',
      chain: true,
      durationTicks: Math.round((spec.baseTimeS * 1000) / TICK_MS),
      energyCost: spec.energyCostE,
      totalCost: spec.cost,
    });

    let stoodOnWater = false;
    const ticks = runUntil(w.run, () => {
      if (workerOnWater(w)) stoodOnWater = true;
      return Object.keys(jobsOf(w.state)).length === 0 && tiles.every((t) => w.layers.terrain[w.at(t.q, t.r)] === TERRAIN.flat);
    });
    expect(ticks).toBeGreaterThan(0);
    expect(stoodOnWater).toBe(false);
    for (const t of tiles) {
      const i = w.at(t.q, t.r);
      expect(w.layers.terrain[i]).toBe(TERRAIN.flat);
      expect(w.layers.prep[i]).toBe(PREP.prepared);
      expect(isTileUneven(w.state.grid.radius, i, w.layers.terrain, w.layers.height)).toBe(false);
    }
    expect(w.run([work('again', [center], w.worker)]).outcomes[0].code).toBe('already_terraformed');
    expect(getWorkJobsMap(w.state)).toEqual({});
  });

  it('a deep centre without a T2 worker is refused, and the shallow shore still runs', () => {
    const w = pondWorld('lake-deep');
    const center = { q: 4, r: 0 };
    const tiles = stampPond(w, center, TERRAIN.deep);
    const shores = tiles.filter((t) => t.q !== center.q || t.r !== center.r);
    const stroke = w.run([work('stroke', tiles, w.worker)]);
    expect(stroke.outcomes[0].code).toBeUndefined();
    const queued = Object.values(jobsOf(w.state));
    expect(queued.some((j) => j.q === center.q && j.r === center.r)).toBe(false);
    expect(queued.length).toBe(shores.length);

    expect(runUntil(w.run, () => shores.every((t) => w.layers.terrain[w.at(t.q, t.r)] === TERRAIN.flat))).toBeGreaterThan(0);
    expect(w.layers.terrain[w.at(center.q, center.r)]).toBe(TERRAIN.deep);
    expect(Object.values(jobsOf(w.state)).some((j) => j.workOp === 'deepReclaim')).toBe(false);

    const alone = pondWorld('lake-deep-one');
    const only = { q: 3, r: 0 };
    setTileTerrain(alone.state, alone.at(only.q, only.r), TERRAIN.deep, 0);
    expect(alone.run([work('deep', [only], alone.worker)]).outcomes[0].code).toBe('worker_tier_locked');
  });
});
