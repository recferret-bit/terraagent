import {
  formatLandingSlotId,
  formatSectorId,
  parseSectorId,
  W11_DEFAULT_FOUNDING_SEATS_PER_SECTOR,
  W11_DEFAULT_SECTOR_RADIUS,
  type SafeLandingSlotV1,
  type SectorId,
  type SectorKind,
} from '@terra/contracts';
import { isInPodBlastCircle } from '../gen/spawnDisk';
import { hash2d, seedOf } from '../gen/world/noise';
import { HEX_DIRS, hexDistance } from '../grid/hex';
import { DEPOSIT, PREP, TERRAIN } from '../grid/layers';
import { getDepositRichnessBp } from '../gen/temperate';
import {
  W11_DEFAULT_MIN_SLOT_SEPARATION,
  type AtlasSamplerLandingPlan,
  type GeneratedSmallAtlas,
  type LandingSiteValidationIssue,
  type PlanSectorLandingSitesOptions,
  type PlanSectorLandingSitesResult,
} from './types';
import { globalTileToSector, sectorCenterForMacro } from './partition';

const SAFE_DEPOSIT_OFFSETS: readonly (readonly [number, number])[] = [
  [4, 0],
  [0, 4],
  [4, -4],
  [-4, 4],
  [5, 0],
  [0, 5],
  [5, -5],
  [-5, 5],
  [0, -5],
  [-5, 0],
] as const;

export function packAtlasCoord(q: number, r: number): number {
  return ((q + 16384) << 15) ^ (r + 16384);
}

export function maxAchievableSlotsInSector(
  sectorRadius = W11_DEFAULT_SECTOR_RADIUS,
  minSlotSeparation = W11_DEFAULT_MIN_SLOT_SEPARATION,
): number {
  const res = planSectorLandingSites({
    sectorId: 'sec_0_0',
    kind: 'land',
    macroQ: 0,
    macroR: 0,
    sectorRadius,
    foundingCapacity: 64,
    minSlotSeparation,
    hasLandNeighborSec10: false,
  });
  return res.safeLandingSlots.length;
}

function buildSectorCandidateLocalCoords(
  macroQ: number,
  macroR: number,
  sectorRadius: number,
  foundingCapacity: number,
  minSlotSeparation: number,
  seed: string,
): Array<readonly [number, number]> {
  const maxLocal = Math.max(0, sectorRadius - 4);
  const crossSafeLocal = Math.max(0, Math.min(maxLocal, Math.floor((2 * sectorRadius + 1 - minSlotSeparation) / 2)));
  const anchorR =
    sectorRadius >= 20 && minSlotSeparation <= 15
      ? Math.max(minSlotSeparation, Math.min(14, sectorRadius - 10))
      : Math.max(2, Math.min(crossSafeLocal, sectorRadius - 4));

  const ringPt = (dir: number): readonly [number, number] => {
    const [dq, dr] = HEX_DIRS[((dir % 6) + 6) % 6]!;
    return [anchorR * dq + 0, anchorR * dr + 0];
  };

  const candidates: Array<readonly [number, number]> = [];
  const seedNum = seedOf(`${seed}|sec_${macroQ}_${macroR}|landing`);
  const rot = Math.floor(hash2d(macroQ, macroR, seedNum) * 6) % 6;
  if (foundingCapacity <= 3) {
    candidates.push(ringPt(rot), ringPt(rot + 2), ringPt(rot + 4), [0, 0]);
  } else if (foundingCapacity === 4) {
    candidates.push(ringPt(rot), ringPt(rot + 2), ringPt(rot + 4), [0, 0], ringPt(rot + 1));
  } else {
    candidates.push(
      ringPt(rot),
      ringPt(rot + 1),
      ringPt(rot + 3),
      ringPt(rot + 4),
      [0, 0],
      ringPt(rot + 2),
      ringPt(rot + 5),
    );
  }

  if (foundingCapacity > candidates.length) {
    const extras: Array<readonly [number, number]> = [];
    for (let lr = -crossSafeLocal; lr <= crossSafeLocal; lr++) {
      for (let lq = -crossSafeLocal; lq <= crossSafeLocal; lq++) {
        if (hexDistance(0, 0, lq, lr) <= crossSafeLocal) extras.push([lq + 0, lr + 0]);
      }
    }
    extras.sort((a, b) => {
      const da = Math.abs(hexDistance(0, 0, a[0], a[1]) - anchorR);
      const db = Math.abs(hexDistance(0, 0, b[0], b[1]) - anchorR);
      return da - db || a[0] - b[0] || a[1] - b[1];
    });
    candidates.push(...extras);
  }
  return candidates;
}

