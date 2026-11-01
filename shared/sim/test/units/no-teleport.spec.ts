import { describe, expect, it } from 'vitest';
import {
  ENTITY_KIND,
  ENTITY_STATE,
  enqueuePathRequest,
  getConstructionOrders,
  getHubFootprintTiles,
  restore,
  snapshot,
  stepPathQueue,
  insertRow,
  getPathStats,
  getUnitCommand,
  getUnitRecord,
  PREP,
  hexDistance,
  hexIndex,
  rowOf,
  DEPOSIT,
  setTileDeposit,
  setTileTerrain,
  spawnHqUnit,
  TERRAIN, setColonyStock, resolveStartingCargo,
} from '../../src';
import { cmd, HQ_SPEED_PER_TICK, MotionWatch, prepareFootprint, w01Host } from './helpers';

const EPS = 1e-4;

describe('units never teleport: work makes the HQ walk there (SIM-M-01)', () => {
  it('placing a building far away sends the HQ along a path to the site; it builds only once in reach', () => {
    const host = w01Host();
    const state = host.state;
    const hqId = spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    setColonyStock(state, 0, resolveStartingCargo()); // the colony landed with its cargo (no free stock otherwise)
    const row = rowOf(state.entities, hqId);
    const cols = state.entities.cols;
    prepareFootprint(state, 10, 0);
    const watch = new MotionWatch(() => host.state);

    host.submit(cmd('placeBuilding', { building: 'commandHub', q: 10, r: 0 }));
    expect(host.step(1).outcomes[0]?.code).toBeUndefined();
    watch.sample();
    expect(cols.state[row]).toBe(ENTITY_STATE.moving);
    expect(getUnitCommand(state, hqId)).toMatchObject({ kind: 'build', source: 'auto' });
    expect(getConstructionOrders(state, 0)[0]?.statusText).toBe('waiting(builder: HQ en route)');

    let firstWorkTick = -1;
    for (let t = 0; t < 60 && firstWorkTick < 0; t++) {
      host.step(1);
      watch.sample();
      if (cols.state[row] === ENTITY_STATE.constructing) firstWorkTick = host.tick;
      else expect(getConstructionOrders(state, 0)[0]?.progress ?? 0).toBe(0); // no work from afar
    }
    // 7 tiles to the reach band [2, 3] around (10, 0) at 0.32 tiles per tick: ~22 ticks of walking
    expect(firstWorkTick).toBeGreaterThanOrEqual(20);
    const d = hexDistance(cols.x[row], cols.y[row], 10, 0);
    expect(d).toBeGreaterThanOrEqual(2);
    expect(d).toBeLessThanOrEqual(3);
    expect(watch.maxStep).toBeLessThanOrEqual(HQ_SPEED_PER_TICK + EPS);
  });

  it('terraform jobs far from the HQ: it walks to each tile, works it from 1–2 tiles away and never stands in a tree', () => {
    const host = w01Host();
    const state = host.state;
    const hqId = spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const row = rowOf(state.entities, hqId);
    const cols = state.entities.cols;
    const idx = hexIndex(state.grid.radius);
    // a forest disc of radius 2 around (8, 0): the inner tiles can only be reached once the outer ring is cleared
    const forest: Array<{ q: number; r: number }> = [];
    for (let i = 0; i < idx.count; i++) {
      if (hexDistance(idx.q[i], idx.r[i], 8, 0) <= 2) {
        setTileTerrain(state.grid, i, TERRAIN.forest);
        forest.push({ q: idx.q[i], r: idx.r[i] });
      }
    }
    const watch = new MotionWatch(() => host.state);
    host.submit(cmd('enqueueTask', { terraform: { op: 'clear', tiles: forest } }));
    expect(host.step(1).outcomes[0]?.code).toBeUndefined();
    watch.sample();

    for (let t = 0; t < 1500 && forest.some((p) => state.grid.layers.terrain[idx.indexOf(p.q, p.r)] === TERRAIN.forest); t++) {
      host.step(1);
      watch.sample();
      expect(state.grid.layers.terrain[idx.indexOf(cols.q[row], cols.r[row])]).not.toBe(TERRAIN.forest);
      if (cols.state[row] === ENTITY_STATE.working) {
        const d = hexDistance(cols.q[row], cols.r[row], cols.targetQ[row], cols.targetR[row]);
        expect(d).toBeGreaterThanOrEqual(1);
        expect(d).toBeLessThanOrEqual(2);
      }
    }
    expect(forest.every((p) => state.grid.layers.terrain[idx.indexOf(p.q, p.r)] === TERRAIN.flat)).toBe(true);
    expect(watch.maxStep).toBeLessThanOrEqual(HQ_SPEED_PER_TICK + EPS);
    expect(watch.maxStep).toBeGreaterThan(0.3); // it really walked
  });

  it('property: 40 random command logs (move, terraform, build, stop) never move a unit faster than its speed', () => {
    for (let seed = 1; seed <= 40; seed++) {
      let s = seed * 9301 + 49297;
      const rand = (n: number) => ((s = (s * 9301 + 49297) % 233280), Math.floor((s / 233280) * n));
      const host = w01Host(14, `prop-${seed}`);
      const state = host.state;
      const idx = hexIndex(state.grid.radius);
      for (let i = 0; i < 40; i++) {
        const t = rand(idx.count);
        if (hexDistance(idx.q[t], idx.r[t], 0, 0) > 1) setTileTerrain(state.grid, t, rand(2) ? TERRAIN.forest : TERRAIN.rock);
      }
      const hqId = spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
      const row = rowOf(state.entities, hqId);
      const watch = new MotionWatch(() => host.state);
      const tile = () => ({ q: rand(17) - 8, r: rand(17) - 8 });
      for (let tick = 0; tick < 250; tick++) {
        const roll = rand(40);
        if (roll === 0) host.submit(cmd('moveUnit', { entityId: hqId, ...tile() }));
        else if (roll === 1) host.submit(cmd('enqueueTask', { terraform: { op: 'auto', tiles: [tile(), tile()] } }));
        else if (roll === 2) host.submit(cmd('placeBuilding', { building: 'commandHub', ...tile() }));
        else if (roll === 3) host.submit(cmd('stopUnit', { entityId: hqId }));
        host.step(1);
        watch.sample();
        const at = idx.indexOf(state.entities.cols.q[row], state.entities.cols.r[row]);
        expect([TERRAIN.forest, TERRAIN.rock], `seed ${seed} tick ${host.tick}`).not.toContain(state.grid.layers.terrain[at]);
      }
      expect(watch.maxStep, `seed ${seed}`).toBeLessThanOrEqual(HQ_SPEED_PER_TICK + EPS);
    }
  });
});

