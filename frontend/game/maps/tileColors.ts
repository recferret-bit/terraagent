import { PREP_CODES, TERRAIN_CODES } from '@terra/contracts/tiles/codes';
import { isColonyTileExplored } from '@terra/sim';
import type { ClientTiles } from '../store/replica/viewCodec';

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

/**
 * Map-only palette (`--ta-map-*`, defined in `minimap.css`; the hex is the fallback). Deliberately bright and
 * mutually distinct: no near-black state, so every legend swatch stays readable on the blurred overlay.
 */
export const TILE_COLOR_DEFINITIONS: readonly TileColorDefinition[] = [
  { key: 'unexplored', label: 'Unexplored', cssVar: '--ta-map-unexplored', fallbackHex: '#3B4C6B' },
  { key: 'flat', label: 'Flat', cssVar: '--ta-map-flat', fallbackHex: '#B4CC72' },
  { key: 'forest', label: 'Forest', cssVar: '--ta-map-forest', fallbackHex: '#2FA35C' },
  { key: 'rock', label: 'Rock', cssVar: '--ta-map-rock', fallbackHex: '#A99F94' },
  { key: 'slope', label: 'Slope', cssVar: '--ta-map-slope', fallbackHex: '#D9A05B' },
  { key: 'hole', label: 'Hole', cssVar: '--ta-map-hole', fallbackHex: '#9A5E3E' },
  { key: 'shallow', label: 'Shallow Water', cssVar: '--ta-map-shallow', fallbackHex: '#66D3F5' },
  { key: 'deep', label: 'Deep Water', cssVar: '--ta-map-deep', fallbackHex: '#3A78E0' },
  { key: 'prepared', label: 'Prepared', cssVar: '--ta-map-prepared', fallbackHex: '#F3E3A6' },
  { key: 'living', label: 'Living', cssVar: '--ta-map-living', fallbackHex: '#3DEB8A' },
  { key: 'ridgeMoat', label: 'Ridge / Moat', cssVar: '--ta-map-ridge', fallbackHex: '#A583EE' },
] as const;

export type ResourceKey = 'metals' | 'minerals' | 'oil';

export interface ResourceLegendEntry {
  readonly key: ResourceKey;
  readonly label: string;
  readonly color: string;
}

/** Deposit marker colours (`DEPOSIT_CODES`: 1 metals, 2 minerals, 3 oil), drawn by the `resources` layer. */
export const RESOURCE_LEGEND: readonly ResourceLegendEntry[] = [
  { key: 'metals', label: 'Metals', color: '#FFD43B' },
  { key: 'minerals', label: 'Minerals', color: '#FF7AC8' },
  { key: 'oil', label: 'Oil', color: '#F2552C' },
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
  colonyIndex = 0,
): TileColorStateKey {
  if ((tiles.explored || tiles.exploredByColony) && !isColonyTileExplored(tiles, index, colonyIndex)) {
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

export const resolveTileColorFromTokens = (
  tiles: ClientTiles,
  index: number,
  colonyIndex = 0,
): string => {
  return getTileColorTable()[classifyTileState(tiles, index, colonyIndex)];
};
