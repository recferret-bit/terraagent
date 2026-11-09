import { describe, expect, it } from 'vitest';
import {
  canMigrateSnapshot,
  claimTerritoryRadius,
  clientDeltaFrames,
  createState,
  decodeValue,
  diffSince,
  encodeValue,
  ENTITY_KIND,
  extractTileChanges,
  hexIndex,
  insertRow,
  restore,
  setField,
  setTileOwner,
  SIM_VERSION,
  SimHost,
  snapshot,
  view,
} from '../../src';

const WIDE_OWNERS = [128, 512, 2251, 15000] as const;

describe('W11-37 · Wide owner storage and snapshot round-trip', () => {
  it('allocates Int16Array for tile and entity owner columns and preserves > 127, > 2,250 and -1 sentinel', () => {
    const state = createState({
      planetId: 'pl_wide_owner',
      planetType: 'temperate',
      seed: 'w11-37-seed',
      radius: 6,
    });

    expect(state.meta.simVersion).toBe(4);
    expect(SIM_VERSION).toBe(4);
    expect(state.grid.layers.owner).toBeInstanceOf(Int16Array);
    expect(state.entities.cols.owner).toBeInstanceOf(Int16Array);

    WIDE_OWNERS.forEach((ownerIdx, i) => {
      setTileOwner(state.grid, i, ownerIdx, 1);
      const row = insertRow(state.entities, state.meta.nextEntityId++, 1);
      state.entities.cols.kind[row] = ENTITY_KIND.worker;
      setField(state.entities, row, 'owner', ownerIdx, 1);
    });
    const unownedRow = insertRow(state.entities, state.meta.nextEntityId++, 1);
    expect(state.entities.cols.owner[unownedRow]).toBe(-1);

    WIDE_OWNERS.forEach((ownerIdx, i) => {
      expect(state.grid.layers.owner[i]).toBe(ownerIdx);
      expect(state.entities.cols.owner[i]).toBe(ownerIdx);
    });
    expect(state.grid.layers.owner[WIDE_OWNERS.length]).toBe(-1);

    const simView = view(state);
    expect(simView.tiles.owner).toBeInstanceOf(Int16Array);
    WIDE_OWNERS.forEach((ownerIdx, i) => {
      expect(simView.tiles.owner[i]).toBe(ownerIdx);
      expect(simView.entities[i]?.owner).toBe(ownerIdx);
    });
    expect(simView.entities[WIDE_OWNERS.length]?.owner).toBe(-1);
  });

  it('round-trips wide owner indices (128, 512, 2251, 15000) and -1 through snapshot/restore and forClient snapshots', () => {
    const state = createState({
      planetId: 'pl_wide_snap',
      planetType: 'desert',
      seed: 'w11-37-snap',
      radius: 5,
    });

    WIDE_OWNERS.forEach((ownerIdx, i) => {
      setTileOwner(state.grid, i * 2, ownerIdx, 2);
      const row = insertRow(state.entities, state.meta.nextEntityId++, 2);
      state.entities.cols.kind[row] = ENTITY_KIND.commandHub;
      setField(state.entities, row, 'owner', ownerIdx, 2);
    });
    insertRow(state.entities, state.meta.nextEntityId++, 2);

    const restored = restore(snapshot(state));
    expect(restored.meta.simVersion).toBe(SIM_VERSION);
    expect(restored.grid.layers.owner).toBeInstanceOf(Int16Array);
    expect(restored.entities.cols.owner).toBeInstanceOf(Int16Array);

    const clientRestored = restore(snapshot(state, { forClient: true }));
    expect(clientRestored.grid.layers.owner).toBeInstanceOf(Int16Array);
    expect(clientRestored.entities.cols.owner).toBeInstanceOf(Int16Array);

    WIDE_OWNERS.forEach((ownerIdx, i) => {
      expect(restored.grid.layers.owner[i * 2]).toBe(ownerIdx);
      expect(restored.grid.layers.owner[i * 2 + 1]).toBe(-1);
      expect(restored.entities.cols.owner[i]).toBe(ownerIdx);
      expect(clientRestored.grid.layers.owner[i * 2]).toBe(ownerIdx);
      expect(clientRestored.entities.cols.owner[i]).toBe(ownerIdx);
    });
    expect(restored.entities.cols.owner[WIDE_OWNERS.length]).toBe(-1);
    expect(clientRestored.entities.cols.owner[WIDE_OWNERS.length]).toBe(-1);
  });
});

