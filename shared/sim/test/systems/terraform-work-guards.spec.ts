import { describe, expect, it } from 'vitest';
import { eventDef, hasEventKind, parseWaves } from '@terra/contracts';
import {
  createRegistryPipeline,
  createState,
  DEPOSIT,
  ENTITY_KIND,
  ensureColonyLedger,
  enqueueTerraformOrder,
  getUnitCommand,
  hexIndex,
  insertRow,
  PREP,
  restore,
  rowOf,
  setTileDeposit,
  setTilePrep,
  setTileTerrain,
  snapshot,
  spawnWorkerUnit,
  spawnHqUnit,
  spawnTerraformDeposit,
  step,
  TERRAIN,
  type PlanetState,
  type SimCommand,
  type SimEvent,
  type StepContext,
  type WorkJobRecord,
} from '../../src';
import { UnitBook } from '../../src/units/book';

/** A level wild Flat world (nothing buried, unclaimed) with colony 0 and its HQ at (0, 0). */
function flatWorld(seed: string, radius = 10) {
  const state = createState({ planetId: `p-${seed}`, planetType: 'temperate', seed, radius });
  state.colonies.push(ensureColonyLedger({ index: 0, id: 'col-0', name: 'A', color: 0xff6b00, status: 'active', changedAt: 0 }));
  state.colonies.push(ensureColonyLedger({ index: 1, id: 'col-1', name: 'B', color: 0x0066ff, status: 'active', changedAt: 0 }));
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
  const hq = spawnHqUnit(state, { owner: 0, q: 0, r: 0 }) as number;
  const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });
  const events: SimEvent[] = [];
  const run = (cmds: SimCommand[] = [], n = 1) => {
    const res = step(state, cmds, n, pipeline);
    events.push(...res.events);
    return res;
  };
  const setTerrain = (q: number, r: number, t: number) => setTileTerrain(state, at(q, r), t, 0);
  return { state, at, hq, run, events, setTerrain, terrain: (q: number, r: number) => L.terrain[at(q, r)] };
}

const cmd = (commandId: string, kind: string, args: unknown, colonyIndex = 0): SimCommand => ({ commandId, colonyIndex, source: 'player', kind, args });
const work = (id: string, tiles: Array<{ q: number; r: number }>, extra: Record<string, unknown> = {}, colonyIndex = 0) =>
  cmd(id, 'enqueueTask', { terraform: { op: 'work', tiles, ...extra } }, colonyIndex);
const jobsOf = (state: PlanetState) => (state.blobs.workJobs?.value as { byId?: Record<string, WorkJobRecord> } | undefined)?.byId ?? {};
const noJobs = (state: PlanetState) => Object.keys(jobsOf(state)).length === 0;

function runUntil(run: () => unknown, done: () => boolean, max = 3000): number {
  for (let t = 1; t <= max; t++) {
    run();
    if (done()) return t;
  }
  return -1;
}

function addPod(state: PlanetState, owner: number, q: number, r: number): void {
  const row = insertRow(state.entities, state.meta.nextEntityId++, 0);
  const cols = state.entities.cols;
  cols.kind[row] = ENTITY_KIND.pod;
  cols.owner[row] = owner;
  cols.q[row] = q;
  cols.r[row] = r;
  cols.hp[row] = 1;
  cols.hpMax[row] = 1;
}

