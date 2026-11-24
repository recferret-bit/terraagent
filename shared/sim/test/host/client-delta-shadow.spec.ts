import { describe, expect, it } from 'vitest';
import {
  applyDiff, bundledClientDeltaFrames, ClientDeltaShadow, clone, clientDeltaFrames, COLONY_OWNER_FIELDS, createPlanet, decodeDiff,
  decodeValue, defineCommandHandler, encodeValue, defineSimModule, defineSystem, isDeltaBundle, nextInt, ownFramesFor, setBlob,
  SimHost, snapshot, unpackDeltaBundle, type ColonyState, type PlanetState, type SimCommand,
} from '../../src';
import { applyPatch, deepClone, deepEqual, diffValue, type Patch } from '../../src/host/structPatch';

// ---- structural patches ----------------------------------------------------------------------------------------------

describe('structPatch', () => {
  /** Diff, send the patch through the codec, apply it to a copy of `a`. */
  const roundTrip = (a: unknown, b: unknown) => {
    const copy = deepClone(a);
    const ch = diffValue(copy, b);
    if (ch && 'patch' in ch) applyPatch(copy, decodeValue(encodeValue(ch.patch)) as Patch);
    return ch && 'set' in ch ? ch.set : copy;
  };

  it('patches nested objects, deletes vanished keys (tombstones) and keeps equal values out', () => {
    const a = { x: 1, m: { a: { hp: 3, tag: 't' }, b: { hp: 1 } }, gone: 2 };
    const b = { x: 1, m: { a: { hp: 4, tag: 't' }, c: { hp: 9 } } };
    const ch = diffValue(a, b);
    expect(ch).toEqual({ patch: { d: ['gone'], p: { m: { d: ['b'], p: { a: { s: { hp: 4 } } }, s: { c: { hp: 9 } } } } } });
    expect(roundTrip(a, b)).toEqual(b);
    expect(diffValue(a, deepClone(a))).toBeUndefined();
  });

  it('treats undefined fields as absent (the codec drops them) and typed arrays by bytes', () => {
    expect(diffValue({ a: 1, u: undefined }, { a: 1 })).toBeUndefined();
    expect(diffValue({ t: new Uint16Array([1, 2]) }, { t: new Uint16Array([1, 2]) })).toBeUndefined();
    expect(diffValue({ t: new Uint16Array([1, 2]) }, { t: new Uint16Array([1, 3]) })).toEqual({ patch: { s: { t: new Uint16Array([1, 3]) } } });
    expect(diffValue({ t: new Uint16Array([1]) }, { t: new Int16Array([1]) })).toBeDefined();
  });

  it('patches arrays by index (grow / shrink) and replaces mostly-replaced arrays whole', () => {
    expect(roundTrip([1, 2, 3], [1, 5, 3, 4])).toEqual([1, 5, 3, 4]);
    expect(roundTrip([{ a: 1 }, { a: 2 }], [{ a: 1 }])).toEqual([{ a: 1 }]);
    expect(diffValue([1, 2, 3, 4], [9, 8, 7, 4])).toEqual({ set: [9, 8, 7, 4] });
    expect(diffValue([], [])).toBeUndefined();
  });

  it('keeps key order: a re-ordered object goes whole, appended keys go as a patch, index keys need no order', () => {
    expect(diffValue({ a: 1, b: 2 }, { b: 2, a: 1 })).toEqual({ set: { b: 2, a: 1 } });
    expect(diffValue({ a: 1 }, { a: 1, b: 2 })).toEqual({ patch: { s: { b: 2 } } });
    expect(diffValue({ 1: 'x', 3: 'z' }, { 1: 'x', 2: 'y', 3: 'z' })).toEqual({ patch: { s: { 2: 'y' } } });
    const patched = roundTrip({ a: 1, b: 2, c: 3 }, { a: 1, c: 3, d: 4 }) as object;
    expect(Object.keys(patched)).toEqual(['a', 'c', 'd']);
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(false);
  });

  it('refuses a patch that does not fit the target (the replica resyncs)', () => {
    expect(() => applyPatch({ a: 1 }, { n: 1 })).toThrow(/array patch/);
    expect(() => applyPatch([1], { s: { 0: 2 } })).toThrow(/object patch/);
    expect(() => applyPatch({ a: 5 }, { p: { a: { s: { x: 1 } } } })).toThrow(/not an object/);
  });

  it('copies stored values when asked (the sender shadow never aliases live state)', () => {
    const live = { m: { a: [1, 2] } };
    const shadow = { m: {} as Record<string, unknown> };
    applyPatch(shadow, { p: { m: { s: { a: live.m.a } } } }, true);
    live.m.a.push(3);
    expect(shadow.m.a).toEqual([1, 2]);
  });
});

