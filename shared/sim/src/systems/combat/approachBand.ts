/** Fauna strike the edge of a building footprint, rather than its occupied centre tile. */
export function footprintAttackRange(range: number, footprintWidth = 1): number {
  return range + Math.floor(Math.max(1, footprintWidth || 1) / 2);
}

/**
 * Shared integer path band for a continuous weapon range. Use the outermost reachable tile in range.
 * A moving target can drift outside its rounded tile's range: approach one tile further in that case.
 * For a stationary target, retain the outer band so an attacker between tiles can finish its route
 * to the footprint edge rather than replanning into the occupied building.
 */
export function combatApproachBand(maxRange: number, minRange = 0, tileDistance = Infinity, targetOffset = 0): { minDist: number; maxDist: number } {
  const minDist = Math.ceil(Math.max(0, minRange));
  const outer = Math.floor(Math.max(0, maxRange));
  return { minDist, maxDist: Math.max(minDist, outer - (tileDistance <= outer && targetOffset > 1e-5 ? 1 : 0)) };
}
