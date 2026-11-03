import { PREP_CODES, TERRAIN_CODES } from '@terra/contracts/tiles/codes';
import type { ClientTiles } from '../store/replica/viewCodec';
import type { TileColorResolver } from './rasterCache';

export type TileColorStateKey =
  | 'unexplored'
  | 'flat'
  | 'forest'
  | 'rock'
  | 'slope'
  | 'hole'
  | 'shallow'
  | 'deep'
  | 'prepared'
  | 'living'
  | 'ridgeMoat';

export interface TileLegendEntry {
  readonly key: TileColorStateKey;
  readonly label: string;
  readonly cssVar: string;
  readonly fallbackHex: string;
  readonly color: string;
}

export interface TileColorDefinition {
  readonly key: TileColorStateKey;
  readonly label: string;
  readonly cssVar: string;
  readonly fallbackHex: string;
}

export const TILE_COLOR_DEFINITIONS: readonly TileColorDefinition[] = [
  { key: 'unexplored', label: 'Unexplored', cssVar: '--ta-void', fallbackHex: '#0B0E13' },
  { key: 'flat', label: 'Flat', cssVar: '--ta-plate-hi', fallbackHex: '#252E3C' },
  { key: 'forest', label: 'Forest', cssVar: '--ta-biome-temperate', fallbackHex: '#2D6B4A' },
  { key: 'rock', label: 'Rock', cssVar: '--ta-text-lo', fallbackHex: '#596579' },
  { key: 'slope', label: 'Slope', cssVar: '--ta-edge-hi', fallbackHex: '#3A4659' },
  { key: 'hole', label: 'Hole', cssVar: '--ta-inset', fallbackHex: '#0F131A' },
  { key: 'shallow', label: 'Shallow Water', cssVar: '--ta-blue-hi', fallbackHex: '#52B4FF' },
  { key: 'deep', label: 'Deep Water', cssVar: '--ta-blue-lo', fallbackHex: '#0E2438' },
  { key: 'prepared', label: 'Prepared', cssVar: '--ta-text-mid', fallbackHex: '#8E9BAE' },
  { key: 'living', label: 'Living', cssVar: '--ta-ok', fallbackHex: '#39C878' },
  { key: 'ridgeMoat', label: 'Ridge / Moat', cssVar: '--ta-plate', fallbackHex: '#151A22' },
] as const;

export function readTokenColor(cssVar: string, fallbackHex: string): string {
  if (
    typeof document !== 'undefined' &&
    typeof window !== 'undefined' &&
    document.documentElement &&
    typeof window.getComputedStyle === 'function'
  ) {
    try {
      const val = window.getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
      if (val) {
        return val;
      }
    } catch {
      // Fallback if DOM access fails
    }
  }
  return fallbackHex;
}

export function getTileColorTable(): Record<TileColorStateKey, string> {
  const table = {} as Record<TileColorStateKey, string>;
  for (const def of TILE_COLOR_DEFINITIONS) {
    table[def.key] = readTokenColor(def.cssVar, def.fallbackHex);
  }
  return table;
}

export function getTileLegendEntries(): TileLegendEntry[] {
  const colorTable = getTileColorTable();
  return TILE_COLOR_DEFINITIONS.map((def) => ({
    key: def.key,
    label: def.label,
    cssVar: def.cssVar,
    fallbackHex: def.fallbackHex,
    color: colorTable[def.key],
  }));
}

export function classifyTileState(
  tiles: ClientTiles,
  index: number,
): TileColorStateKey {
  if (tiles.explored && tiles.explored[index] === 0) {
    return 'unexplored';
  }
  const prep = tiles.prep ? (tiles.prep[index] ?? PREP_CODES.wild) : PREP_CODES.wild;
  if (prep === PREP_CODES.living || prep === PREP_CODES.irrigated) {
    return 'living';
  }
  if (prep === PREP_CODES.prepared) {
    return 'prepared';
  }
  if (prep === PREP_CODES.ridge || prep === PREP_CODES.moat) {
    return 'ridgeMoat';
  }
  const terrain = tiles.terrain ? (tiles.terrain[index] ?? TERRAIN_CODES.flat) : TERRAIN_CODES.flat;
  switch (terrain) {
    case TERRAIN_CODES.shallow:
      return 'shallow';
    case TERRAIN_CODES.deep:
      return 'deep';
    case TERRAIN_CODES.forest:
      return 'forest';
    case TERRAIN_CODES.rock:
      return 'rock';
    case TERRAIN_CODES.slope:
      return 'slope';
    case TERRAIN_CODES.hole:
      return 'hole';
    case TERRAIN_CODES.flat:
    default:
      return 'flat';
  }
}

export const resolveTileColorFromTokens: TileColorResolver = (
  tiles: ClientTiles,
  index: number,
): string => {
  return getTileColorTable()[classifyTileState(tiles, index)];
};
