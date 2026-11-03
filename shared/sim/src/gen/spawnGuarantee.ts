import { hexDistance, hexIndex, type HexIndex } from '../grid/hex';
import { DEPOSIT, PREP, TERRAIN } from '../grid/layers';
import type { SimState } from '../kernel/state';
import { ALL_DEPOSITS, collectDiskTiles, collectPodBlastTiles, footprint2x2Valid, spawnCfg } from './spawnDisk';

/** The `UO-TF-09` spawn guarantee check of a generated planet (split from `spawnSlots.ts`). */

export interface SpawnGuaranteeResult {
  ok: boolean;
  reasons: string[];
}

function checkR4Guarantee(state: SimState, hex: HexIndex, slot: { q: number; r: number }, reasons: string[]): void {
  const cfg = spawnCfg(state);
  const terrain = state.grid.layers.terrain as Uint8Array;
  const prep = state.grid.layers.prep as Uint8Array;
  const deposit = state.grid.layers.deposit as Uint8Array;
  const r4Tiles = collectDiskTiles(hex, slot.q, slot.r, cfg.guaranteeRadius);
  let flatCount = 0;

  for (const idx of collectPodBlastTiles(hex, slot.q, slot.r)) {
    if (terrain[idx] !== TERRAIN.flat || prep[idx] !== PREP.flat) {
      reasons.push(`pod blast circle tile ${idx} is not terraformed flat (terrain=${terrain[idx]}, prep=${prep[idx]})`);
      break;
    }
    if (deposit[idx] !== DEPOSIT.none) {
      reasons.push(`pod blast circle tile ${idx} contains deposit ${deposit[idx]}`);
      break;
    }
  }

  for (const idx of r4Tiles) {
    const t = terrain[idx];
    if (t === TERRAIN.flat) {
      flatCount++;
      if (prep[idx] !== PREP.flat) reasons.push(`tile ${idx} in r<=4 is flat terrain but prep=${prep[idx]}`);
    } else if (t !== TERRAIN.forest && t !== TERRAIN.rock) {
      reasons.push(`forbidden terrain ${t} at tile ${idx} within r<=4`);
    }
  }

  const minFlat = Math.ceil((r4Tiles.length * cfg.minFlatShareBp) / 10000);
  if (flatCount < minFlat) {
    reasons.push(`r<=4 flat count ${flatCount}/${r4Tiles.length} below required ${minFlat}`);
  }

  for (const cIdx of r4Tiles) {
    const cq = hex.q[cIdx];
    const cr = hex.r[cIdx];
    let nonFlat = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dq = -1; dq <= 1; dq++) {
        const wIdx = hex.indexOf(cq + dq, cr + dr);
        if (wIdx >= 0 && terrain[wIdx] !== TERRAIN.flat) nonFlat++;
      }
    }
    if (nonFlat > cfg.maxNonFlatPer3x3) {
      reasons.push(`3x3 at (${cq},${cr}) has ${nonFlat} non-Flat tiles (> ${cfg.maxNonFlatPer3x3})`);
      break;
    }
  }
}

function checkDepositsGuarantee(state: SimState, hex: HexIndex, slot: { q: number; r: number }, reasons: string[]): void {
  const cfg = spawnCfg(state);
  const terrain = state.grid.layers.terrain as Uint8Array;
  const prep = state.grid.layers.prep as Uint8Array;
  const deposit = state.grid.layers.deposit as Uint8Array;
  const richness = state.grid.layers.richness as Float32Array;
  const r8Tiles = collectDiskTiles(hex, slot.q, slot.r, cfg.metalsRadius, 1);

  let hasMetalsWith2x2 = false;
  for (const mIdx of r8Tiles) {
    if (deposit[mIdx] !== DEPOSIT.metals) continue;
    const fp = footprint2x2Valid(hex, { index: 0, q: slot.q, r: slot.r }, hex.q[mIdx], hex.r[mIdx], cfg.metalsRadius);
    if (fp && fp.every((fIdx) => terrain[fIdx] === TERRAIN.flat && prep[fIdx] === PREP.flat)) {
      hasMetalsWith2x2 = true;
      break;
    }
  }
  if (!hasMetalsWith2x2) {
    reasons.push('missing metals deposit with free 2x2 flat footprint within r<=8');
  }

  const r12Tiles = collectDiskTiles(hex, slot.q, slot.r, cfg.allDepositsRadius, 1);
  for (const kind of ALL_DEPOSITS) {
    const hit = r12Tiles.some((idx) => deposit[idx] === kind && richness[idx] > 0);
    if (!hit) {
      reasons.push(`missing deposit kind ${kind} within r<=12`);
    }
  }
}

/**
 * Validates all `UO-TF-09` spawn guarantee predicates for a given `slot` on `state`.
 */
export function validateSpawnSlotGuarantee(
  state: SimState,
  slot: { q: number; r: number },
): SpawnGuaranteeResult {
  const cfg = spawnCfg(state);
  const reasons: string[] = [];
  const hex = hexIndex(state.grid.radius);
  const slotIdx = hex.indexOf(slot.q, slot.r);

  if (slotIdx < 0) {
    return { ok: false, reasons: [`slot (${slot.q},${slot.r}) is outside grid`] };
  }

  if (state.grid.radius >= 40) {
    const ringDist = hexDistance(0, 0, slot.q, slot.r);
    const minDist = cfg.ringRadius - cfg.ringJitter;
    const maxDist = cfg.ringRadius + cfg.ringJitter;
    if (ringDist < minDist || ringDist > maxDist) {
      reasons.push(`slot ring distance ${ringDist} outside [${minDist}, ${maxDist}]`);
    }
  }

  const terrain = state.grid.layers.terrain as Uint8Array;
  const prep = state.grid.layers.prep as Uint8Array;
  if (terrain[slotIdx] !== TERRAIN.flat || prep[slotIdx] !== PREP.flat) {
    reasons.push(`slot center (${slot.q},${slot.r}) is not flat`);
  }

  checkR4Guarantee(state, hex, slot, reasons);
  checkDepositsGuarantee(state, hex, slot, reasons);

  return { ok: reasons.length === 0, reasons };
}