describe('work order: the clicked tile obeys the territory rule', () => {
  it('before territory: only unclaimed tiles within preHubTerraformRadius of the pod; never foreign', () => {
    const w = flatWorld('tf-terr-1', 14);
    addPod(w.state, 0, 0, 0);
    w.setTerrain(12, 0, TERRAIN.forest); // 12 from the pod: outside the radius (10)
    w.setTerrain(3, 0, TERRAIN.forest);
    w.setTerrain(-3, 0, TERRAIN.forest);
    w.state.grid.layers.owner[w.at(-3, 0)] = 1;
    expect(w.run([work('far', [{ q: 12, r: 0 }])]).outcomes[0].code).toBe('not_own_territory');
    expect(w.run([work('foreign', [{ q: -3, r: 0 }])]).outcomes[0].code).toBe('not_own_territory');
    expect(w.run([work('near', [{ q: 3, r: 0 }])]).outcomes[0].code).toBeUndefined();
  });

  it('with territory: an unclaimed clicked tile is rejected, an own one accepted', () => {
    const w = flatWorld('tf-terr-2');
    w.state.grid.layers.owner[w.at(1, 0)] = 0;
    w.setTerrain(1, 0, TERRAIN.forest);
    w.setTerrain(4, 0, TERRAIN.forest);
    expect(w.run([work('u', [{ q: 4, r: 0 }])]).outcomes[0].code).toBe('not_own_territory');
    expect(w.run([work('o', [{ q: 1, r: 0 }])]).outcomes[0].code).toBeUndefined();
  });
});

describe('work order ids', () => {
  it('a command id naming an open job is rejected (also from another colony); the job is kept', () => {
    const w = flatWorld('tf-ids-1');
    spawnHqUnit(w.state, { owner: 1, q: 4, r: -4 });
    w.setTerrain(3, 0, TERRAIN.forest);
    w.setTerrain(3, -3, TERRAIN.forest);
    expect(w.run([work('w1', [{ q: 3, r: 0 }])]).outcomes[0].code).toBeUndefined();
    expect(w.run([work('w1', [{ q: 3, r: -3 }], {}, 1)]).outcomes[0].code).toBe('invalid_args');
    expect(w.run([work('w1', [{ q: 3, r: -3 }])]).outcomes[0].code).toBe('invalid_args');
    expect(jobsOf(w.state).w1).toMatchObject({ colonyId: 0, q: 3, r: 0, workerEntityId: w.hq });
  });

  it('a multi-tile order and its chain are cancelled by the command id', () => {
    const w = flatWorld('tf-ids-2');
    w.setTerrain(2, 0, TERRAIN.forest);
    w.setTerrain(-2, 0, TERRAIN.forest);
    w.setTerrain(0, 4, TERRAIN.rock);
    w.setTerrain(0, -4, TERRAIN.rock);
    w.run([work('m1', [{ q: 2, r: 0 }, { q: -2, r: 0 }])]);
    expect(Object.values(jobsOf(w.state)).map((j) => j.chainRootId)).toEqual(['m1', 'm1']);
    expect(runUntil(w.run, () => Boolean(jobsOf(w.state)['m1~1']))).toBeGreaterThan(0);
    expect(w.run([cmd('c1', 'cancelTask', { taskId: 'm1' })]).outcomes[0].code).toBeUndefined();
    expect(noJobs(w.state)).toBe(true);
  });
});

describe('work jobs: one entry point', () => {
  it('the direct task form and enqueueTerraformOrder(op: work) make chained work jobs with intent', () => {
    const w = flatWorld('tf-entry-1');
    w.setTerrain(3, 0, TERRAIN.forest);
    w.setTerrain(-3, 0, TERRAIN.rock);
    const direct = cmd('d1', 'enqueueTask', { task: { kind: 'terraform', op: 'work', q: 3, r: 0, intent: 'terraform' } });
    expect(w.run([direct]).outcomes[0].code).toBeUndefined();
    expect(jobsOf(w.state).d1).toMatchObject({ mode: 'terraform', chain: true, chainSeq: 0 });
    const res = enqueueTerraformOrder(w.state, { colonyId: 0, op: 'work', tiles: [{ q: -3, r: 0 }], taskId: 'o1' });
    expect(res.ok).toBe(true);
    expect(jobsOf(w.state).o1).toMatchObject({ mode: 'terraform', chain: true });
    const repair = cmd('d2', 'enqueueTask', { task: { kind: 'terraform', op: 'work', q: 5, r: 5, intent: 'repair' } });
    expect(w.run([repair]).outcomes[0].code).toBe('site_blocked');
  });

  it('GP-46: enqueueTask (task form), cancelTask (all), and reorderTask require a colonyIndex (not_own_colony)', () => {
    const w = flatWorld('tf-gp46');
    const noCol = (id: string, kind: string, args: Record<string, unknown>): SimCommand => ({
      commandId: id,
      colonyIndex: null as unknown as number,
      source: 'player',
      kind: kind as SimCommand['kind'],
      args,
    });
    expect(w.run([noCol('n1', 'enqueueTask', { task: { kind: 'buildUnit', unit: 'worker' } })]).outcomes[0].code).toBe('not_own_colony');
    expect(w.run([noCol('n2', 'cancelTask', { taskId: 'all' })]).outcomes[0].code).toBe('not_own_colony');
    expect(w.run([noCol('n3', 'reorderTask', { taskId: 'u1', toIndex: 0 })]).outcomes[0].code).toBe('not_own_colony');
  });
});