describe('unreachable auto work is skipped, not retried every step', () => {
  it('a terraform tile walled in by rock is skipped for retryBlockedS while the HQ does the reachable job', () => {
    const host = w01Host();
    const state = host.state;
    const idx = hexIndex(state.grid.radius);
    const hqId = spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    // every tile 1–2 from (8, 0) is rock: no standable tile in the [1, 2] work band
    for (let i = 0; i < idx.count; i++) {
      const d = hexDistance(idx.q[i], idx.r[i], 8, 0);
      if (d >= 1 && d <= 2) setTileTerrain(state.grid, i, TERRAIN.rock);
    }
    host.submit(cmd('enqueueTask', { terraform: { op: 'grade', tiles: [{ q: 8, r: 0 }, { q: -10, r: 0 }] } }));
    host.step(1); // nearest first: (8, 0); its route fails in the same step and the HQ moves on
    const rec = getUnitRecord(state, hqId)!;
    expect(Object.keys(rec.skip).some((k) => k.endsWith(':8,0'))).toBe(true);
    expect(rec.current).toMatchObject({ kind: 'terraform', q: -10, r: 0 });

    const solved0 = getPathStats(state).totalResolved;
    for (let t = 0; t < 20; t++) host.step(1); // walking to (-10, 0): only its own route was searched
    expect(getPathStats(state).totalResolved).toBe(solved0 + 1);
    expect(getPathStats(state).lastStepExpansions).toBe(0);

    for (let t = 0; t < 100; t++) host.step(1); // idle with only the blocked job: one retry per 5 s at most
    expect(getPathStats(state).totalResolved - solved0).toBeLessThanOrEqual(5);
    expect(state.grid.layers.prep[idx.indexOf(-10, 0)]).toBe(PREP.prepared);
  });
});

