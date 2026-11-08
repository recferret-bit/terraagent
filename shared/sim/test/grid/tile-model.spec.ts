import { describe, expect, it } from 'vitest';
import {
  blocksDirectFire,
  compileData,
  createPlanet,
  decodeDiff,
  DEPOSIT,
  DEPOSIT_KEYS,
  depositIdFromKey,
  depositKeyFromId,
  extractTileChanges,
  groundMoveMultiplierBp,
  hexIndex,
  isBuildablePrepared,
  isGroundPassable,
  isTileExplored,
  isValidTileIndex,
  markTileExplored,
  PREP,
  PREP_KEYS,
  prepIdFromKey,
  prepKeyFromId,
  setTileDeposit,
  setTileHeight,
  setTileOwner,
  setTilePrep,
  setTileTerrain,
  SimHost,
  TERRAIN,
  TERRAIN_KEYS,
  terrainIdFromKey,
  terrainKeyFromId,
} from '../../src';

describe('W01-08 tile model: enum conversions and layer accessors', () => {
  it('converts terrain, prep and deposit keys <-> numeric codes', () => {
    expect(TERRAIN_KEYS).toEqual(['flat', 'forest', 'rock', 'slope', 'hole', 'shallow', 'deep']);
    for (let id = 0; id < TERRAIN_KEYS.length; id++) {
      const key = terrainKeyFromId(id);
      expect(key).toBe(TERRAIN_KEYS[id]);
      expect(terrainIdFromKey(key)).toBe(id);
      expect(terrainIdFromKey(key.toUpperCase())).toBe(id);
    }
    expect(() => terrainIdFromKey('lava')).toThrow(/unknown terrain key/);
    expect(() => terrainKeyFromId(99)).toThrow(RangeError);

    expect(PREP_KEYS).toEqual(['wild', 'flat', 'prepared', 'irrigated', 'living', 'ridge', 'moat']);
    for (let id = 0; id < PREP_KEYS.length; id++) {
      const key = prepKeyFromId(id);
      expect(key).toBe(PREP_KEYS[id]);
      expect(prepIdFromKey(key)).toBe(id);
      expect(prepIdFromKey(key.toUpperCase())).toBe(id);
    }
    expect(() => prepIdFromKey('paved')).toThrow(/unknown prep key/);
    expect(() => prepKeyFromId(-1)).toThrow(RangeError);

    expect(DEPOSIT_KEYS).toEqual(['none', 'metals', 'minerals', 'oil']);
    for (let id = 0; id < DEPOSIT_KEYS.length; id++) {
      const key = depositKeyFromId(id);
      expect(key).toBe(DEPOSIT_KEYS[id]);
      expect(depositIdFromKey(key)).toBe(id);
    }
    expect(() => depositIdFromKey('uranium')).toThrow(/unknown deposit key/);
    expect(() => depositKeyFromId(9)).toThrow(RangeError);

    expect(TERRAIN.Flat).toBe(TERRAIN.flat);
    expect(PREP.Prepared).toBe(PREP.prepared);
    expect(DEPOSIT.Metals).toBe(DEPOSIT.metals);
  });

  it('validates tile indices against the grid count', () => {
    const state = createPlanet({ type: 'flat', seed: 'idx', radius: 2 });
    expect(isValidTileIndex(state, 0)).toBe(true);
    expect(isValidTileIndex(state.grid, state.grid.count - 1)).toBe(true);
    expect(isValidTileIndex(state.grid, -1)).toBe(false);
    expect(isValidTileIndex(state.grid, state.grid.count)).toBe(false);

    const bare = { count: 3, terrain: new Uint8Array(3), prep: new Uint8Array(3) };
    expect(isValidTileIndex(bare, 2)).toBe(true);
    expect(isValidTileIndex(bare, 1.5)).toBe(false);
    expect(isGroundPassable(bare, 3)).toBe(false);
  });
});

