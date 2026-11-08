import { describe, expect, it } from 'vitest';
import {
  clientDeltaFrames,
  COLONY_EXPLORED_BLOB,
  countScoutedTilesOutsideRing,
  countTotalExploredTiles,
  createState,
  decodeValue,
  encodeValue,
  getExploredByColony,
  hexIndex,
  isColonyTileExplored,
  isTileExplored,
  markTileExplored,
  restore,
  revealVision,
  SimHost,
  snapshot,
  spawnHqUnit,
  updateColonyVisionCache,
  view,
  type ColonyExploredBlobValue,
} from '../../src';

describe('W11-39 · Per-colony exploration representation without shared-mask leakage', () => {
  it('isolates markTileExplored and isTileExplored across colonies 0, 1, 8, 9, 31, 32, 128 and 2251', () => {
    const state = createState({
      planetId: 'pl_w11_39_iso',
      planetType: 'temperate',
      seed: 'w11-39-iso',
      radius: 8,
    });
    const colonies = [0, 1, 8, 9, 31, 32, 128, 2251] as const;
    const assignedTiles = new Map<number, number[]>();

    colonies.forEach((col, idx) => {
      const tiles = [idx * 3, idx * 3 + 1, idx * 3 + 2];
      assignedTiles.set(col, tiles);
      for (const t of tiles) {
        markTileExplored(state.grid, t, col, 1);
      }
    });

    // Legacy u8 layer is written only for colonies 0..7; high-index colonies never touch or read layers.explored.
    expect(state.grid.layers.explored[0]).toBe(1 << 0);
    expect(state.grid.layers.explored[3]).toBe(1 << 1);
    expect(state.grid.layers.explored[6]).toBe(0); // Colony 8
    expect(state.grid.layers.explored[9]).toBe(0); // Colony 9
    expect(state.grid.layers.explored[15]).toBe(0); // Colony 32 (no 1 << 32 === 1 wraparound)

    for (const viewer of colonies) {
      for (const [owner, tiles] of assignedTiles.entries()) {
        for (const t of tiles) {
          expect(isTileExplored(state.grid, t, viewer)).toBe(viewer === owner);
          expect(isColonyTileExplored(view(state).tiles, t, viewer)).toBe(viewer === owner);
        }
      }
      expect(countTotalExploredTiles(state, viewer)).toBe(3);
    }

    // Reject negative or out-of-range indices cleanly.
    expect(isTileExplored(state.grid, 0, -1)).toBe(false);
    expect(isTileExplored(state.grid, -1, 9)).toBe(false);
    expect(isTileExplored(state.grid, state.grid.count + 10, 9)).toBe(false);
    markTileExplored(state.grid, 0, -1, 2);
    expect(countTotalExploredTiles(state, -1)).toBe(0);
  });

  it('reveals HQ vision and counts scouted tiles outside ring accurately for Colony 9 and Colony 2251', () => {
    const state = createState({
      planetId: 'pl_w11_39_hq',
      planetType: 'desert',
      seed: 'w11-39-hq',
      radius: 16,
    });
    const hx = hexIndex(state.grid.radius);

    spawnHqUnit(state, { owner: 0, q: -6, r: 0, tick: 1 });
    spawnHqUnit(state, { owner: 9, q: 6, r: 0, tick: 1 });
    revealVision(state, 2251, -6, 12, 2, 1);

    const center0 = hx.indexOf(-6, 0);
    const center9 = hx.indexOf(6, 0);
    const center2251 = hx.indexOf(-6, 12);

    expect(isTileExplored(state.grid, center9, 9)).toBe(true);
    expect(isTileExplored(state.grid, center9, 0)).toBe(false);
    expect(isTileExplored(state.grid, center9, 1)).toBe(false);
    expect(isTileExplored(state.grid, center0, 9)).toBe(false);
    expect(isTileExplored(state.grid, center2251, 2251)).toBe(true);
    expect(isTileExplored(state.grid, center2251, 9)).toBe(false);
    expect(isTileExplored(state.grid, center2251, 0)).toBe(false);

    // Radius 2 hex disk has 1 + 6 + 12 = 19 tiles.
    expect(countTotalExploredTiles(state, 2251)).toBe(19);
    const initial9 = countTotalExploredTiles(state, 9);
    expect(initial9).toBeGreaterThan(100);
    expect(countScoutedTilesOutsideRing(state, 9, initial9)).toBe(0);

    // Colony 9 scouts 6 tiles well outside its HQ vision ring (distance > 9 from (6, 0)).
    const farCoords: Array<[number, number]> = [
      [-10, 0],
      [-10, 1],
      [-10, 2],
      [-9, -1],
      [-9, 0],
      [-9, 1],
    ];
    for (const [q, r] of farCoords) {
      markTileExplored(state.grid, hx.indexOf(q, r), 9, 2);
    }
    expect(countTotalExploredTiles(state, 9)).toBe(initial9 + 6);
    expect(countScoutedTilesOutsideRing(state, 9, initial9)).toBe(6);

    // Update combat vision cache and verify Colony 9 spotted tiles also record exploration.
    updateColonyVisionCache(state, 5, undefined, true);
    expect(isTileExplored(state.grid, center9, 9)).toBe(true);
  });
});