// ---- the client delta stream -------------------------------------------------------------------------------------------

/** Churn over colonies and blobs: nested map edits, deletions, no-op rewrites, re-founds, arrays and typed arrays. */
const churn = defineSystem({ id: 'test.colonyChurn', slot: 5, wave: 'W00', run(s, ctx) {
  const g = ctx.rng('misc');
  for (const c of s.colonies) {
    if (!c) continue;
    const col = c as ColonyState & Record<string, unknown>;
    col.changedAt = ctx.tick; // like many systems: bump every tick, change sometimes
    if (nextInt(g, 0, 2) === 0) col.stock = { ...(col.stock ?? {}), ore: nextInt(g, 0, 50) };
    if (nextInt(g, 0, 3) === 0) {
      const goals = (col.goals ??= {}) as Record<string, unknown>;
      const k = `g${nextInt(g, 0, 5)}`;
      if (goals[k] && nextInt(g, 0, 1) === 0) delete goals[k]; else goals[k] = { progress: nextInt(g, 0, 9), tags: ['a', 'b'].slice(0, nextInt(g, 0, 2)) };
    }
    if (nextInt(g, 0, 2) === 0) col.power = { ...(col.power ?? {}), net: nextInt(g, -5, 5), entityPower: { [nextInt(g, 1, 4)]: { overloaded: nextInt(g, 0, 1) === 1 } } };
    if (nextInt(g, 0, 4) === 0) { if (col.currentJob) delete col.currentJob; else col.currentJob = { kind: 'build', t: ctx.tick }; }
    if (nextInt(g, 0, 3) === 0) {
      const q = (col.queue ??= []) as unknown[];
      if (q.length > 2 || (q.length && nextInt(g, 0, 1) === 0)) q.shift(); else q.push({ id: ctx.tick, left: nextInt(g, 1, 9) });
    }
    col.diplomacy = { truces: [...((col.diplomacy as { truces?: number[] })?.truces ?? [])] }; // identical rewrite
    if (nextInt(g, 0, 40) === 0) col.status = col.status === 'active' ? 'critical' : 'active';
  }
  if (nextInt(g, 0, 2) === 0) {
    const prev = (s.blobs.units?.value ?? { byId: {} }) as { byId: Record<string, unknown> };
    const byId = { ...prev.byId };
    const id = String(nextInt(g, 1, 12));
    if (byId[id] && nextInt(g, 0, 2) === 0) delete byId[id]; else byId[id] = { order: nextInt(g, 0, 3), path: [nextInt(g, 0, 9)] };
    setBlob(s, 'units', { byId }, ctx.tick);
  }
  if (nextInt(g, 0, 3) === 0) setBlob(s, 'lanes', { n: nextInt(g, 0, 3), arr: new Uint16Array([ctx.tick & 0xffff]) }, ctx.tick);
  if (s.blobs.goalsBlob) s.blobs.goalsBlob.changedAt = ctx.tick; // spurious bump, same value
  else setBlob(s, 'goalsBlob', { byColony: { 0: { a: 1 } } }, ctx.tick);
} });

const handlers = [
  defineCommandHandler({ kind: 'c.found', wave: 'W00', handle(s, c, ctx) {
    const i = (c.args as { i: number }).i;
    s.colonies[i] = { index: i, id: `col_${i}_${ctx.tick}`, name: `C${i}`, color: 0x3388ff, status: 'active', changedAt: ctx.tick, stock: { ore: 1 }, goals: {} };
  } }),
];
const modules = [defineSimModule({ id: 'delta-shadow-test', wave: 'W00', systems: [churn], handlers })];
let n = 0;
const cmd = (kind: string, args: unknown): SimCommand => ({ colonyIndex: null, source: 'dev', commandId: `d${++n}`, kind, args });

