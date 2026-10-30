import { describe, expect, it } from 'vitest';
import {
  applyDiff, createEngineConfig, createPlanet, defineCommandHandler, defineSimModule, defineSystem, DiffGapError, diffSince,
  insertRow, nextFloat, nextInt, removeRow, restore, rowOf, setBlob, setField, SimHost, touchTile,
  type SimCommand,
} from '../../src';

const cell = (ctx: { rng: (s: 'misc') => Uint32Array }, n: number) => nextInt(ctx.rng('misc'), 0, n - 1);

const handlers = [
  defineCommandHandler({ kind: 'h.spawn', wave: 'W00', handle(s, c, ctx) {
    const { q, r } = c.args as { q: number; r: number };
    const row = insertRow(s.entities, ctx.newEntityId(), ctx.tick);
    const cols = s.entities.cols;
    cols.q[row] = q; cols.r[row] = r; cols.x[row] = q; cols.y[row] = r; cols.hp[row] = cols.hpMax[row] = 10; cols.owner[row] = c.colonyIndex ?? -1;
  } }),
  defineCommandHandler({ kind: 'h.move', wave: 'W00', handle(s, c, ctx) {
    const { id, x } = c.args as { id: number; x: number };
    const row = rowOf(s.entities, id);
    if (row < 0) return 'unknown_entity';
    setField(s.entities, row, 'x', x, ctx.tick);
  } }),
  defineCommandHandler({ kind: 'h.kill', wave: 'W00', handle(s, c, ctx) {
    if (!removeRow(s.entities, (c.args as { id: number }).id, ctx.tick)) return 'unknown_entity';
  } }),
  defineCommandHandler({ kind: 'h.colony', wave: 'W00', handle(s, c, ctx) {
    const i = (c.args as { i: number }).i;
    s.colonies[i] = { index: i, id: `col_${i}`, name: `C${ctx.tick}`, color: 0xff8800, status: 'active', changedAt: ctx.tick, stock: { ore: ctx.tick } };
  } }),
];

/** Random churn: tile writes, blobs, entity jitter, now and then a removal, all from the `misc` stream. */
const churn = defineSystem({ id: 'test.churn', slot: 5, wave: 'W00', run(s, ctx) {
  const g = ctx.rng('misc');
  for (let k = 0; k < 6; k++) {
    const i = nextInt(g, 0, s.grid.count - 1);
    s.grid.layers.terrain[i] = nextInt(g, 0, 5);
    (s.grid.layers.height as Float32Array)[i] = nextFloat(g);
    touchTile(s, i, ctx.tick);
  }
  const e = s.entities;
  for (let row = 0; row < e.count; row++) if (nextInt(g, 0, 3) === 0) setField(e, row, 'y', nextFloat(g) * 50, ctx.tick);
  if (e.count > 3 && nextInt(g, 0, 4) === 0) removeRow(e, e.cols.id[cell(ctx, e.count)], ctx.tick);
  if (nextInt(g, 0, 3) === 0) setBlob(s, 'lanes', { n: nextInt(g, 0, 99), arr: new Uint16Array([ctx.tick & 0xffff]) }, ctx.tick);
  if (nextInt(g, 0, 9) === 0) ctx.emit({ kind: 'test.blip' });
} });

const modules = [defineSimModule({ id: 'host-test', wave: 'W00', systems: [churn], handlers })];
const opts = { flags: ['W00'], modules };
let n = 0;
const cmd = (kind: string, args: unknown, colonyIndex: number | null = null): SimCommand => ({ colonyIndex, source: 'dev', commandId: `c${++n}`, kind, args });

function authority(radius = 6): SimHost {
  const h = new SimHost(opts);
  h.load(createPlanet({ type: 'flat', seed: 'host', radius }));
  return h;
}

/** Random command burst for one step. */
function burst(h: SimHost, g: Uint32Array): void {
  const e = h.state.entities;
  const spawns = nextInt(g, 0, 40);
  for (let i = 0; i < spawns; i++) h.submit(cmd('h.spawn', { q: nextInt(g, -5, 5), r: nextInt(g, -5, 5) }, nextInt(g, 0, 2)));
  if (e.count) h.submit(cmd('h.move', { id: e.cols.id[nextInt(g, 0, e.count - 1)], x: nextFloat(g) * 9 }));
  if (e.count && nextInt(g, 0, 2) === 0) h.submit(cmd('h.kill', { id: e.cols.id[nextInt(g, 0, e.count - 1)] }));
  if (nextInt(g, 0, 4) === 0) h.submit(cmd('h.colony', { i: nextInt(g, 0, 2) }));
}