describe('W11-39 · Snapshot migration and SimHost delta replication', () => {
  it('hydrates colonyExplored from legacy SIM_VERSION 3 snapshots with u8 explored bitmasks and allows Colony 9 to explore independently', () => {
    const legacyBase = createState({
      planetId: 'pl_w11_39_legacy',
      planetType: 'ocean',
      seed: 'w11-39-legacy',
      radius: 5,
    });
    const raw = decodeValue(snapshot(legacyBase)) as {
      header: { simVersion: number };
      state: {
        meta: { simVersion: number; tick: number };
        grid: { count: number; layers: Record<string, unknown> };
        blobs: Record<string, unknown>;
      };
    };
    raw.header.simVersion = 3;
    raw.state.meta.simVersion = 3;
    raw.state.meta.tick = 12;
    delete raw.state.blobs[COLONY_EXPLORED_BLOB];

    const legacyExplored = new Uint8Array(raw.state.grid.count);
    legacyExplored[2] = (1 << 0) | (1 << 1); // Colonies 0 and 1
    legacyExplored[7] = 1 << 7; // Colony 7
    raw.state.grid.layers.explored = legacyExplored;

    const restored = restore(encodeValue(raw));
    expect(restored. blobs[COLONY_EXPLORED_BLOB]).toBeDefined();
    const blobVal = restored.blobs[COLONY_EXPLORED_BLOB]!.value as ColonyExploredBlobValue;
    expect(blobVal.tileCount).toBe(restored.grid.count);

    expect(isTileExplored(restored.grid, 2, 0)).toBe(true);
    expect(isTileExplored(restored.grid, 2, 1)).toBe(true);
    expect(isTileExplored(restored.grid, 2, 7)).toBe(false);
    expect(isTileExplored(restored.grid, 2, 9)).toBe(false);
    expect(isTileExplored(restored.grid, 7, 7)).toBe(true);
    expect(isTileExplored(restored.grid, 7, 9)).toBe(false);

    // Colony 9 explores tile 14 on the migrated planet without affecting colonies 0..7 or leaking from them.
    markTileExplored(restored.grid, 14, 9, 13);
    expect(isTileExplored(restored.grid, 14, 9)).toBe(true);
    expect(isTileExplored(restored.grid, 14, 0)).toBe(false);
    expect(isTileExplored(restored.grid, 14, 1)).toBe(false);
    expect(isTileExplored(restored.grid, 2, 9)).toBe(false);
    expect(getExploredByColony(restored)[9]).toBeInstanceOf(Uint8Array);
  });

  it('replicates Colony 9 and Colony 2251 exploration across SimHost diffSince, clientDeltaFrames and applyDiff', () => {
    const auth = new SimHost({ flags: ['W00', 'W01', 'W11'], modules: [] });
    auth.load(createState({ planetId: 'pl_w11_39_diff', planetType: 'temperate', seed: 'w11-39-diff', radius: 5 }));
    const replica = new SimHost({ flags: ['W00', 'W01', 'W11'], modules: [] });
    replica.load(auth.snapshot({ forClient: true }));

    auth.step(1);
    const t1 = auth.tick;
    markTileExplored(auth.state.grid, 4, 9, t1);
    markTileExplored(auth.state.grid, 11, 2251, t1);

    for (const frame of clientDeltaFrames(auth.state, 0)) {
      replica.applyDiff(frame.diff);
    }

    expect(isTileExplored(replica.state.grid, 4, 9)).toBe(true);
    expect(isTileExplored(replica.state.grid, 4, 0)).toBe(false);
    expect(isTileExplored(replica.state.grid, 4, 2251)).toBe(false);
    expect(isTileExplored(replica.state.grid, 11, 2251)).toBe(true);
    expect(isTileExplored(replica.state.grid, 11, 9)).toBe(false);

    const replicaView = replica.view();
    expect(isColonyTileExplored(replicaView.tiles, 4, 9)).toBe(true);
    expect(isColonyTileExplored(replicaView.tiles, 11, 2251)).toBe(true);
    expect(isColonyTileExplored(replicaView.tiles, 4, 2251)).toBe(false);
  });
});
