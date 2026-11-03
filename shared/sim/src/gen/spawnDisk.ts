import { axialToPlane, hexDistance, type HexIndex } from '../grid/hex';
import { DEPOSIT } from '../grid/layers';
import type { SimState } from '../kernel/state';
import { spawnConfig, type SpawnConfig } from './profile';
import type { SpawnSlot } from './spawnSlots';

/** Disk and footprint helpers shared by spawn slot generation (`spawnSlots.ts`) and its guarantee check (`spawnGuarantee.ts`). */

export const spawnCfg = (state: SimState): SpawnConfig => spawnConfig(state.meta.planetType);

export const ALL_DEPOSITS = [DEPOSIT.metals, DEPOSIT.minerals, DEPOSIT.oil] as const;

/** Euclidean blast radius (in planar tile units, 2m/tile -> 7.0m radius) cleared around a pod landing tile `(cq, cr)`. */
export const POD_BLAST_RADIUS_TILES = 3.5;

/** Planar tile-unit offset `(-POD_EGRESS_DIR * POD_LAND_OFFSET_M / TILE_M)` of the pod impact crater behind `(cq, cr)`. */
export const POD_IMPACT_OFFSET_PLANE = [-0.78, -1.04] as const;

/** Euclidean blast radius (in planar tile units, 6.0m radius) cleared around the offset pod impact crater center. */
export const POD_IMPACT_RADIUS_TILES = 3.0;

/**
 * Whether tile `(q, r)` lies inside the circular pod-drop explosion/touchdown blast zone around landing tile `(cq, cr)`.
 * Uses `Math.sqrt` (correctly rounded across all engines) over planar coordinates so the cleared zone is a true circle
 * covering both the HQ rollout pad `(cq, cr)` and the offset impact crater.
 */
export function isInPodBlastCircle(cq: number, cr: number, q: number, r: number): boolean {
  if (hexDistance(cq, cr, q, r) > 4) return false;
  const [cx, cy] = axialToPlane(cq, cr);
  const [tx, ty] = axialToPlane(q, r);
  const dx = tx - cx;
  const dy = ty - cy;
  if (Math.sqrt(dx * dx + dy * dy) <= POD_BLAST_RADIUS_TILES) return true;
  const px = dx - POD_IMPACT_OFFSET_PLANE[0];
  const py = dy - POD_IMPACT_OFFSET_PLANE[1];
  return Math.sqrt(px * px + py * py) <= POD_IMPACT_RADIUS_TILES;
}

/** Tile indices inside the circular pod-drop blast zone around `(cq, cr)`, ascending. */
export function collectPodBlastTiles(hex: HexIndex, cq: number, cr: number): number[] {
  const out: number[] = [];
  for (let dr = -4; dr <= 4; dr++) {
    for (let dq = -4; dq <= 4; dq++) {
      const q = cq + dq;
      const r = cr + dr;
      if (!isInPodBlastCircle(cq, cr, q, r)) continue;
      const idx = hex.indexOf(q, r);
      if (idx >= 0) out.push(idx);
    }
  }
  out.sort((a, b) => a - b);
  return out;
}

/** Tile indices at hex distance `minDist..maxDist` of `(cq, cr)`, ascending. */
export function collectDiskTiles(hex: HexIndex, cq: number, cr: number, maxDist: number, minDist = 0): number[] {
  const out: number[] = [];
  for (let dr = -maxDist; dr <= maxDist; dr++) {
    for (let dq = -maxDist; dq <= maxDist; dq++) {
      const d = hexDistance(0, 0, dq, dr);
      if (d < minDist || d > maxDist) continue;
      const idx = hex.indexOf(cq + dq, cr + dr);
      if (idx >= 0) out.push(idx);
    }
  }
  out.sort((a, b) => a - b);
  return out;
}

/** The 2x2 footprint tiles at `(mq, mr)` when all lie within `1..metalsRadius` of the slot, else null. */
export function footprint2x2Valid(hex: HexIndex, slot: SpawnSlot, mq: number, mr: number, metalsRadius: number): number[] | null {
  const tiles: number[] = [];
  for (let dr = 0; dr <= 1; dr++) {
    for (let dq = 0; dq <= 1; dq++) {
      const fq = mq + dq;
      const fr = mr + dr;
      const fIdx = hex.indexOf(fq, fr);
      const dist = hexDistance(slot.q, slot.r, fq, fr);
      if (fIdx < 0 || dist < 1 || dist > metalsRadius) return null;
      tiles.push(fIdx);
    }
  }
  return tiles;
}