describe('SimHost (D-31)', () => {
  it('load / step / snapshot round trips deep-equal', () => {
    const h = authority();
    const g = new Uint32Array([1, 2, 3, 4]);
    for (let t = 0; t < 30; t++) { burst(h, g); h.step(1); }
    expect(restore(h.snapshot())).toEqual(h.state);
    const h2 = new SimHost(opts);
    h2.load(h.snapshot());
    expect(h2.state).toEqual(h.state);
    expect(h2.tick).toBe(30);
  });

  it('a replica fed diffSince chunks of random windows deep-equals the authority after each', () => {
    const h = authority();
    const g = new Uint32Array([9, 8, 7, 6]);
    for (let t = 0; t < 10; t++) { burst(h, g); h.step(1); }
    const replica = new SimHost(opts);
    replica.load(h.snapshot());
    let known = h.tick;
    for (let round = 0; round < 60; round++) {
      const window = nextInt(g, 1, 6);
      for (let w = 0; w < window; w++) { burst(h, g); h.step(nextInt(g, 0, 7) === 0 ? 5 : 1); }
      replica.applyDiff(h.diffSince(known));
      known = h.tick;
      expect(replica.state).toEqual(h.state);
    }
    expect(h.state.entities.removed.length).toBeGreaterThan(0);
    expect(h.state.entities.capacity).toBeGreaterThan(64); // grew, and the replica matched
  });

  it('a diff over an empty window is a no-op and replays idempotently from the same base', () => {
    const h = authority();
    const replica = h.clone();
    replica.applyDiff(h.diffSince(0));
    expect(replica.state).toEqual(h.state);
    expect(() => replica.applyDiff(h.diffSince(0))).not.toThrow(); // fromTick 0 == replica tick 0 only when no step ran
  });

  it('applyDiff with a gap throws DiffGapError', () => {
    const h = authority();
    const replica = h.clone();
    h.step(1); const d1 = h.diffSince(0);
    h.step(1); const d2 = h.diffSince(1);
    expect(() => replica.applyDiff(d2)).toThrow(DiffGapError);
    replica.applyDiff(d1);
    expect(() => replica.applyDiff(d1)).toThrow(DiffGapError);
    replica.applyDiff(d2);
    expect(replica.state).toEqual(h.state);
    try { replica.applyDiff(d1); } catch (e) { expect(e).toMatchObject({ replicaTick: 2, fromTick: 0 }); }
  });

});

describe('SimHost (D-31) clone and events', () => {
  it('clone deep-equals and is independent', () => {
    const h = authority();
    const g = new Uint32Array([5, 5, 5, 5]);
    for (let t = 0; t < 12; t++) { burst(h, g); h.step(1); }
    h.submit(cmd('h.spawn', { q: 0, r: 0 }));
    const c = h.clone();
    expect(c.state).toEqual(h.state);
    expect(c.pending).toBe(1);
    const before = h.snapshot();
    for (let t = 0; t < 5; t++) { burst(c, g); c.step(1); }
    expect(h.snapshot()).toEqual(before);
    expect(c.tick).toBe(h.tick + 5);
    expect(c.state.grid.layers.terrain).not.toBe(h.state.grid.layers.terrain);
  });

  it('coarse steps (dt = 5) and commands/outcomes/events are observed', () => {
    const h = authority();
    const seenOutcomes: string[] = [];
    let blips = 0;
    const off = h.onOutcomes((o) => seenOutcomes.push(...o.map((x) => x.code ?? 'ok')));
    h.onEvents((ev) => { blips += ev.length; });
    h.submit(cmd('h.spawn', { q: 1, r: 1 }));
    h.submit(cmd('h.kill', { id: 999 }));
    h.submit(cmd('nope', {}));
    const res = h.step(5);
    expect(h.tick).toBe(5);
    expect(res.outcomes.map((o) => o.appliedAtTick)).toEqual([5, 5, 5]);
    expect(seenOutcomes).toEqual(['ok', 'unknown_entity', 'unknown_kind']);
    expect(h.pending).toBe(0);
    for (let i = 0; i < 40; i++) h.step(5);
    expect(blips).toBeGreaterThan(0);
    expect(h.events).toBe(h.lastStep?.events);
    off();
    h.submit(cmd('h.kill', { id: 999 }));
    h.step(1);
    expect(seenOutcomes.length).toBe(3);
    expect(() => h.step(0)).toThrow();
  });

  it('view projects state', () => {
    const h = authority(3);
    h.submit(cmd('h.spawn', { q: 2, r: -1 }, 1));
    h.step(1);
    const v = h.view();
    expect(v).toMatchObject({ tick: 1, planet: { id: 'pl_dev', radius: 3 }, tiles: { count: h.state.grid.count } });
    expect(v.entities).toHaveLength(1);
    expect(v.entities[0]).toMatchObject({ q: 2, r: -1, owner: 1, hp: 10 });
    expect(v.tiles.terrain).toBe(h.state.grid.layers.terrain);
  });

});

describe('SimHost (D-31) misc', () => {
  it('requires a loaded planet and honours disabled waves', () => {
    const h = new SimHost(opts);
    expect(() => h.step(1)).toThrow('no planet loaded');
    const off = new SimHost({ flags: [], modules });
    off.load(createPlanet({ type: 'flat', seed: 's', radius: 2 }));
    off.submit(cmd('h.spawn', { q: 0, r: 0 }));
    expect(off.step(1).outcomes[0].code).toBe('wave_disabled');
    void createEngineConfig;
  });

  it('size and speed at radius 56 with 500 entities', () => {
    const h = new SimHost({ flags: ['W00'], modules: [defineSimModule({ id: 'idle', wave: 'W00', handlers })] }); // no churn: idle
    h.load(createPlanet({ type: 'flat', seed: 'host', radius: 56 }));
    for (let i = 0; i < 500; i++) h.submit(cmd('h.spawn', { q: i % 50, r: (i * 7) % 50 }));
    h.step(1);
    h.step(1);
    const idle = h.diffSince(h.tick - 1).length;
    const snapBytes = h.snapshot().length;
    let c = h.clone();
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) c = h.clone();
    const cloneMs = (performance.now() - t0) / 20;
    const base = createPlanet({ type: 'flat', seed: 'host', radius: 56 });
    const t1 = performance.now();
    const full = diffSince(h.state, 0);
    applyDiff(base, full);
    const diffMs = performance.now() - t1;
    console.log(`radius 56, ${h.state.entities.count} entities: idle 1-tick diff ${idle} B, snapshot ${snapBytes} B, full diff ${full.length} B, clone ${cloneMs.toFixed(2)} ms, full diff+apply ${diffMs.toFixed(1)} ms`);
    expect(c.state).toEqual(h.state);
    expect(base).toEqual(h.state);
    expect(idle).toBeLessThan(1000);
  });
});