describe('work jobs vs unit work providers', () => {
  it('a manual terraform order never takes the HQ while it works a chain; it does once the chain ended', () => {
    const w = flatWorld('tf-prov-1');
    w.setTerrain(3, 0, TERRAIN.forest);
    w.setTerrain(5, 0, TERRAIN.forest);
    expect(enqueueTerraformOrder(w.state, { colonyId: 0, op: 'grade', tiles: [{ q: -3, r: 2 }], allowUnclaimed: true }).ok).toBe(true);
    w.run([work('w1', [{ q: 3, r: 0 }], { workerId: w.hq })]);
    let hijacked = false;
    expect(runUntil(() => { w.run(); hijacked ||= !noJobs(w.state) && getUnitCommand(w.state, w.hq) !== null; }, () => noJobs(w.state))).toBeGreaterThan(0);
    expect(hijacked).toBe(false);
    expect(w.terrain(5, 0)).toBe(TERRAIN.flat);
    w.run([], 3);
    expect(getUnitCommand(w.state, w.hq)).toMatchObject({ kind: 'terraform', source: 'auto' });
  });

  it('a work order drops the worker\'s current unit command (its auto terraform)', () => {
    const w = flatWorld('tf-prov-2');
    w.setTerrain(3, 0, TERRAIN.forest);
    expect(enqueueTerraformOrder(w.state, { colonyId: 0, op: 'grade', tiles: [{ q: -3, r: 2 }], allowUnclaimed: true }).ok).toBe(true);
    w.run([], 3);
    expect(getUnitCommand(w.state, w.hq)).toMatchObject({ kind: 'terraform' });
    w.run([work('w1', [{ q: 3, r: 0 }])]);
    expect(getUnitCommand(w.state, w.hq)).toBeNull();
  });
});

describe('repair behind a chain', () => {
  it('a repair queued on the chain worker runs after its current tile; the chain goes on after the repair', () => {
    const w = flatWorld('tf-rep-1');
    const col = ensureColonyLedger(w.state.colonies[0]!);
    col.stock['metals.t1'] = 400;
    col.stock['minerals.t1'] = 400;
    const harv = spawnWorkerUnit(w.state, { owner: 0, q: -2, r: 0 }) as number;
    const hRow = rowOf(w.state.entities, harv);
    const cols = w.state.entities.cols;
    cols.hp[hRow] = Math.round(cols.hpMax[hRow] / 2);
    cols.state[hRow] = 0;
    w.setTerrain(3, 0, TERRAIN.forest);
    w.setTerrain(6, 0, TERRAIN.forest);
    w.run([work('w1', [{ q: 3, r: 0 }], { workerId: w.hq })]);
    w.run([work('r1', [{ q: -2, r: 0 }], { intent: 'repair', workerId: w.hq })]);
    expect(Object.keys(jobsOf(w.state))).toEqual(['w1', 'r1']);
    expect(runUntil(w.run, () => w.terrain(3, 0) === TERRAIN.flat)).toBeGreaterThan(0);
    expect(Object.keys(jobsOf(w.state))).toEqual(['r1', 'w1~1']);
    expect(runUntil(w.run, () => cols.hp[rowOf(w.state.entities, harv)] === cols.hpMax[rowOf(w.state.entities, harv)])).toBeGreaterThan(0);
    expect(runUntil(w.run, () => noJobs(w.state))).toBeGreaterThan(0);
    expect(w.terrain(6, 0)).toBe(TERRAIN.flat);
  });
});

