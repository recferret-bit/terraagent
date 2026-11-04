import { describe, expect, it } from 'vitest';
import {
  applyDiff,
  createEngineConfig,
  createPipeline,
  createPlanet,
  defineCommandHandler,
  defineSimModule,
  DiffGapError,
  diffSince,
  diffSinceChunked,
  encodeDiff,
  MAX_DIFF_PAYLOAD_BYTES,
  MAX_TILE_DIFF_PER_DELTA,
  PREP,
  restore,
  SimHost,
  snapshot,
  TERRAIN,
  touchTile,
  type SimCommand,
  type SimDiff,
} from '../../src';

const BRUSH_MODULE = defineSimModule({
  id: 'brush-test-module',
  wave: 'W00',
  handlers: [
    defineCommandHandler({
      kind: 'brush.tiles',
      wave: 'W00',
      handle(state, cmd, ctx) {
        const { count, terrain, prep, owner } = cmd.args as {
          count: number;
          terrain: number;
          prep: number;
          owner: number;
        };
        for (let i = 0; i < count; i++) {
          state.grid.layers.terrain[i] = terrain;
          state.grid.layers.prep[i] = prep;
          state.grid.layers.owner[i] = owner;
          touchTile(state, i, ctx.tick);
        }
      },
    }),
  ],
});

function createTestHost(radius = 10): SimHost {
  const pipeline = createPipeline(createEngineConfig({ flags: ['W00'], modules: [BRUSH_MODULE] }));
  const host = new SimHost(pipeline);
  host.load(createPlanet({ type: 'flat', seed: 'w05-19-tile-sync', radius }));
  return host;
}

function createReplica(host: SimHost): SimHost {
  const replica = new SimHost(host.pipeline);
  replica.load(host.snapshot({ forClient: true }));
  return replica;
}

describe('W05-19: Brush acceptance checks (≤ 3 deltas, payload ≤ 8 KB)', () => {
  it('Brush 200 tiles → the client receives them in ≤ 3 deltas; payload ≤ 8 KB', () => {
    const host = createTestHost();
    const replica = createReplica(host);
    const receivedDeltas: SimDiff[] = [];

    host.onDelta((delta) => {
      receivedDeltas.push(delta);
    });

    // Brush 200 tiles directly with terrain, prep and owner updates
    const targetCount = 200;
    const targetTerrain = TERRAIN.rock;
    const targetPrep = PREP.prepared;
    const targetOwner = 1;

    const nextTick = host.tick + 1;
    for (let i = 0; i < targetCount; i++) {
      host.state.grid.layers.terrain[i] = targetTerrain;
      host.state.grid.layers.prep[i] = targetPrep;
      host.state.grid.layers.owner[i] = targetOwner;
      touchTile(host.state, i, nextTick);
    }

    host.step(1);

    // Acceptance requirement: ≤ 3 deltas
    expect(receivedDeltas.length).toBeGreaterThan(0);
    expect(receivedDeltas.length).toBeLessThanOrEqual(3);
    expect(receivedDeltas.length).toBe(2); // 200 tiles / 100 per delta = 2

    // Acceptance requirement: each payload ≤ 8 KB (8192 bytes)
    for (const delta of receivedDeltas) {
      const encoded = encodeDiff(delta);
      expect(encoded.byteLength).toBeLessThanOrEqual(MAX_DIFF_PAYLOAD_BYTES);
      expect(encoded.byteLength).toBeLessThanOrEqual(8192);

      // Apply each delta in order to the replica
      replica.applyDiff(delta);
    }

    // Acceptance requirement: all 200 tiles match terrain, prep and owner on replica
    for (let i = 0; i < targetCount; i++) {
      expect(replica.state.grid.layers.terrain[i]).toBe(targetTerrain);
      expect(replica.state.grid.layers.prep[i]).toBe(targetPrep);
      expect(replica.state.grid.layers.owner[i]).toBe(targetOwner);
    }

    expect(replica.tick).toBe(host.tick);
  });

  it('Brush 200 tiles via simulation command → onDelta delivers ≤ 3 deltas of payload ≤ 8 KB', () => {
    const host = createTestHost();
    const replica = createReplica(host);
    const receivedDeltas: SimDiff[] = [];

    host.onDelta((delta) => {
      receivedDeltas.push(delta);
    });

    const brushCmd: SimCommand = {
      colonyIndex: 1,
      source: 'player',
      commandId: 'cmd_brush_200',
      kind: 'brush.tiles',
      args: {
        count: 200,
        terrain: TERRAIN.forest,
        prep: PREP.prepared,
        owner: 2,
      },
    };

    host.submit(brushCmd);
    host.step(1);

    expect(receivedDeltas.length).toBeGreaterThan(0);
    expect(receivedDeltas.length).toBeLessThanOrEqual(3);

    for (const delta of receivedDeltas) {
      const bytes = encodeDiff(delta);
      expect(bytes.byteLength).toBeLessThanOrEqual(8192);
      replica.applyDiff(delta);
    }

    for (let i = 0; i < 200; i++) {
      expect(replica.state.grid.layers.terrain[i]).toBe(TERRAIN.forest);
      expect(replica.state.grid.layers.prep[i]).toBe(PREP.prepared);
      expect(replica.state.grid.layers.owner[i]).toBe(2);
    }
  });
});