describe('movement edge cases', () => {
  it('blue crystals (and every resource deposit) block ground movement: routes go around, a deposit tile is not a target', () => {
    const host = w01Host();
    const state = host.state;
    const idx = hexIndex(state.grid.radius);
    const hqId = spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const row = rowOf(state.entities, hqId);
    for (const r of [-2, -1, 0, 1, 2]) setTileDeposit(state.grid, idx.indexOf(3, r), DEPOSIT.minerals, 1);
    host.submit(cmd('moveUnit', { entityId: hqId, q: 3, r: 0 }));
    expect(host.step(1).outcomes[0]?.code).toBe('site_blocked');
    host.submit(cmd('moveUnit', { entityId: hqId, q: 6, r: 0 }));
    host.step(1);
    for (let t = 0; t < 80 && state.entities.cols.state[row] === ENTITY_STATE.moving; t++) {
      host.step(1);
      expect(state.grid.layers.deposit[idx.indexOf(state.entities.cols.q[row], state.entities.cols.r[row])]).toBe(DEPOSIT.none);
    }
    expect([state.entities.cols.x[row], state.entities.cols.y[row]]).toEqual([6, 0]);
  });

  it('re-ordering mid-step never walks the unit back to the tile it is leaving (no back-and-forth)', () => {
    const host = w01Host();
    const state = host.state;
    const hqId = spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const row = rowOf(state.entities, hqId);
    const cols = state.entities.cols;
    host.submit(cmd('moveUnit', { entityId: hqId, q: 8, r: 0 }));
    host.step(2); // 0.64 tiles along, closer to (1, 0) than to (0, 0)
    for (let i = 0; i < 4; i++) {
      const x0 = cols.x[row];
      host.submit(cmd('moveUnit', { entityId: hqId, q: 8, r: 0 })); // the same click again (double events, impatience)
      host.step(1);
      expect(cols.x[row]).toBeGreaterThan(x0);
    }
  });
});

describe('review fixes', () => {
  it('the HQ cell keeps recharging while a queued terraform job is unreachable (it only pauses while working)', () => {
    const host = w01Host();
    const state = host.state;
    const idx = hexIndex(state.grid.radius);
    const hqId = spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const row = rowOf(state.entities, hqId);
    for (let i = 0; i < idx.count; i++) {
      const d = hexDistance(idx.q[i], idx.r[i], 8, 0);
      if (d >= 1 && d <= 2) setTileTerrain(state.grid, i, TERRAIN.rock);
    }
    state.entities.cols.cell[row] = 100;
    host.submit(cmd('enqueueTask', { terraform: { op: 'grade', tiles: [{ q: 8, r: 0 }] } }));
    host.step(100); // 20 s at the 3 E/s self-recharge
    expect(state.entities.cols.cell[row]).toBeGreaterThan(150);
  });

  it('a tile that becomes an obstacle under a unit mid-step does not trap it in an endless re-plan', () => {
    const host = w01Host();
    const state = host.state;
    const idx = hexIndex(state.grid.radius);
    const hqId = spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const row = rowOf(state.entities, hqId);
    host.submit(cmd('moveUnit', { entityId: hqId, q: 8, r: 0 }));
    host.step(2); // x = 0.64: rounded onto (1, 0)
    expect(state.entities.cols.q[row]).toBe(1);
    setTileDeposit(state.grid, idx.indexOf(1, 0), DEPOSIT.minerals, 1);
    for (let t = 0; t < 60 && state.entities.cols.state[row] === ENTITY_STATE.moving; t++) host.step(1);
    expect([state.entities.cols.q[row], state.entities.cols.r[row], state.entities.cols.state[row]]).toEqual([8, 0, ENTITY_STATE.idle]);
  });

  it('buildings and pods never move: only units walk', () => {
    const host = w01Host();
    const state = host.state;
    const hqId = spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const hubRow = insertRow(state.entities, state.meta.nextEntityId++, state.meta.tick);
    state.entities.cols.kind[hubRow] = ENTITY_KIND.hub;
    state.entities.cols.owner[hubRow] = 0;
    state.entities.cols.q[hubRow] = 6;
    state.entities.cols.x[hubRow] = 6;
    state.entities.cols.hp[hubRow] = state.entities.cols.hpMax[hubRow] = 1500;
    state.entities.cols.state[hubRow] = ENTITY_STATE.active;
    host.submit(cmd('moveUnit', { entityId: hqId, q: -5, r: 2 }));
    host.step(1);
    const fixed = () => {
      const e = state.entities;
      const out: string[] = [];
      for (let row = 0; row < e.count; row++) if (e.cols.kind[row] !== ENTITY_KIND.hq) out.push(`${e.cols.id[row]}:${e.cols.x[row]},${e.cols.y[row]}`);
      return out.join(' ');
    };
    const before = fixed();
    host.step(150);
    expect(fixed()).toBe(before);
  });
});

