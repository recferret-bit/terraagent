import { DEPOSIT, PREP, TERRAIN, geoBuildBlock, hexDistance } from '@terra/sim';
import type { ClientTiles } from '../../store/replica/viewCodec';
import type { GhostContext } from './ghostContext';

export function depositCodeForRequired(requiresDeposit?: string): number | undefined {
  if (requiresDeposit === 'metals') return DEPOSIT.metals;
  if (requiresDeposit === 'minerals') return DEPOSIT.minerals;
  if (requiresDeposit === 'oil') return DEPOSIT.oil;
  return undefined;
}

export function matchesDeposit(deposit: number | undefined, reqCode: number | undefined): boolean {
  return reqCode !== undefined && (deposit === reqCode || (reqCode === DEPOSIT.metals && deposit === DEPOSIT.minerals));
}

const DEPOSIT_OFFSETS: ReadonlyArray<readonly [number, number]> = [[-1, 0], [0, -1], [-1, -1]];

const LARGE_FOOTPRINT_OFFSETS: ReadonlyArray<readonly [number, number]> = (() => {
  const list: Array<readonly [number, number]> = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dq = -1; dq <= 1; dq++) {
      if (dq !== 0 || dr !== 0) list.push([dq, dr]);
    }
  }
  return list.sort((a, b) => {
    const hd = hexDistance(0, 0, a[0], a[1]) - hexDistance(0, 0, b[0], b[1]);
    if (hd !== 0) return hd;
    return Math.abs(a[0]) + Math.abs(a[1]) - (Math.abs(b[0]) + Math.abs(b[1]));
  });
})();

export interface HoverAnchorInput {
  readonly q: number;
  readonly r: number;
  readonly valid: boolean;
  readonly footprintW: number;
  readonly footprintD: number;
  readonly requiresDeposit?: string;
  readonly tilesData?: ClientTiles;
  readonly ctx: GhostContext;
  readonly isValidAt: (aq: number, ar: number) => boolean;
}

/**
 * Nudges a hovered tile anchor by 1 hex so first clicks still place cleanly:
 * - Deposit extractors hovered on a deposit tile slide 1 hex so the 2x2 footprint covers it.
 * - 3x3+ buildings (Command Hub, Robotics Factory) hovered on an otherwise valid center tile slide 1 hex away
 *   from an edge/deposit hitting one corner of the 3x3 footprint while keeping `(q, r)` inside the footprint.
 */
export function nudgeHoverAnchor(input: HoverAnchorInput): { q: number; r: number } | null {
  if (input.valid || !input.tilesData) return null;
  const hoverIdx = input.ctx.hIndex.indexOf(input.q, input.r);
  if (hoverIdx < 0) return null;

  const reqCode = depositCodeForRequired(input.requiresDeposit);
  if (reqCode !== undefined) {
    if (input.tilesData.deposit && matchesDeposit(input.tilesData.deposit[hoverIdx], reqCode)) {
      for (const [dq, dr] of DEPOSIT_OFFSETS) {
        const aq = input.q + dq, ar = input.r + dr;
        if (input.isValidAt(aq, ar)) return { q: aq, r: ar };
      }
    }
    return null;
  }

  if (input.footprintW < 3 || input.footprintD < 3) return null;
  if (input.ctx.occupied.has(hoverIdx)) return null;
  if (input.tilesData.deposit && (input.tilesData.deposit[hoverIdx] ?? DEPOSIT.none) !== DEPOSIT.none) return null;
  const terrain = input.tilesData.terrain ? (input.tilesData.terrain[hoverIdx] ?? TERRAIN.flat) : TERRAIN.flat;
  const prep = input.tilesData.prep ? (input.tilesData.prep[hoverIdx] ?? PREP.wild) : PREP.wild;
  // Slope, rock, water, trees and holes are not a foundation. Do not slide a footprint onto them.
  if (geoBuildBlock(terrain, prep, DEPOSIT.none, 'any', { linkedPrep: false })) return null;

  for (const [dq, dr] of LARGE_FOOTPRINT_OFFSETS) {
    const aq = input.q + dq, ar = input.r + dr;
    if (input.isValidAt(aq, ar)) return { q: aq, r: ar };
  }
  return null;
}