function handleOceanSectorPlan(sectorId: SectorId, foundingCapacity: number): PlanSectorLandingSitesResult {
  if (foundingCapacity > 0) {
    const issue: LandingSiteValidationIssue = {
      reason: 'ocean_sector',
      sectorId,
      requestedCapacity: foundingCapacity,
      achievedCapacity: 0,
      message: `ocean sector ${sectorId} cannot have founding seats (requested ${foundingCapacity})`,
    };
    return {
      ok: false,
      reason: 'ocean_sector',
      sectorId,
      kind: 'ocean',
      foundingCapacity,
      validatedSafeSites: 0,
      safeLandingSlots: [],
      issues: [issue],
    };
  }
  return {
    ok: true,
    sectorId,
    kind: 'ocean',
    foundingCapacity: 0,
    validatedSafeSites: 0,
    safeLandingSlots: [],
    issues: [],
  };
}

export function planSectorLandingSites(opts: PlanSectorLandingSitesOptions): PlanSectorLandingSitesResult {
  const parsed = parseSectorId(opts.sectorId);
  const macroQ = opts.macroQ ?? parsed?.macroQ ?? 0;
  const macroR = opts.macroR ?? parsed?.macroR ?? 0;
  const sectorId = formatSectorId(macroQ, macroR);
  const kind: SectorKind = opts.kind ?? 'land';
  const sectorRadius = opts.sectorRadius ?? W11_DEFAULT_SECTOR_RADIUS;
  const minSlotSeparation = opts.minSlotSeparation ?? W11_DEFAULT_MIN_SLOT_SEPARATION;
  const foundingCapacity = opts.foundingCapacity;

  if (kind === 'ocean') return handleOceanSectorPlan(sectorId, foundingCapacity);

  const { centerQ, centerR } = sectorCenterForMacro(macroQ, macroR, sectorRadius);
  const candidates = buildSectorCandidateLocalCoords(
    macroQ,
    macroR,
    sectorRadius,
    foundingCapacity,
    minSlotSeparation,
    opts.seed ?? 'w11-default',
  );
  const existing = opts.existingSlots ?? [];
  const placed: SafeLandingSlotV1[] = [];

  for (const [lq, lr] of candidates) {
    if (placed.length >= foundingCapacity) break;
    if (hexDistance(0, 0, lq, lr) > sectorRadius - 4) continue;
    const q = centerQ + lq + 0;
    const r = centerR + lr + 0;
    if (globalTileToSector(q, r, sectorRadius).sectorId !== sectorId) continue;
    if (placed.some((s) => hexDistance(q, r, s.q, s.r) < minSlotSeparation)) continue;
    if (existing.some((s) => hexDistance(q, r, s.q, s.r) < minSlotSeparation)) continue;
    placed.push({
      slotId: formatLandingSlotId(sectorId, placed.length),
      sectorId,
      slotIndex: placed.length,
      q,
      r,
    });
  }

  if (placed.length < foundingCapacity) {
    const issue: LandingSiteValidationIssue = {
      reason: 'capacity_unachievable',
      sectorId,
      requestedCapacity: foundingCapacity,
      achievedCapacity: placed.length,
      minRequiredDistance: minSlotSeparation,
      message: `sector ${sectorId} requested foundingCapacity=${foundingCapacity} at separation>=${minSlotSeparation}, but only ${placed.length} valid sites fit in radius ${sectorRadius}`,
    };
    return {
      ok: false,
      reason: 'capacity_unachievable',
      sectorId,
      kind: 'land',
      foundingCapacity,
      validatedSafeSites: placed.length,
      safeLandingSlots: placed,
      issues: [issue],
    };
  }

  return {
    ok: true,
    sectorId,
    kind: 'land',
    foundingCapacity,
    validatedSafeSites: placed.length,
    safeLandingSlots: placed,
    issues: [],
  };
}