describe('buildings block ground movement', () => {
  it('the HQ prepares a site from outside its footprint and walks out if it stood on it when the Hub was placed', () => {
    const host = w01Host();
    const state = host.state;
    setColonyStock(state, 0, resolveStartingCargo());
    const hqId = spawnHqUnit(state, { owner: 0, q: 3, r: 0 }); // on the future footprint (centre)
    const row = rowOf(state.entities, hqId);
    const cols = state.entities.cols;
    host.submit(cmd('placeBuilding', { building: 'commandHub', q: 3, r: 0 }));
    expect(host.step(1).outcomes[0]?.code).toBeUndefined();
    const footprint = new Set(getHubFootprintTiles(3, 0).map((t) => `${t.q},${t.r}`));
    let worked = 0;
    for (let t = 0; t < 400 && (getConstructionOrders(state, 0)[0]?.status ?? 'completed') !== 'completed'; t++) {
      host.step(1);
      if (cols.state[row] === ENTITY_STATE.working || cols.state[row] === ENTITY_STATE.constructing) {
        worked++;
        expect(footprint.has(`${cols.q[row]},${cols.r[row]}`), `tick ${host.tick}`).toBe(false);
      }
    }
    expect(worked).toBeGreaterThan(100);
    expect(getConstructionOrders(state, 0)[0]?.status).toBe('completed');
    host.submit(cmd('moveUnit', { entityId: hqId, q: 3, r: 0 })); // the finished Hub is not walkable
    expect(host.step(1).outcomes[0]?.code).toBe('site_blocked');
  });

  it('a paused long search restarts when the ground changes, identically on a restored copy', () => {
    const host = w01Host(40);
    const state = host.state;
    const idx = hexIndex(state.grid.radius);
    for (let i = 0; i < idx.count; i++) {
      if (hexDistance(idx.q[i], idx.r[i], 0, 0) === 25 && !(idx.q[i] === 0 && idx.r[i] === 25)) setTileTerrain(state.grid, i, TERRAIN.rock);
    }
    enqueuePathRequest(state, { id: 'long', from: { q: 0, r: -20 }, to: { q: 0, r: -30 }, radius: 40, profile: 'ground' }, 1);
    expect(stepPathQueue(state, 700).resolvedCount).toBe(0);
    const copy = restore(snapshot(state));
    // a gap opens on the near side while the search is paused, on both hosts
    for (const s of [state, copy]) setTileTerrain(s.grid, hexIndex(40).indexOf(0, -25), TERRAIN.flat);
    let a = stepPathQueue(state, 700);
    let b = stepPathQueue(copy, 700);
    for (let n = 0; n < 40 && a.resolvedCount === 0; n++) {
      expect(b.expansionsUsed).toBe(a.expansionsUsed);
      a = stepPathQueue(state, 700);
      b = stepPathQueue(copy, 700);
    }
    expect(b.resolved[0]).toEqual(a.resolved[0]);
    expect(a.resolved[0].path.length).toBeLessThan(15); // took the new short way out
  });
});