function authority(): SimHost {
  const h = new SimHost({ flags: ['W00'], modules });
  h.load(createPlanet({ type: 'flat', seed: 'delta-shadow', radius: 6 }));
  for (let i = 0; i < 3; i++) h.submit(cmd('c.found', { i }));
  h.step(1);
  return h;
}

/** What a socket of `own` (undefined: full viewer) must hold: own colony whole, others' summary fields. */
function clientView(state: PlanetState, own: number | undefined): unknown {
  // Of a copy: a client-bound snapshot of the streamed state itself is a welcome, which reconciles the shadow.
  const s = (decodeValue(snapshot(clone(state), { forClient: true })) as { state: { colonies: Array<Record<string, unknown>> } }).state;
  s.colonies = s.colonies.map((c) => (own === undefined || c.index === own ? c
    : Object.fromEntries(Object.entries(c).filter(([k]) => !COLONY_OWNER_FIELDS.has(k)))));
  return s;
}

function joiner(h: SimHost): SimHost {
  const r = new SimHost({ flags: ['W00'], modules });
  r.load(h.snapshot({ forClient: true }));
  return r;
}

describe('client delta shadow: round trip per viewer', () => {
  it('full and own-colony replicas equal the authority view after every window, over hundreds of ticks with commands', () => {
    const h = authority();
    const g = new Uint32Array([3, 1, 4, 1]);
    let last = h.tick;
    bundledClientDeltaFrames(h.state, last); // nothing to send yet: seeds nothing, sets the stream start
    const full = joiner(h), own1 = joiner(h);
    let late: SimHost | null = null;
    for (let t = 0; t < 300; t++) {
      if (nextInt(g, 0, 60) === 0) h.submit(cmd('c.found', { i: nextInt(g, 0, 3) })); // re-found / new colony
      h.step(1);
      const frames = bundledClientDeltaFrames(h.state, last);
      last = h.tick;
      for (const f of frames) {
        full.applyDiff(f.diff);
        const { diff, own } = unpackDeltaBundle(f.diff);
        own1.applyDiff(diff, ownFramesFor(own, 1));
        late?.applyDiff(diff, ownFramesFor(own, 1));
      }
      expect(clientView(full.state, undefined)).toEqual(clientView(h.state, undefined));
      expect(clientView(own1.state, 1)).toEqual(clientView(h.state, 1));
      if (late) expect(clientView(late.state, 1)).toEqual(clientView(h.state, 1));
      if (t === 120) late = joiner(h); // a welcome mid-stream: a delta boundary
    }
    expect(full.state).toEqual(h.state); // the full viewer holds everything, changedAt stamps included
  }, 60_000);

  it('sends only changed fields: an identical rewrite or a bare changedAt bump carries no field data', () => {
    const h = authority();
    let last = h.tick;
    bundledClientDeltaFrames(h.state, last);
    h.step(1);
    bundledClientDeltaFrames(h.state, last); last = h.tick;
    h.step(1);
    const d = decodeDiff(clientDeltaFrames(h.state, last, { shadow: new ClientDeltaShadow() })[0].diff);
    expect(d.colonies.length).toBe(3); // a fresh shadow knows nothing: whole records
    const [f] = bundledClientDeltaFrames(h.state, last);
    const shadowed = decodeDiff(f.diff);
    expect(shadowed.colonies).toEqual([]);
    for (const e of shadowed.colonyPatches ?? []) {
      expect(e.p.s?.diplomacy).toBeUndefined(); // rewritten identical every tick
      for (const k of Object.keys({ ...e.p.s, ...e.p.p })) expect(COLONY_OWNER_FIELDS.has(k)).toBe(false);
    }
    expect(shadowed.blobPatches?.goalsBlob).toEqual({ s: { changedAt: h.tick } }); // spurious bump: the stamp only
    expect(shadowed.blobs.goalsBlob).toBeUndefined();
  });

  it('resets on a window that does not continue the last one (re-subscribe), so a value that went A→B→A is resent', () => {
    const h = authority();
    let last = h.tick;
    bundledClientDeltaFrames(h.state, last);
    h.step(1); bundledClientDeltaFrames(h.state, last);
    const col = h.state.colonies[0] as Record<string, unknown>;
    const before = deepClone(col.stock);
    // Unsubscribed: no deltas while the value moves; a socket joins at B; the value returns to A.
    col.stock = { ore: 777 }; h.step(1);
    const welcomeAt = joiner(h); last = h.tick;
    col.stock = before; h.state.colonies[0].changedAt = h.tick + 1; h.step(1);
    const frames = bundledClientDeltaFrames(h.state, last);
    for (const f of frames) welcomeAt.applyDiff(f.diff);
    expect(clientView(welcomeAt.state, undefined)).toEqual(clientView(h.state, undefined));
  });

});

