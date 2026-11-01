import { DEPOSIT, PREP, TERRAIN } from './layers';

/**
 * Geo rules: what a tile's terrain / prep / deposit codes mean for movement and construction. Every system (movement,
 * placement, starter-site guarantee) and the client ghost read these, so "obstacle" or "buildable" means the same thing
 * on the server, in the browser-local host and in the UI.
 */

/** Why a tile cannot take a building (UI text in `GEO_BLOCK_TEXT`, reject code via `placementRejectCode`). */
export type GeoBlock = 'water' | 'trees' | 'rock' | 'slope' | 'hole' | 'ridge' | 'deposit' | 'noDeposit';

/** Untouched trees and rock: ground units cannot enter until a Clear / Break turns the tile Flat. */
export function isGroundObstacle(terrain: number): boolean {
  return terrain === TERRAIN.forest || terrain === TERRAIN.rock;
}

/**
 * Ground movement: untouched trees and rock (until Clear / Break) and resource deposits (their ore, crystal and oil
 * nodes stand on the tile) cannot be entered. Deep water, ridges and moats are impassable by terrain (`isGroundPassable`).
 */
export function isGroundMoveBlocked(terrain: number, deposit: number): boolean {
  return isGroundObstacle(terrain) || deposit !== DEPOSIT.none;
}

/** Max height difference (m) inside one building footprint: Grade prepares a tile, it does not move dunes (Level is W05). */
export const MAX_FOOTPRINT_SPREAD_M = 0.6;

/** Ground is ready for a foundation (Prepared or Living). */
export function isPreparedGround(prep: number): boolean {
  return prep === PREP.prepared || prep === PREP.living;
}

/** How a building treats resource deposits on its footprint. */
export type DepositRule = 'forbid' | 'require' | 'any';

/**
 * Terrain check for one footprint tile: `null` when a building may stand here (after at most a Grade), otherwise the
 * blocking cause. Trees and rock must be terraformed away by the player first; water, slopes and holes need later ops.
 */
export function geoBuildBlock(terrain: number, prep: number, deposit: number, depositRule: DepositRule): GeoBlock | null {
  if (prep === PREP.ridge || prep === PREP.moat) return 'ridge';
  if (terrain === TERRAIN.deep || terrain === TERRAIN.shallow) return 'water';
  if (terrain === TERRAIN.forest) return 'trees';
  if (terrain === TERRAIN.rock) return 'rock';
  if (terrain === TERRAIN.slope) return 'slope';
  if (terrain === TERRAIN.hole) return 'hole';
  if (terrain !== TERRAIN.flat) return 'slope';
  const hasDeposit = deposit !== DEPOSIT.none;
  if (depositRule === 'forbid' && hasDeposit) return 'deposit';
  if (depositRule === 'require' && !hasDeposit) return 'noDeposit';
  return null;
}

export const GEO_BLOCK_TEXT: Readonly<Record<GeoBlock, string>> = {
  water: 'water',
  trees: 'trees: clear them first',
  rock: 'rock: break it first',
  slope: 'slope',
  hole: 'hole',
  ridge: 'ridge / moat',
  deposit: 'resource deposit',
  noDeposit: 'needs a resource deposit',
};