describe('W05-19: Chunking parameters and payload limit enforcement', () => {
  it('diffSinceChunked chunks 200 tiles into 2 deltas with chunk metadata and valid sizes', () => {
    const host = createTestHost();
    const tick = host.tick + 1;
    for (let i = 0; i < 200; i++) {
      host.state.grid.layers.terrain[i] = TERRAIN.rock;
      host.state.grid.layers.prep[i] = PREP.prepared;
      host.state.grid.layers.owner[i] = 1;
      touchTile(host.state, i, tick);
    }
    host.state.meta.tick = tick;

    const chunks = diffSinceChunked(host.state, 0, { forClient: true });
    expect(chunks).toHaveLength(2);

    expect(chunks[0].chunk).toEqual({ index: 0, total: 2 });
    expect(chunks[1].chunk).toEqual({ index: 1, total: 2 });
    expect(chunks[0].tiles.idx.length).toBe(MAX_TILE_DIFF_PER_DELTA);
    expect(chunks[1].tiles.idx.length).toBe(100);

    for (const chunk of chunks) {
      expect(encodeDiff(chunk).byteLength).toBeLessThanOrEqual(MAX_DIFF_PAYLOAD_BYTES);
    }

    const replicaState = restore(snapshot(host.state, { forClient: true }));
    // Reset replica to tick 0
    replicaState.meta.tick = 0;
    for (let i = 0; i < 200; i++) {
      replicaState.grid.layers.terrain[i] = TERRAIN.flat;
      replicaState.grid.layers.prep[i] = PREP.wild;
      replicaState.grid.layers.owner[i] = -1;
    }

    applyDiff(replicaState, chunks[0]);
    expect(replicaState.meta.tick).toBe(tick);
    applyDiff(replicaState, chunks[1]);

    for (let i = 0; i < 200; i++) {
      expect(replicaState.grid.layers.terrain[i]).toBe(TERRAIN.rock);
      expect(replicaState.grid.layers.prep[i]).toBe(PREP.prepared);
      expect(replicaState.grid.layers.owner[i]).toBe(1);
    }
  });

  it('respects custom maxTilesPerDelta and maxPayloadBytes', () => {
    const host = createTestHost();
    const tick = host.tick + 1;
    for (let i = 0; i < 200; i++) {
      host.state.grid.layers.terrain[i] = TERRAIN.slope;
      touchTile(host.state, i, tick);
    }
    host.state.meta.tick = tick;

    // With maxTilesPerDelta: 70 -> ceil(200 / 70) = 3 deltas (which is still ≤ 3)
    const chunks70 = diffSinceChunked(host.state, 0, { maxTilesPerDelta: 70, forClient: true });
    expect(chunks70).toHaveLength(3);
    for (const c of chunks70) {
      expect(encodeDiff(c).byteLength).toBeLessThanOrEqual(MAX_DIFF_PAYLOAD_BYTES);
    }

    // With a tighter payload limit (1500 bytes) -> chunks are subdivided
    const chunksSmall = diffSinceChunked(host.state, 0, { maxPayloadBytes: 1500, forClient: true });
    expect(chunksSmall.length).toBeGreaterThan(2);
    for (const c of chunksSmall) {
      expect(encodeDiff(c).byteLength).toBeLessThanOrEqual(1500);
    }
  });
});

describe('W05-19: Sequence ordering and backward compatibility', () => {
  it('enforces chunk sequence ordering and rejects gap or out-of-order chunks', () => {
    const host = createTestHost();
    const tick = host.tick + 1;
    for (let i = 0; i < 200; i++) {
      host.state.grid.layers.terrain[i] = TERRAIN.rock;
      touchTile(host.state, i, tick);
    }
    host.state.meta.tick = tick;

    const chunks = diffSinceChunked(host.state, 0, { forClient: true });
    const replicaState = restore(snapshot(host.state, { forClient: true }));
    replicaState.meta.tick = 0;

    // Applying chunk 1 before chunk 0 throws DiffGapError
    expect(() => applyDiff(replicaState, chunks[1])).toThrow(DiffGapError);

    // Applying chunk 0 succeeds
    applyDiff(replicaState, chunks[0]);
    expect(replicaState.meta.tick).toBe(tick);

    // Applying chunk 1 now succeeds
    applyDiff(replicaState, chunks[1]);
  });

  it('diffSince for ≤ 100 tiles behaves identically to before', () => {
    const host = createTestHost();
    const tick = host.tick + 1;
    for (let i = 0; i < 50; i++) {
      host.state.grid.layers.terrain[i] = TERRAIN.rock;
      touchTile(host.state, i, tick);
    }
    host.state.meta.tick = tick;

    const unchunkedBytes = diffSince(host.state, 0, { forClient: true });
    const chunked = diffSinceChunked(host.state, 0, { forClient: true });

    expect(chunked).toHaveLength(1);
    expect(chunked[0].tiles.idx.length).toBe(50);
    expect(unchunkedBytes.byteLength).toBeLessThanOrEqual(MAX_DIFF_PAYLOAD_BYTES);

    const repA = restore(snapshot(host.state, { forClient: true }));
    const repB = restore(snapshot(host.state, { forClient: true }));
    repA.meta.tick = 0;
    repB.meta.tick = 0;

    applyDiff(repA, unchunkedBytes);
    applyDiff(repB, chunked[0]);

    expect(repA.grid.layers.terrain).toEqual(repB.grid.layers.terrain);
  });
});