export function chooseSlotStarterDepositCoords(
  slot: SafeLandingSlotV1,
  sectorRadius: number,
  landSectorIds: ReadonlySet<SectorId>,
  takenDepositCoords: ReadonlySet<number>,
): { metals: { q: number; r: number }; minerals: { q: number; r: number } } {
  const chosen: Array<{ q: number; r: number }> = [];
  for (const [dq, dr] of SAFE_DEPOSIT_OFFSETS) {
    if (chosen.length >= 2) break;
    const q = slot.q + dq + 0;
    const r = slot.r + dr + 0;
    if (isInPodBlastCircle(slot.q, slot.r, q, r)) continue;
    const owner = globalTileToSector(q, r, sectorRadius);
    if (!landSectorIds.has(owner.sectorId)) continue;
    let ringInLand = true;
    for (const [ndq, ndr] of HEX_DIRS) {
      const nbOwner = globalTileToSector(q + ndq, r + ndr, sectorRadius);
      if (!landSectorIds.has(nbOwner.sectorId)) {
        ringInLand = false;
        break;
      }
    }
    if (!ringInLand) continue;
    if (chosen.some((c) => hexDistance(q, r, c.q, c.r) < 2)) continue;
    if (takenDepositCoords.has(packAtlasCoord(q, r))) continue;
    chosen.push({ q, r });
  }

  while (chosen.length < 2) {
    const fallback = chosen.length === 0 ? { q: slot.q + 4, r: slot.r } : { q: slot.q, r: slot.r + 4 };
    chosen.push(fallback);
  }
  return { metals: chosen[0]!, minerals: chosen[1]! };
}

function recordSlotOverrides(
  slot: SafeLandingSlotV1,
  sectorRadius: number,
  landSectorIds: ReadonlySet<SectorId>,
  flatOverrideCoords: Set<number>,
  starterDepositsByCoord: Map<number, number>,
  suppressedDepositCoords: Set<number>,
): void {
  for (let dr = -4; dr <= 4; dr++) {
    for (let dq = -4; dq <= 4; dq++) {
      const d = hexDistance(0, 0, dq, dr);
      if (d > 4) continue;
      const q = slot.q + dq + 0;
      const r = slot.r + dr + 0;
      const key = packAtlasCoord(q, r);
      const inBlast = isInPodBlastCircle(slot.q, slot.r, q, r);
      if (d <= 3 || inBlast) {
        flatOverrideCoords.add(key);
      }
      if (d <= 2 || inBlast) {
        suppressedDepositCoords.add(key);
      }
    }
  }

  const pair = chooseSlotStarterDepositCoords(slot, sectorRadius, landSectorIds, suppressedDepositCoords);
  const entries: ReadonlyArray<readonly [{ q: number; r: number }, number]> = [
    [pair.metals, DEPOSIT.metals],
    [pair.minerals, DEPOSIT.minerals],
  ];

  for (const [depCoord, depKind] of entries) {
    const depKey = packAtlasCoord(depCoord.q, depCoord.r);
    starterDepositsByCoord.set(depKey, depKind);
    flatOverrideCoords.add(depKey);
    suppressedDepositCoords.add(depKey);
    for (const [dq, dr] of HEX_DIRS) {
      const nKey = packAtlasCoord(depCoord.q + dq, depCoord.r + dr);
      flatOverrideCoords.add(nKey);
      suppressedDepositCoords.add(nKey);
    }
  }
}

export function buildSamplerLandingPlan(opts: {
  readonly landMacros: ReadonlyArray<{ readonly sectorId: SectorId; readonly macroQ: number; readonly macroR: number }>;
  readonly sectorRadius: number;
  readonly foundingSeatsPerSector?: number;
  readonly seed: string;
  readonly minSlotSeparation?: number;
}): AtlasSamplerLandingPlan {
  const foundingSeatsPerSector = opts.foundingSeatsPerSector ?? W11_DEFAULT_FOUNDING_SEATS_PER_SECTOR;
  const minSlotSeparation = opts.minSlotSeparation ?? W11_DEFAULT_MIN_SLOT_SEPARATION;
  const landSectorIds = new Set<SectorId>(opts.landMacros.map((m) => m.sectorId));
  const hasLandNeighborSec10 = landSectorIds.has('sec_1_0');

  const slotsBySectorId = new Map<SectorId, readonly SafeLandingSlotV1[]>();
  const allSlots: SafeLandingSlotV1[] = [];
  const flatOverrideCoords = new Set<number>();
  const starterDepositsByCoord = new Map<number, number>();
  const suppressedDepositCoords = new Set<number>();

  for (const macro of opts.landMacros) {
    const res = planSectorLandingSites({
      sectorId: macro.sectorId,
      kind: 'land',
      macroQ: macro.macroQ,
      macroR: macro.macroR,
      sectorRadius: opts.sectorRadius,
      foundingCapacity: foundingSeatsPerSector,
      seed: opts.seed,
      minSlotSeparation,
      existingSlots: allSlots,
      hasLandNeighborSec10,
    });
    slotsBySectorId.set(macro.sectorId, res.safeLandingSlots);
    allSlots.push(...res.safeLandingSlots);
  }

  for (const slot of allSlots) {
    recordSlotOverrides(
      slot,
      opts.sectorRadius,
      landSectorIds,
      flatOverrideCoords,
      starterDepositsByCoord,
      suppressedDepositCoords,
    );
  }

  return {
    foundingSeatsPerSector,
    slotsBySectorId,
    allSlots,
    flatOverrideCoords,
    starterDepositsByCoord,
    suppressedDepositCoords,
  };
}