describe('W01-08 tile model: ground passability, movement multipliers and buildability (§4.8)', () => {
  it('evaluates passability and multipliers across all 7 terrain classes and prep states', () => {
    const state = createPlanet({ type: 'flat', seed: 'move', radius: 3 });
    const data = compileData(new Set(['W00', 'W01']));
    const expectedWild: ReadonlyArray<[number, boolean, number, number]> = [
      [TERRAIN.flat, true, 10000, 1.0],
      [TERRAIN.forest, true, 6000, 0.6],
      [TERRAIN.rock, true, 5000, 0.5],
      [TERRAIN.slope, true, 7000, 0.7],
      [TERRAIN.hole, true, 5000, 0.5],
      [TERRAIN.shallow, true, 5000, 0.5],
      [TERRAIN.deep, false, 0, 0.0],
    ];

    for (let i = 0; i < expectedWild.length; i++) {
      const [terrainCode, passable, bp, mult] = expectedWild[i];
      setTileTerrain(state.grid, i, terrainCode);
      setTilePrep(state.grid, i, PREP.wild);
      expect(isGroundPassable(state.grid, i, data)).toBe(passable);
      expect(groundMoveMultiplierBp(state.grid, i, data)).toBe(bp);
      expect(groundMoveMultiplierBp(state.grid, i, data) / 10000).toBeCloseTo(mult, 5);
      expect(isBuildablePrepared(state.grid, i)).toBe(false);
    }

    // Prepared and Irrigated normalize land movement to 1.0x; Prepared, Irrigated and Living are buildable (`isPreparedGround`)
    const t = 0;
    setTileTerrain(state.grid, t, TERRAIN.flat);
    setTilePrep(state.grid, t, PREP.prepared);
    expect(isGroundPassable(state.grid, t, data)).toBe(true);
    expect(groundMoveMultiplierBp(state.grid, t, data)).toBe(10000);
    expect(isBuildablePrepared(state.grid, t)).toBe(true);

    setTilePrep(state.grid, t, PREP.irrigated);
    expect(groundMoveMultiplierBp(state.grid, t, data)).toBe(10000);
    expect(isBuildablePrepared(state.grid, t)).toBe(true);

    // Living gives +10% movement speed (1.1x = 11000 bp) and is buildable (UO-TF-07, UO-TF-04)
    setTilePrep(state.grid, t, PREP.living);
    expect(isGroundPassable(state.grid, t, data)).toBe(true);
    expect(groundMoveMultiplierBp(state.grid, t, data)).toBe(11000);
    expect(isBuildablePrepared(state.grid, t)).toBe(true);

    // Ridge and Moat are impassable walls to ground units; only Ridge blocks direct fire (UO-W-01/02)
    setTilePrep(state.grid, t, PREP.ridge);
    expect(isGroundPassable(state.grid, t, data)).toBe(false);
    expect(groundMoveMultiplierBp(state.grid, t, data)).toBe(0);
    expect(blocksDirectFire(state.grid, t)).toBe(true);
    expect(isBuildablePrepared(state.grid, t)).toBe(false);

    setTilePrep(state.grid, t, PREP.moat);
    expect(isGroundPassable(state.grid, t, data)).toBe(false);
    expect(groundMoveMultiplierBp(state.grid, t, data)).toBe(0);
    expect(blocksDirectFire(state.grid, t)).toBe(false);
    expect(isBuildablePrepared(state.grid, t)).toBe(false);
  });
});

describe('W01-08 acceptance: tile prep, owner, deposit and explored delta sync', () => {
  it('changing a tile prep produces one t op in the next delta and updates the replica', () => {
    const authority = new SimHost({ flags: ['W00', 'W01'] });
    authority.load(createPlanet({ type: 'flat', seed: 'w01-08-delta', radius: 4 }));
    const replica = authority.clone();

    const idx = hexIndex(4).indexOf(1, -1);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(authority.state.grid.layers.prep[idx]).toBe(PREP.wild);

    // Change a single tile's prep and advance 1 tick
    setTilePrep(authority.state.grid, idx, PREP.prepared);
    authority.step(1);

    const deltaBytes = authority.diffSince(0);
    const decoded = decodeDiff(deltaBytes);
    expect(Array.from(decoded.tiles.idx)).toEqual([idx]);
    expect(decoded.tiles.cols.prep[0]).toBe(PREP.prepared);

    const tileOps = extractTileChanges(deltaBytes);
    expect(tileOps).toHaveLength(1);
    expect(tileOps[0]).toMatchObject({
      op: 't',
      tileIdx: idx,
      terrain: TERRAIN.flat,
      prep: PREP.prepared,
    });

    replica.applyDiff(deltaBytes);
    expect(replica.state.grid.layers.prep[idx]).toBe(PREP.prepared);
    expect(replica.state.grid.prep?.[idx]).toBe(PREP.prepared);
    expect(isBuildablePrepared(replica.state.grid, idx)).toBe(true);
    expect(replica.state).toEqual(authority.state);
  });

  it('propagates owner, deposit, richness, height and explored bitmask changes through diffSince + applyDiff', () => {
    const authority = new SimHost({ flags: ['W00', 'W01'] });
    authority.load(createPlanet({ type: 'flat', seed: 'w01-08-layers', radius: 3 }));
    authority.step(2);
    const replica = authority.clone();
    const baseTick = authority.tick;

    const tileA = 2;
    const tileB = 5;
    expect(authority.state.grid.layers.owner[tileA]).toBe(-1);
    expect(isTileExplored(authority.state.grid, tileB, 0)).toBe(false);
    expect(isTileExplored(authority.state.grid, tileB, 2)).toBe(false);

    setTileOwner(authority.state.grid, tileA, 1);
    setTileDeposit(authority.state.grid, tileA, DEPOSIT.minerals, 1.15);
    setTileHeight(authority.state.grid, tileA, 0.25);

    markTileExplored(authority.state.grid, tileB, 0);
    markTileExplored(authority.state.grid, tileB, 2);

    authority.step(1);
    const deltaBytes = authority.diffSince(baseTick);
    const ops = extractTileChanges(deltaBytes);
    expect(ops.map((o) => o.tileIdx)).toEqual([tileA, tileB]);

    replica.applyDiff(deltaBytes);
    expect(replica.state.grid.layers.owner[tileA]).toBe(1);
    expect(replica.state.grid.layers.deposit[tileA]).toBe(DEPOSIT.minerals);
    expect(replica.state.grid.layers.richness[tileA]).toBeCloseTo(1.15, 5);
    expect(replica.state.grid.layers.height[tileA]).toBeCloseTo(0.25, 5);
    expect(isTileExplored(replica.state.grid, tileB, 0)).toBe(true);
    expect(isTileExplored(replica.state.grid, tileB, 1)).toBe(false);
    expect(isTileExplored(replica.state.grid, tileB, 2)).toBe(true);
    expect(replica.state).toEqual(authority.state);
  });
});
