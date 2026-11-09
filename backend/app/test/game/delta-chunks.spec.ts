import 'reflect-metadata';
import { applyDiff, MAX_DIFF_PAYLOAD_BYTES, MAX_TILE_DIFF_PER_DELTA, PREP, restore, snapshot, TERRAIN, touchTile, type PlanetState } from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { PlanetHost } from '../../src/game/thread/planet-host';
import { W00_PLANET_TYPE, type FromThread } from '../../src/game/thread/protocol';

// W05-19 on the online server: the sim thread sends a large tile change as capped chunks through the same
// `clientDeltaFrames` path as the local host, and a replica that applies every frame in order ends equal to the server.

const PLANET = 'pl_chunks';
type Delta = Extract<FromThread, { t: 'delta' }>;

function rig() {
  let now = 0;
  const deltas: Delta[] = [];
  const host = new PlanetHost(0, ['W00', 'W01'], (m: FromThread) => { if (m.t === 'delta') deltas.push(m); }, undefined, { now: () => now });
  host.handle({ t: 'load', planetId: PLANET, params: { type: W00_PLANET_TYPE } });
  host.handle({ t: 'subscribe', planetId: PLANET });
  const state = (): PlanetState => host.planets.get(PLANET)!.state;
  const replica = restore(snapshot(state(), { forClient: true }));
  const flush = () => { now += 1000; host.flushDeltas(); };
  return { host, deltas, state, replica, flush };
}

describe('W05-19: server deltas are chunked like the local host', () => {
  it('a 200-tile brush leaves the thread as ≤ 3 chained frames of ≤ 8 KB that rebuild the server state', () => {
    const { host, deltas, state, replica, flush } = rig();
    const s = state();
    const startTick = s.meta.tick;
    for (let i = 0; i < 200; i++) {
      s.grid.layers.terrain[i] = TERRAIN.rock;
      s.grid.layers.prep[i] = PREP.prepared;
      touchTile(s, i, startTick + 1);
    }
    host.stepPlanet(PLANET, 1);
    flush();

    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.length).toBeLessThanOrEqual(3);
    expect(deltas[0]!.fromTick).toBe(startTick);
    for (const d of deltas) {
      expect(d.toTick).toBe(s.meta.tick);
      expect(d.diff.byteLength).toBeLessThanOrEqual(MAX_DIFF_PAYLOAD_BYTES);
    }
    // continuation frames span toTick → toTick: "a delta starts where the last one ended" holds for every frame
    for (let i = 1; i < deltas.length; i++) expect(deltas[i]!.fromTick).toBe(deltas[i - 1]!.toTick);
    expect(deltas.slice(1).every((d) => d.events.length === 0)).toBe(true);

    for (const d of deltas) applyDiff(replica, d.diff);
    expect(replica.meta.tick).toBe(s.meta.tick);
    for (let i = 0; i < 200; i++) {
      expect(replica.grid.layers.terrain[i]).toBe(TERRAIN.rock);
      expect(replica.grid.layers.prep[i]).toBe(PREP.prepared);
    }
  });

  it('a small change stays one frame', () => {
    const { host, deltas, state, flush } = rig();
    const s = state();
    for (let i = 0; i < MAX_TILE_DIFF_PER_DELTA / 2; i++) touchTile(s, i, s.meta.tick + 1);
    host.stepPlanet(PLANET, 1);
    flush();
    expect(deltas).toHaveLength(1);
  });
});