function writeAtlasTileOverride(
  atlas: GeneratedSmallAtlas,
  q: number,
  r: number,
  patch: { terrain?: number; prep?: number; height?: number; deposit?: number; richness?: number },
): void {
  const owner = atlas.partition.getTile(q, r);
  if (!owner) return;
  const aIdx = owner.atlasIndex;
  const sec = atlas.sectorById.get(owner.sectorId);
  const lIdx = owner.localIndex;

  if (patch.terrain !== undefined) {
    atlas.terrain[aIdx] = patch.terrain;
    if (sec) sec.terrain[lIdx] = patch.terrain;
  }
  if (patch.prep !== undefined) {
    atlas.prep[aIdx] = patch.prep;
    if (sec) sec.prep[lIdx] = patch.prep;
  }
  if (patch.height !== undefined) {
    const h = Math.fround(patch.height);
    atlas.height[aIdx] = h;
    if (sec) sec.height[lIdx] = h;
  }
  if (patch.deposit !== undefined) {
    atlas.deposit[aIdx] = patch.deposit;
    atlas.depositTier[aIdx] = 0;
    if (sec) {
      sec.deposit[lIdx] = patch.deposit;
      sec.depositTier[lIdx] = 0;
    }
    if (patch.deposit !== DEPOSIT.none) {
      atlas.subDeposit[aIdx] = DEPOSIT.none;
      atlas.subRichness[aIdx] = 0;
      if (sec) {
        sec.subDeposit[lIdx] = DEPOSIT.none;
        sec.subRichness[lIdx] = 0;
      }
    }
  }
  if (patch.richness !== undefined) {
    atlas.richness[aIdx] = patch.richness;
    if (sec) sec.richness[lIdx] = patch.richness;
  }
}

export function prepareAtlasLandingSites(
  atlas: GeneratedSmallAtlas,
  slots: readonly SafeLandingSlotV1[] = atlas.safeLandingSlots,
): void {
  const landSet = new Set<SectorId>(atlas.landSectorIds);
  const takenDeps = new Set<number>();

  for (const slot of slots) {
    for (let dr = -4; dr <= 4; dr++) {
      for (let dq = -4; dq <= 4; dq++) {
        const d = hexDistance(0, 0, dq, dr);
        if (d > 4) continue;
        const q = slot.q + dq + 0;
        const r = slot.r + dr + 0;
        const inBlast = isInPodBlastCircle(slot.q, slot.r, q, r);
        if (d <= 3 || inBlast) {
          writeAtlasTileOverride(atlas, q, r, { terrain: TERRAIN.flat, prep: PREP.flat, height: 0.08 });
        }
        if (d <= 2 || inBlast) {
          writeAtlasTileOverride(atlas, q, r, { deposit: DEPOSIT.none, richness: 0 });
          takenDeps.add(packAtlasCoord(q, r));
        }
      }
    }

    const pair = chooseSlotStarterDepositCoords(slot, atlas.sectorRadius, landSet, takenDeps);
    const deps: ReadonlyArray<readonly [{ q: number; r: number }, number]> = [
      [pair.metals, DEPOSIT.metals],
      [pair.minerals, DEPOSIT.minerals],
    ];
    for (const [coord, kind] of deps) {
      for (const [dq, dr] of [[0, 0], ...HEX_DIRS] as const) {
        const nq = coord.q + dq + 0;
        const nr = coord.r + dr + 0;
        writeAtlasTileOverride(atlas, nq, nr, {
          terrain: TERRAIN.flat,
          prep: PREP.flat,
          height: 0.08,
          deposit: DEPOSIT.none,
          richness: 0,
        });
        takenDeps.add(packAtlasCoord(nq, nr));
      }
      const owner = atlas.partition.getTile(coord.q, coord.r);
      const rich = getDepositRichnessBp(
        atlas.seed,
        owner ? owner.atlasIndex : Math.abs(coord.q * 31 + coord.r),
        kind,
        atlas.planetType,
      );
      writeAtlasTileOverride(atlas, coord.q, coord.r, { deposit: kind, richness: rich });
    }
  }
}
