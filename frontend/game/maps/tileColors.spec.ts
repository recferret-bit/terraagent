// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PREP_CODES, TERRAIN_CODES } from '@terra/contracts/tiles/codes';
import type { ClientTiles } from '../store/replica/viewCodec';
import {
  classifyTileState,
  getTileColorTable,
  getTileLegendEntries,
  readTokenColor,
  resolveTileColorFromTokens,
  TILE_COLOR_DEFINITIONS,
  type TileColorStateKey,
} from './tileColors';

function createTestTiles(count: number = 16): ClientTiles {
  return {
    count,
    terrain: new Uint8Array(count).fill(TERRAIN_CODES.flat),
    prep: new Uint8Array(count).fill(PREP_CODES.wild),
    height: new Float32Array(count),
    owner: new Int8Array(count).fill(-1),
    explored: new Uint8Array(count).fill(1),
  };
}

describe('W04-04 Tile colour definitions & tokens', () => {
  it('defines 11 expected tile states with fallback colours', () => {
    const expectedKeys: TileColorStateKey[] = [
      'unexplored',
      'flat',
      'forest',
      'rock',
      'slope',
      'hole',
      'shallow',
      'deep',
      'prepared',
      'living',
      'ridgeMoat',
    ];
    const defKeys = TILE_COLOR_DEFINITIONS.map((d) => d.key);
    expect(defKeys).toEqual(expectedKeys);
  });

  it('falls back to fallbackHex when CSS variable is not set', () => {
    const val = readTokenColor('--ta-non-existent-var', '#123456');
    expect(val).toBe('#123456');
  });
});

describe('W04-04 Tile classification logic', () => {
  it('correctly classifies unexplored and prep states', () => {
    const tiles = createTestTiles(11);
    tiles.explored![0] = 0;
    expect(classifyTileState(tiles, 0)).toBe('unexplored');

    tiles.prep[1] = PREP_CODES.living;
    expect(classifyTileState(tiles, 1)).toBe('living');

    tiles.prep[2] = PREP_CODES.irrigated;
    expect(classifyTileState(tiles, 2)).toBe('living');

    tiles.prep[3] = PREP_CODES.prepared;
    expect(classifyTileState(tiles, 3)).toBe('prepared');

    tiles.prep[4] = PREP_CODES.ridge;
    expect(classifyTileState(tiles, 4)).toBe('ridgeMoat');

    tiles.prep[5] = PREP_CODES.moat;
    expect(classifyTileState(tiles, 5)).toBe('ridgeMoat');
  });

  it('correctly classifies terrain classes when prep is wild or flat', () => {
    const tiles = createTestTiles(7);
    tiles.terrain[0] = TERRAIN_CODES.shallow;
    expect(classifyTileState(tiles, 0)).toBe('shallow');

    tiles.terrain[1] = TERRAIN_CODES.deep;
    expect(classifyTileState(tiles, 1)).toBe('deep');

    tiles.terrain[2] = TERRAIN_CODES.forest;
    expect(classifyTileState(tiles, 2)).toBe('forest');

    tiles.terrain[3] = TERRAIN_CODES.rock;
    expect(classifyTileState(tiles, 3)).toBe('rock');

    tiles.terrain[4] = TERRAIN_CODES.slope;
    expect(classifyTileState(tiles, 4)).toBe('slope');

    tiles.terrain[5] = TERRAIN_CODES.hole;
    expect(classifyTileState(tiles, 5)).toBe('hole');

    tiles.terrain[6] = TERRAIN_CODES.flat;
    expect(classifyTileState(tiles, 6)).toBe('flat');
  });
});

describe('W04-04 Map colours vs Legend consistency', () => {
  it('matches resolveTileColorFromTokens with getTileLegendEntries for every tile state', () => {
    const legend = getTileLegendEntries();
    const table = getTileColorTable();

    const sampleTiles: Record<TileColorStateKey, (t: ClientTiles, idx: number) => void> = {
      unexplored: (t, idx) => { t.explored![idx] = 0; },
      flat: (t, idx) => { t.terrain[idx] = TERRAIN_CODES.flat; },
      forest: (t, idx) => { t.terrain[idx] = TERRAIN_CODES.forest; },
      rock: (t, idx) => { t.terrain[idx] = TERRAIN_CODES.rock; },
      slope: (t, idx) => { t.terrain[idx] = TERRAIN_CODES.slope; },
      hole: (t, idx) => { t.terrain[idx] = TERRAIN_CODES.hole; },
      shallow: (t, idx) => { t.terrain[idx] = TERRAIN_CODES.shallow; },
      deep: (t, idx) => { t.terrain[idx] = TERRAIN_CODES.deep; },
      prepared: (t, idx) => { t.prep[idx] = PREP_CODES.prepared; },
      living: (t, idx) => { t.prep[idx] = PREP_CODES.living; },
      ridgeMoat: (t, idx) => { t.prep[idx] = PREP_CODES.ridge; },
    };

    const keys = Object.keys(sampleTiles) as TileColorStateKey[];
    const tiles = createTestTiles(keys.length);

    keys.forEach((stateKey, idx) => {
      sampleTiles[stateKey](tiles, idx);
      const classified = classifyTileState(tiles, idx);
      expect(classified).toBe(stateKey);

      const resolvedColor = resolveTileColorFromTokens(tiles, idx);
      const legendEntry = legend.find((e) => e.key === stateKey);
      expect(legendEntry).toBeDefined();
      expect(legendEntry!.color).toBe(resolvedColor);
      expect(table[stateKey]).toBe(resolvedColor);
    });
  });
});

describe('W04-04 Dynamic CSS variable pickup', () => {
  beforeEach(() => {
    document.documentElement.style.removeProperty('--ta-ok');
  });

  afterEach(() => {
    document.documentElement.style.removeProperty('--ta-ok');
  });

  it('updates table and legend when --ta-ok is customized', () => {
    document.documentElement.style.setProperty('--ta-ok', '#40d080');

    const table = getTileColorTable();
    expect(table.living).toBe('#40d080');

    const legend = getTileLegendEntries();
    const livingEntry = legend.find((e) => e.key === 'living');
    expect(livingEntry?.color).toBe('#40d080');

    const tiles = createTestTiles(2);
    tiles.prep[0] = PREP_CODES.living;
    expect(resolveTileColorFromTokens(tiles, 0)).toBe('#40d080');
  });
});