describe('W11-37 · Legacy snapshot migration and delta replication', () => {
  it('migrates legacy SIM_VERSION 2 and 3 snapshots with Int8Array owner columns to SIM_VERSION 4 Int16Array', () => {
    for (const legacyVersion of [2, 3] as const) {
      expect(canMigrateSnapshot(legacyVersion, SIM_VERSION)).toBe(true);
      const base = createState({
        planetId: `pl_legacy_v${legacyVersion}`,
        planetType: 'ocean',
        seed: `v${legacyVersion}`,
        radius: 4,
      });
      const r0 = insertRow(base.entities, base.meta.nextEntityId++, 1);
      const r1 = insertRow(base.entities, base.meta.nextEntityId++, 1);
      const r2 = insertRow(base.entities, base.meta.nextEntityId++, 1);

      const raw = decodeValue(snapshot(base)) as {
        header: { simVersion: number };
        state: {
          meta: { simVersion: number };
          grid: { count: number; layers: Record<string, unknown> };
          entities: { capacity: number; cols: Record<string, unknown> };
        };
      };
      raw.header.simVersion = legacyVersion;
      raw.state.meta.simVersion = legacyVersion;

      const legacyTileOwner = new Int8Array(raw.state.grid.count).fill(-1);
      legacyTileOwner[0] = 0;
      legacyTileOwner[1] = 7;
      legacyTileOwner[2] = 127;
      raw.state.grid.layers.owner = legacyTileOwner;

      const legacyEntityOwner = new Int8Array(raw.state.entities.capacity);
      legacyEntityOwner[r0] = 0;
      legacyEntityOwner[r1] = 127;
      legacyEntityOwner[r2] = -1;
      raw.state.entities.cols.owner = legacyEntityOwner;

      const upgraded = restore(encodeValue(raw));
      expect(upgraded.meta.simVersion).toBe(4);
      expect(upgraded.grid.layers.owner).toBeInstanceOf(Int16Array);
      expect(upgraded.entities.cols.owner).toBeInstanceOf(Int16Array);
      expect([upgraded.grid.layers.owner[0], upgraded.grid.layers.owner[1], upgraded.grid.layers.owner[2], upgraded.grid.layers.owner[3]]).toEqual([0, 7, 127, -1]);
      expect([upgraded.entities.cols.owner[r0], upgraded.entities.cols.owner[r1], upgraded.entities.cols.owner[r2]]).toEqual([0, 127, -1]);
    }
  });

  it('propagates wide owner changes (128, 2251, -1) across diffSince, clientDeltaFrames, applyDiff and territory claim', () => {
    const auth = new SimHost({ flags: ['W00', 'W01'], modules: [] });
    auth.load(createState({ planetId: 'pl_wide_diff', planetType: 'temperate', seed: 'w11-37-diff', radius: 6 }));
    const replica = new SimHost({ flags: ['W00', 'W01'], modules: [] });
    replica.load(auth.snapshot({ forClient: true }));

    auth.step(1);
    const tick1 = auth.tick;
    setTileOwner(auth.state.grid, 0, 128, tick1);
    setTileOwner(auth.state.grid, 1, 2251, tick1);
    const eRow0 = insertRow(auth.state.entities, auth.state.meta.nextEntityId++, tick1);
    setField(auth.state.entities, eRow0, 'owner', 128, tick1);
    const eRow1 = insertRow(auth.state.entities, auth.state.meta.nextEntityId++, tick1);
    setField(auth.state.entities, eRow1, 'owner', 2251, tick1);

    for (const f of clientDeltaFrames(auth.state, 0)) replica.applyDiff(f.diff);
    expect([replica.state.grid.layers.owner[0], replica.state.grid.layers.owner[1]]).toEqual([128, 2251]);
    expect([replica.state.entities.cols.owner[eRow0], replica.state.entities.cols.owner[eRow1]]).toEqual([128, 2251]);

    const changes = extractTileChanges(diffSince(auth.state, 0));
    expect(changes.find((c) => c.tileIdx === 0)?.owner).toBe(128);
    expect(changes.find((c) => c.tileIdx === 1)?.owner).toBe(2251);

    auth.step(1);
    const tick2 = auth.tick;
    setTileOwner(auth.state.grid, 0, -1, tick2);
    setField(auth.state.entities, eRow0, 'owner', -1, tick2);
    const claim = claimTerritoryRadius(auth.state, { colonyId: 2251, q: 2, r: 0, radius: 2, tick: tick2 });
    expect(claim.claimedCount).toBeGreaterThan(0);

    for (const f of clientDeltaFrames(auth.state, tick1)) replica.applyDiff(f.diff);
    expect([replica.state.grid.layers.owner[0], replica.state.entities.cols.owner[eRow0]]).toEqual([-1, -1]);
    expect(replica.state.grid.layers.owner[hexIndex(replica.state.grid.radius).indexOf(2, 0)]).toBe(2251);
  });
});
