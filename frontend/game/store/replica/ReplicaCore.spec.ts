import { flagsFromList } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { compileData, createEngineConfig, createPlanet, SIM_VERSION, SimHost } from '@terra/sim';
import { ReplicaCore, type DeltaInput, type WelcomeInput } from './ReplicaCore';
import { ENTITY_STRIDE, packView, unpackView } from './viewCodec';
import { TEST_MODULES } from './testModule';

const FLAGS = ['W00'];
const authority = () => {
  const h = new SimHost({ flags: FLAGS, modules: TEST_MODULES });
  h.load(createPlanet({ type: 'flat', seed: 'replica' }));
  return h;
};
const welcomeOf = (h: SimHost, over: Partial<WelcomeInput> = {}): WelcomeInput => ({
  state: h.snapshot(), tick: h.tick, flags: FLAGS, dataHash: compileData(flagsFromList(FLAGS)).hash, simVersion: SIM_VERSION, ...over,
});

/** Steps the authority with a mix of dt=1 / dt=5 and spawns / moves / kills; records one delta per 1-3 steps. */
function record(h: SimHost, rounds: number): DeltaInput[] {
  const out: DeltaInput[] = [];
  let from = h.tick, i = 0;
  for (let round = 0; round < rounds; round++) {
    const steps = 1 + (round % 3);
    for (let s = 0; s < steps; s++, i++) {
      if (i % 2 === 0) h.submit({ kind: 't.spawn', args: { q: i % 5, r: i % 3 }, colonyIndex: 0 } as never);
      if (i % 3 === 1) h.submit({ kind: 't.move', args: { id: 1 + (i % 4), x: i * 0.5 } } as never);
      if (i % 7 === 6) h.submit({ kind: 't.kill', args: { id: 1 + (i % 5) } } as never);
      h.step(i % 4 === 3 ? 5 : 1);
    }
    out.push({ fromTick: from, toTick: h.tick, diff: h.diffSince(from) });
    from = h.tick;
  }
  return out;
}

describe('ReplicaCore (acceptance: replica deep-equals the authority)', () => {
  it('welcome + recorded delta stream gives the authority state at the last tick', () => {
    const auth = authority();
    auth.step(1);
    const w = welcomeOf(auth);
    const deltas = record(auth, 40);
    const replica = new ReplicaCore({ modules: TEST_MODULES });
    expect(replica.welcome(w)).toEqual({ ok: true });
    for (const d of deltas) expect(replica.delta(d)).toEqual({ ok: true, tick: d.toTick });
    expect(replica.tick).toBe(auth.tick);
    expect(auth.state.entities.count).toBeGreaterThan(5);
    expect(replica.state).toEqual(auth.state);
    expect(replica.view()).toEqual(auth.view());
  });

  it('a skipped delta is a gap: surfaced as a resync request, later deltas are ignored until the next welcome', () => {
    const auth = authority();
    const w = welcomeOf(auth);
    const [d1, d2, d3] = record(auth, 3);
    const replica = new ReplicaCore({ modules: TEST_MODULES });
    replica.welcome(w);
    expect(replica.delta(d1).ok).toBe(true);
    const r = replica.delta(d3);
    expect(r).toMatchObject({ ok: false, reason: 'gap', request: true });
    expect(replica.status).toBe('needsResync');
    expect(replica.delta(d2)).toMatchObject({ ok: false, reason: 'awaitingResync', request: false });
    replica.welcome(welcomeOf(auth));
    expect(replica.status).toBe('ready');
    expect(replica.state).toEqual(auth.state);
  });

  it('garbage diff bytes request a resync', () => {
    const auth = authority();
    const replica = new ReplicaCore({ modules: TEST_MODULES });
    replica.welcome(welcomeOf(auth));
    expect(replica.delta({ fromTick: 0, toTick: 1, diff: new Uint8Array([1, 2, 3]) })).toMatchObject({ ok: false, reason: 'badDiff', request: true });
  });

  it('surfaces data hash and sim version mismatches as versionMismatch without loading', () => {
    const auth = authority();
    const a = new ReplicaCore({ modules: TEST_MODULES });
    expect(a.welcome(welcomeOf(auth, { dataHash: 'deadbeef' }))).toMatchObject({ ok: false, reason: 'dataHash' });
    expect(a.status).toBe('versionMismatch');
    const b = new ReplicaCore({ modules: TEST_MODULES });
    expect(b.welcome(welcomeOf(auth, { simVersion: SIM_VERSION + 1 }))).toMatchObject({ ok: false, reason: 'simVersion' });
    expect(b.status).toBe('versionMismatch');
    expect(b.delta({ fromTick: 0, toTick: 1, diff: new Uint8Array() })).toMatchObject({ ok: false, request: false });
  });

  it('config built the same way as the replica hashes identically', () => {
    expect(createEngineConfig({ flags: FLAGS, modules: TEST_MODULES }).data.hash).toBe(compileData(flagsFromList(FLAGS)).hash);
  });
});

describe('viewCodec', () => {
  it('round-trips entities, colonies and tiles; tiles only on welcome and when they changed', () => {
    const auth = authority();
    const w = welcomeOf(auth);
    const deltas = record(auth, 6);
    const replica = new ReplicaCore({ modules: TEST_MODULES });
    replica.welcome(w);
    const send = (): ReturnType<typeof unpackView> => {
      const { view, transfer } = packView(replica.view(), replica.tilesChanged());
      replica.markViewed();
      expect(transfer.length).toBe(view.tiles ? 5 : 1);
      return unpackView(view, 123);
    };
    const first = send();
    expect(first.tiles?.count).toBe(auth.view().tiles.count);
    for (const d of deltas) replica.delta(d);
    const v = replica.view();
    const { view } = packView(v, true);
    const u = unpackView(view, 123);
    expect(u.tick).toBe(v.tick);
    expect(u.serverTimeMs).toBe(123);
    expect(u.count).toBe(v.entities.length);
    expect(u.entities.length).toBe(v.entities.length * ENTITY_STRIDE);
    v.entities.forEach((e, i) => {
      const o = i * ENTITY_STRIDE;
      expect([...u.entities.subarray(o, o + ENTITY_STRIDE)]).toEqual([e.id, e.kind, e.owner, e.q, e.r, e.x, e.y, e.rot, e.hp, e.hpMax, e.state, e.progress].map(Math.fround));
    });
    expect(u.colonies).toEqual(v.colonies);
    expect(u.tiles?.terrain).toEqual(v.tiles.terrain);
    expect(u.tiles?.height).toEqual(v.tiles.height);
    expect(u.tiles?.terrain.buffer).not.toBe(v.tiles.terrain.buffer); // a copy, not the replica's memory
    // After a view with no tile change since, tiles are omitted.
    replica.markViewed();
    expect(replica.tilesChanged()).toBe(false);
    expect(unpackView(packView(replica.view(), false).view).tiles).toBeUndefined();
  });
});

describe('ReplicaCore with balance overrides (D-35)', () => {
  const OV = { dev: { probe: { nudgeTiles: 3 } } };
  it('a welcome with the server overrides compiles the same data; without them the hash mismatches', () => {
    const auth = authority();
    const dataHash = compileData(flagsFromList(FLAGS), OV).hash;
    expect(new ReplicaCore({ modules: TEST_MODULES }).welcome(welcomeOf(auth, { dataHash, overrides: OV }))).toEqual({ ok: true });
    const stale = new ReplicaCore({ modules: TEST_MODULES });
    expect(stale.welcome(welcomeOf(auth, { dataHash }))).toMatchObject({ ok: false, reason: 'dataHash' });
  });
});
