import type { LandingSlotId, SafeLandingSlotV1, SectorId } from '@terra/contracts';
import { HEX_DIRS, hexDistance, levelledFlatHeight } from '../grid/hex';
import { HEX_LEVEL_EPS_M, isOpenGround } from '../grid/hexTile';
import { DEPOSIT, PREP, TERRAIN } from '../grid/layers';
import { globalTileToSector } from './partition';
import type {
  GeneratedSmallAtlas,
  LandingSiteValidationIssue,
  StarterResourceDepositRef,
  ValidatedLandingSlotDetail,
} from './types';

export interface LiveAtlasTileState {
  readonly q: number;
  readonly r: number;
  readonly sectorId: SectorId;
  readonly isLandSector: boolean;
  readonly terrain: number;
  readonly prep: number;
  readonly height: number;
  readonly deposit: number;
  readonly richness: number;
}

export function readLiveAtlasTile(atlas: GeneratedSmallAtlas, q: number, r: number): LiveAtlasTileState {
  const owner = atlas.partition.getTile(q, r);
  if (owner) {
    const sec = atlas.sectorById.get(owner.sectorId);
    const aIdx = owner.atlasIndex;
    const lIdx = owner.localIndex;
    return {
      q,
      r,
      sectorId: owner.sectorId,
      isLandSector: owner.kind === 'land',
      terrain: sec ? sec.terrain[lIdx]! : atlas.terrain[aIdx]!,
      prep: sec ? sec.prep[lIdx]! : atlas.prep[aIdx]!,
      height: sec ? sec.height[lIdx]! : atlas.height[aIdx]!,
      deposit: sec ? sec.deposit[lIdx]! : atlas.deposit[aIdx]!,
      richness: sec ? sec.richness[lIdx]! : atlas.richness[aIdx]!,
    };
  }
  const sampled = atlas.sampleGlobalTile(q, r);
  const lookup = globalTileToSector(q, r, atlas.sectorRadius);
  return {
    q,
    r,
    sectorId: lookup.sectorId,
    isLandSector: sampled.isLandSector,
    terrain: sampled.terrain,
    prep: sampled.prep,
    height: sampled.height,
    deposit: sampled.deposit,
    richness: sampled.richness,
  };
}

export function isAtlasHexTile(atlas: GeneratedSmallAtlas, q: number, r: number): boolean {
  const center = readLiveAtlasTile(atlas, q, r);
  if (!center.isLandSector || !isOpenGround(center.terrain, center.prep)) return false;
  const h0 = levelledFlatHeight(center.height);
  for (const [dq, dr] of HEX_DIRS) {
    const nb = readLiveAtlasTile(atlas, q + dq, r + dr);
    if (!nb.isLandSector || !isOpenGround(nb.terrain, nb.prep)) return false;
    if (Math.abs(levelledFlatHeight(nb.height) - h0) > HEX_LEVEL_EPS_M) return false;
  }
  return true;
}

export function checkGroundForSlot(
  atlas: GeneratedSmallAtlas,
  slot: SafeLandingSlotV1,
  minBuildableR4: number,
  groundIssues: LandingSiteValidationIssue[],
): { padFlatR1: boolean; buildableR4Count: number; buildableHexTileR4Count: number } {
  const centerTile = readLiveAtlasTile(atlas, slot.q, slot.r);
  const centerLevelH = levelledFlatHeight(centerTile.height);
  let padFlatR1 =
    centerTile.isLandSector &&
    centerTile.terrain === TERRAIN.flat &&
    centerTile.prep === PREP.flat &&
    centerTile.deposit === DEPOSIT.none;

  for (const [dq, dr] of HEX_DIRS) {
    const nb = readLiveAtlasTile(atlas, slot.q + dq, slot.r + dr);
    if (
      !nb.isLandSector ||
      nb.terrain !== TERRAIN.flat ||
      nb.prep !== PREP.flat ||
      nb.deposit !== DEPOSIT.none ||
      Math.abs(levelledFlatHeight(nb.height) - centerLevelH) > HEX_LEVEL_EPS_M
    ) {
      padFlatR1 = false;
    }
  }

  let buildableR4Count = 0;
  let buildableHexTileR4Count = 0;
  for (let dr = -4; dr <= 4; dr++) {
    for (let dq = -4; dq <= 4; dq++) {
      if (hexDistance(0, 0, dq, dr) > 4) continue;
      const q = slot.q + dq;
      const r = slot.r + dr;
      const t = readLiveAtlasTile(atlas, q, r);
      if (t.isLandSector && t.terrain === TERRAIN.flat && t.prep === PREP.flat) buildableR4Count++;
      if (isAtlasHexTile(atlas, q, r)) buildableHexTileR4Count++;
    }
  }

  if (!padFlatR1 || buildableR4Count < minBuildableR4 || buildableHexTileR4Count < minBuildableR4) {
    groundIssues.push({
      reason: 'insufficient_buildable_ground',
      sectorId: slot.sectorId,
      slotId: slot.slotId,
      q: slot.q,
      r: slot.r,
      buildableR4Count: Math.min(buildableR4Count, buildableHexTileR4Count),
      minRequiredBuildableR4: minBuildableR4,
      message: `slot ${slot.slotId} at (${slot.q},${slot.r}) has insufficient buildable ground`,
    });
  }
  return { padFlatR1, buildableR4Count, buildableHexTileR4Count };
}

