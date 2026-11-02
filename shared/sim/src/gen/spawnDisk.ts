import { hexDistance, type HexIndex } from '../grid/hex';
import { DEPOSIT } from '../grid/layers';
import type { SimState } from '../kernel/state';
import { spawnConfig, type SpawnConfig } from './profile';
import type { SpawnSlot } from './spawnSlots';

/** Disk and footprint helpers shared by spawn slot generation (`spawnSlots.ts`) and its guarantee check (`spawnGuarantee.ts`). */

export const spawnCfg = (state: SimState): SpawnConfig => spawnConfig(state.meta.planetType);

export const ALL_DEPOSITS = [DEPOSIT.metals, DEPOSIT.minerals, DEPOSIT.oil] as const;

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