describe('unreachable tiles: only the ordered tile reports no_path', () => {
  function walledForest(w: ReturnType<typeof flatWorld>, cq: number): void {
    const hx = hexIndex(12);
    for (let i = 0; i < w.state.grid.count; i++) {
      const d = Math.max(Math.abs(hx.q[i]! - cq), Math.abs(hx.r[i]!), Math.abs(hx.q[i]! - cq + hx.r[i]!));
      if (d >= 2 && d <= 3) setTileTerrain(w.state, i, TERRAIN.deep, 0); // a pocket: a stand in reach, no path to it
    }
    w.setTerrain(cq, 0, TERRAIN.forest);
  }

  it('a chained follow-up with no path is skipped silently', () => {
    const w = flatWorld('tf-silent-1', 12);
    w.setTerrain(2, 0, TERRAIN.forest);
    walledForest(w, 6);
    w.setTerrain(-4, 0, TERRAIN.forest);
    w.run([work('w1', [{ q: 2, r: 0 }])]);
    expect(runUntil(w.run, () => Boolean(jobsOf(w.state)['w1~2']))).toBeGreaterThan(0);
    expect(new UnitBook(w.state).peek(w.hq)?.lastFailure ?? null).toBeNull();
  });

  it('the ordered tile with no path reports no_path', () => {
    const w = flatWorld('tf-silent-2', 12);
    walledForest(w, 6);
    w.run([work('w1', [{ q: 6, r: 0 }])]);
    expect(runUntil(w.run, () => noJobs(w.state))).toBeGreaterThan(0);
    expect(new UnitBook(w.state).peek(w.hq)?.lastFailure).toMatchObject({ code: 'no_path' });
  });
});

describe('completion re-check (GP-01)', () => {
  it('a tile claimed by another colony or occupied meanwhile is dropped without yield or terrain change', () => {
    for (const change of ['foreign', 'building'] as const) {
      const w = flatWorld(`tf-recheck-${change}`);
      w.setTerrain(2, 0, TERRAIN.forest);
      const col = ensureColonyLedger(w.state.colonies[0]!);
      const bio = col.stock['bio.biomass'];
      w.run([work('w1', [{ q: 2, r: 0 }])]);
      w.run([], 5);
      if (change === 'foreign') w.state.grid.layers.owner[w.at(2, 0)] = 1;
      else {
        const row = insertRow(w.state.entities, w.state.meta.nextEntityId++, 0);
        const cols = w.state.entities.cols;
        cols.kind[row] = ENTITY_KIND.solar;
        cols.owner[row] = 0;
        cols.q[row] = 2;
        cols.r[row] = 0;
        cols.hp[row] = 10;
        cols.hpMax[row] = 10;
      }
      expect(runUntil(w.run, () => noJobs(w.state))).toBeGreaterThan(0);
      expect(w.terrain(2, 0)).toBe(TERRAIN.forest);
      expect(col.stock['bio.biomass']).toBe(bio);
      expect(w.events.some((e) => e.kind === 'obstacleRemoved')).toBe(false);
    }
  });
});