export function checkResourcesForSlot(
  atlas: GeneratedSmallAtlas,
  slot: SafeLandingSlotV1,
  minResDist: number,
  maxResDist: number,
  resourceIssues: LandingSiteValidationIssue[],
): {
  metalsTile: StarterResourceDepositRef | null;
  mineralsTile: StarterResourceDepositRef | null;
  crossSectorResourceAccess: boolean;
} {
  let metalsTile: StarterResourceDepositRef | null = null;
  let mineralsTile: StarterResourceDepositRef | null = null;

  for (let dr = -maxResDist; dr <= maxResDist; dr++) {
    for (let dq = -maxResDist; dq <= maxResDist; dq++) {
      const dist = hexDistance(0, 0, dq, dr);
      if (dist < minResDist || dist > maxResDist) continue;
      const q = slot.q + dq;
      const r = slot.r + dr;
      const t = readLiveAtlasTile(atlas, q, r);
      if (t.deposit === DEPOSIT.none || t.richness <= 0 || !isAtlasHexTile(atlas, q, r)) continue;
      const ref: StarterResourceDepositRef = { q, r, sectorId: t.sectorId, distance: dist, richness: t.richness };
      if (t.deposit === DEPOSIT.metals && (!metalsTile || dist < metalsTile.distance)) {
        metalsTile = ref;
      } else if (t.deposit === DEPOSIT.minerals && (!mineralsTile || dist < mineralsTile.distance)) {
        mineralsTile = ref;
      }
    }
  }

  const missingResources: Array<'metals' | 'minerals'> = [];
  if (!metalsTile) missingResources.push('metals');
  if (!mineralsTile) missingResources.push('minerals');
  if (missingResources.length > 0) {
    resourceIssues.push({
      reason: 'missing_starter_resources',
      sectorId: slot.sectorId,
      slotId: slot.slotId,
      q: slot.q,
      r: slot.r,
      missingResources,
      message: `slot ${slot.slotId} at (${slot.q},${slot.r}) missing starter resources [${missingResources.join(', ')}]`,
    });
  }

  const crossSectorResourceAccess =
    (metalsTile !== null && metalsTile.sectorId !== slot.sectorId) ||
    (mineralsTile !== null && mineralsTile.sectorId !== slot.sectorId);
  return { metalsTile, mineralsTile, crossSectorResourceAccess };
}

export function buildSlotDetails(
  atlas: GeneratedSmallAtlas,
  allSlots: readonly SafeLandingSlotV1[],
  minBuildableR4: number,
  minResDist: number,
  maxResDist: number,
  nearestBySlotId: ReadonlyMap<LandingSlotId, { id: LandingSlotId; sec: SectorId; dist: number }>,
  groundIssues: LandingSiteValidationIssue[],
  resourceIssues: LandingSiteValidationIssue[],
): { slotDetails: ValidatedLandingSlotDetail[]; detailsBySector: Map<SectorId, ValidatedLandingSlotDetail[]> } {
  const slotDetails: ValidatedLandingSlotDetail[] = [];
  const detailsBySector = new Map<SectorId, ValidatedLandingSlotDetail[]>();
  for (const slot of allSlots) {
    const lookup = globalTileToSector(slot.q, slot.r, atlas.sectorRadius);
    const gr = checkGroundForSlot(atlas, slot, minBuildableR4, groundIssues);
    const res = checkResourcesForSlot(atlas, slot, minResDist, maxResDist, resourceIssues);
    const nearest = nearestBySlotId.get(slot.slotId) ?? null;
    const detail: ValidatedLandingSlotDetail = {
      ...slot,
      localQ: lookup.localQ,
      localR: lookup.localR,
      localDistance: hexDistance(0, 0, lookup.localQ, lookup.localR),
      padFlatR1: gr.padFlatR1,
      buildableR4Count: gr.buildableR4Count,
      buildableHexTileR4Count: gr.buildableHexTileR4Count,
      metalsTile: res.metalsTile,
      mineralsTile: res.mineralsTile,
      crossSectorResourceAccess: res.crossSectorResourceAccess,
      nearestSlotId: nearest?.id ?? null,
      nearestSlotSectorId: nearest?.sec ?? null,
      nearestSlotDistance: nearest?.dist ?? null,
    };
    slotDetails.push(detail);
    const secList = detailsBySector.get(slot.sectorId) ?? [];
    secList.push(detail);
    detailsBySector.set(slot.sectorId, secList);
  }
  return { slotDetails, detailsBySector };
}
