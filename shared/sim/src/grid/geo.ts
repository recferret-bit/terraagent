import { isTileUneven, levelledFlatHeight } from './hex';
import { DEPOSIT, PREP, TERRAIN } from './layers';

export { isTileUneven, levelledFlatHeight };

/**
 * Geo rules: what a tile's terrain / prep / deposit codes mean for movement and construction. Every system (movement,
 * placement, starter-site guarantee) and the client ghost read these, so "obstacle" or "buildable" means the same thing
 * on the server, in the browser-local host and in the UI.
 */

/** Why a tile cannot take a building (UI text in `GEO_BLOCK_TEXT`, reject code via `placementRejectCode`). */
export type GeoBlock = 'water' | 'trees' | 'rock' | 'slope' | 'hole' | 'ridge' | 'deposit' | 'noDeposit';

/** Non-Flat ground (mountains/rock, dunes/slopes, trees/forest, sinkholes, water): ground units cannot enter until terraformed Flat. */
export function isGroundObstacle(terrain: number): boolean {
  return terrain !== TERRAIN.flat;
}

/**
 * Ground movement: only terraformed Flat ground free of resource deposits (ore, crystal and oil nodes stand on the tile)
 * can be entered by ground units. Deep water, ridges and moats are also impassable by terrain (`isGroundPassable`).
 */
export function isGroundMoveBlocked(terrain: number, deposit: number): boolean {
  return isGroundObstacle(terrain) || deposit !== DEPOSIT.none;
}

/** Max height difference (m) inside one building footprint: Grade prepares a tile, it does not move dunes (Level is W05). */
export const MAX_FOOTPRINT_SPREAD_M = 0.6;

/** Ground is ready for a foundation (Prepared, Irrigated, or Living; placing a building reverts Irrigated/Living to Prepared). */
export function isPreparedGround(prep: number): boolean {
  return prep === PREP.prepared || prep === PREP.irrigated || prep === PREP.living;
}

/** How a building treats resource deposits on its footprint. */
export type DepositRule = 'forbid' | 'require' | 'any';

export interface GeoBuildOptions {
  /** W05-09 (re-opening D-37): when true, trees, rock, slopes, holes and shallow water are linked-prep-able rather than blocking. */
  linkedPrep?: boolean;
  /** Whether the colony has a T2+ worker that can execute `deepReclaim` during linked prep. */
  canDeepReclaim?: boolean;
}

/**
 * Terrain check for one footprint tile: `null` when a building may stand here (after linked prep), otherwise the
 * blocking cause. In W01..W04 (`!opts?.linkedPrep`), trees, rock, water, slopes and holes block until terraformed
 * first; in W05 (`opts?.linkedPrep`), they are converted to Flat + Prepared by the building's linked prep order.
 */
export function geoBuildBlock(
  terrain: number,
  prep: number,
  deposit: number,
  depositRule: DepositRule,
  opts?: GeoBuildOptions,
): GeoBlock | null {
  if (prep === PREP.ridge || prep === PREP.moat) return 'ridge';
  if (!opts?.linkedPrep) {
    if (terrain === TERRAIN.deep || terrain === TERRAIN.shallow) return 'water';
    if (terrain === TERRAIN.forest) return 'trees';
    if (terrain === TERRAIN.rock) return 'rock';
    if (terrain === TERRAIN.slope) return 'slope';
    if (terrain === TERRAIN.hole) return 'hole';
    if (terrain !== TERRAIN.flat) return 'slope';
  } else {
    if (terrain === TERRAIN.deep && !opts.canDeepReclaim) return 'water';
    if (
      terrain !== TERRAIN.flat &&
      terrain !== TERRAIN.forest &&
      terrain !== TERRAIN.rock &&
      terrain !== TERRAIN.slope &&
      terrain !== TERRAIN.hole &&
      terrain !== TERRAIN.shallow &&
      terrain !== TERRAIN.deep
    ) {
      return 'slope';
    }
  }
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