describe('work-path events pass their contract schemas', () => {
  it('forest → obstacleRemoved clear, rock → break, slope → tilePrepared, buried deposit → groundRevealed', () => {
    const w = flatWorld('tf-events-1');
    w.setTerrain(2, 0, TERRAIN.forest);
    w.setTerrain(-2, 0, TERRAIN.rock);
    w.setTerrain(0, 3, TERRAIN.slope);
    w.state.grid.layers.subDeposit[w.at(-2, 0)] = DEPOSIT.metals;
    w.state.grid.layers.subRichness[w.at(-2, 0)] = 5000;
    w.run([work('w1', [{ q: 2, r: 0 }])]);
    expect(runUntil(w.run, () => noJobs(w.state))).toBeGreaterThan(0);
    const player = w.events.filter((e) => ['obstacleRemoved', 'tilePrepared', 'groundRevealed', 'resourceSpawned'].includes(e.kind));
    expect(player.map((e) => [e.kind, (e.data as { op?: string }).op])).toEqual(
      expect.arrayContaining([['obstacleRemoved', 'clear'], ['obstacleRemoved', 'break'], ['tilePrepared', undefined], ['groundRevealed', undefined]]),
    );
    for (const e of w.events) {
      expect(hasEventKind(e.kind)).toBe(true);
      if (hasEventKind(e.kind)) expect(eventDef(e.kind).data.safeParse(e.data).success, `${e.kind} ${JSON.stringify(e.data)}`).toBe(true);
    }
  });
});

describe('found deposits', () => {
  it('never appear under a unit', () => {
    const w = flatWorld('tf-spawn-unit');
    const i = w.at(0, 0); // the HQ stands here
    const ctx = { tick: 3, emit: () => {} } as unknown as StepContext;
    expect(spawnTerraformDeposit(w.state, { tileIdx: i, q: 0, r: 0 }, { colonyId: 'col-0' }, ctx, () => 0)).toBeNull();
    expect(w.state.grid.layers.deposit[i]).toBe(DEPOSIT.none);
  });

  it('an old save without the depositTier layer restores with tier 0 (legacy tier 1)', () => {
    const w = flatWorld('tf-old-save');
    setTileDeposit(w.state, w.at(1, 1), DEPOSIT.metals, 10000, 0);
    delete (w.state.grid.layers as Record<string, unknown>).depositTier;
    const back = restore(snapshot(w.state));
    expect(back.grid.layers.depositTier).toBeInstanceOf(Uint8Array);
    expect(back.grid.layers.depositTier[w.at(1, 1)]).toBe(0);
  });
});

describe('a chain never re-works a tile', () => {
  it('Flat tiles that stay uneven after their job (a foreign raised neighbour) are worked once each, then the chain ends', () => {
    const w = flatWorld('tf-uneven-loop', 12);
    const L = w.state.grid.layers;
    const hx = hexIndex(12);
    const pairs = [[[4, 0], [5, 0]], [[-4, -3], [-5, -3]]] as const; // [uneven tile, its raised foreign neighbour]
    for (let i = 0; i < w.state.grid.count; i++) {
      if (pairs.some(([a, b]) => i === w.at(a[0], a[1]) || i === w.at(b[0], b[1]))) continue;
      const near = pairs.some(([a, b]) => Math.min(hexDistanceOf(hx, i, a[0], a[1]), hexDistanceOf(hx, i, b[0], b[1])) === 1);
      if (near) setTileTerrain(w.state, i, TERRAIN.deep, 0);
    }
    for (const [, b] of pairs) {
      L.height[w.at(b[0], b[1])] = 1; // the chain may not work it, so its partner stays uneven
      L.owner[w.at(b[0], b[1])] = 1;
    }
    w.setTerrain(-1, 3, TERRAIN.forest);
    w.run([work('w1', [{ q: -1, r: 3 }])]);
    expect(runUntil(w.run, () => noJobs(w.state), 4000)).toBeGreaterThan(0);
    for (const [a] of pairs) {
      const prepared = w.events.filter((e) => e.kind === 'tilePrepared' && (e.data as { q?: number }).q === a[0] && (e.data as { r?: number }).r === a[1]);
      expect(prepared).toHaveLength(1);
    }
  });
});

function hexDistanceOf(hx: ReturnType<typeof hexIndex>, i: number, q: number, r: number): number {
  const dq = hx.q[i]! - q, dr = hx.r[i]! - r;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
}