describe('client delta shadow: welcomes, bundles and refusals', () => {
  it('a socket welcomed after an unstamped write still converges (the welcome snapshot reconciles the shadow)', () => {
    const h = new SimHost({ flags: ['W00'], modules: [] });
    h.load(createPlanet({ type: 'flat', seed: 'delta-unstamped', radius: 4 }));
    const units = () => h.state.blobs.units.value as { byId: Record<string, { current: string | null; x?: number }> };
    setBlob(h.state, 'units', { byId: { 1: { current: 'move' }, 2: { current: 'idle', x: 0 } } }, h.tick);
    let last = h.tick;
    const early = joiner(h), whole = joiner(h);
    const send = () => {
      for (const f of clientDeltaFrames(h.state, last)) whole.applyDiff(f.diff);
      for (const f of bundledClientDeltaFrames(h.state, last)) { early.applyDiff(f.diff); late?.applyDiff(f.diff); }
      last = h.tick;
    };
    let late: SimHost | null = null;
    h.step(1); h.state.blobs.units.changedAt = h.tick; send(); // the shadow holds the blob
    units().byId[1].current = null; delete units().byId[2]; // unstamped (as auto unit commands are)
    h.step(1); send();
    late = joiner(h); // holds the unstamped values
    units().byId[1].current = 'move'; units().byId[2] = { current: 'idle', x: 5 }; // back to what the shadow holds, plus a change
    h.step(1); h.state.blobs.units.changedAt = h.tick; send();
    expect(late.state.blobs.units).toEqual(h.state.blobs.units);
    expect(early.state).toEqual(whole.state);
  });

  it('applyDiff on a host bundle applies every own frame (anti-cheat replica); a plain diff is not a bundle', () => {
    const h = authority();
    let last = h.tick;
    bundledClientDeltaFrames(h.state, last);
    const r = joiner(h);
    let sawBundle = false;
    for (let t = 0; t < 20; t++) {
      h.step(1);
      for (const f of bundledClientDeltaFrames(h.state, last)) { sawBundle ||= isDeltaBundle(f.diff); applyDiff(r.state, f.diff); }
      last = h.tick;
    }
    expect(sawBundle).toBe(true);
    expect(r.state).toEqual(h.state);
    expect(isDeltaBundle(h.diffSince(0, { forClient: true }))).toBe(false);
  });

  it('refuses own frames for another tick and patches for colonies the replica does not hold', () => {
    const h = authority();
    let last = h.tick;
    bundledClientDeltaFrames(h.state, last);
    let r = joiner(h);
    let cut = unpackDeltaBundle(new Uint8Array(0));
    for (let t = 0; t < 20 && cut.own.length === 0; t++) {
      r = joiner(h);
      h.step(1);
      cut = unpackDeltaBundle(bundledClientDeltaFrames(h.state, last)[0].diff); last = h.tick;
    }
    const { diff, own } = cut;
    expect(own.length).toBeGreaterThan(0);
    const stale = joiner(h); // already at toTick
    expect(() => stale.applyDiff(diff, ownFramesFor(own, undefined))).toThrow();
    r.state.colonies.length = 0;
    expect(() => r.applyDiff(diff, ownFramesFor(own, undefined))).toThrow(/unknown colony/);
  });
});
