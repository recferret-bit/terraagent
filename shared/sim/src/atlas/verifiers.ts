import type { SectorId } from '@terra/contracts';
import { HEX_DIRS, hexDistance } from '../grid/hex';
import { DEPOSIT, TERRAIN } from '../grid/layers';
import { tileCoordKey } from './partition';
import type {
  ConnectedContinentReport,
  GeneratedAtlasTile,
  GeneratedSmallAtlas,
  SeamContinuityOptions,
  SeamContinuityReport,
  SeamContinuityViolation,
} from './types';

function isWaterTerrain(terrain: number): boolean {
  return terrain === TERRAIN.shallow || terrain === TERRAIN.deep;
}

function seamEdgeKey(qA: number, rA: number, qB: number, rB: number): string {
  const kA = tileCoordKey(qA, rA);
  const kB = tileCoordKey(qB, rB);
  return kA < kB ? `${kA}|${kB}` : `${kB}|${kA}`;
}

function checkSeamPairViolation(
  tileA: GeneratedAtlasTile,
  tileB: GeneratedAtlasTile,
  delta: number,
  limits: { maxLandStepM: number; maxCoastStepM: number; maxOceanStepM: number },
): SeamContinuityViolation | null {
  if (tileA.kind === 'land' && tileB.kind === 'land') {
    if (delta <= limits.maxLandStepM) return null;
    return {
      kind: 'land_height_step',
      sectorA: tileA.sectorId,
      sectorB: tileB.sectorId,
      qA: tileA.q,
      rA: tileA.r,
      qB: tileB.q,
      rB: tileB.r,
      heightDeltaM: delta,
      message: `land seam step ${delta.toFixed(3)}m exceeds ${limits.maxLandStepM}m between ${tileA.sectorId} and ${tileB.sectorId}`,
    };
  }
  if (tileA.kind === 'ocean' && tileB.kind === 'ocean') {
    if (!isWaterTerrain(tileA.terrain) || !isWaterTerrain(tileB.terrain)) {
      return {
        kind: 'ocean_not_water',
        sectorA: tileA.sectorId,
        sectorB: tileB.sectorId,
        qA: tileA.q,
        rA: tileA.r,
        qB: tileB.q,
        rB: tileB.r,
        heightDeltaM: delta,
        message: `ocean seam tiles must be water between ${tileA.sectorId} and ${tileB.sectorId}`,
      };
    }
    if (delta <= limits.maxOceanStepM) return null;
    return {
      kind: 'ocean_height_step',
      sectorA: tileA.sectorId,
      sectorB: tileB.sectorId,
      qA: tileA.q,
      rA: tileA.r,
      qB: tileB.q,
      rB: tileB.r,
      heightDeltaM: delta,
      message: `ocean seam step ${delta.toFixed(3)}m exceeds ${limits.maxOceanStepM}m`,
    };
  }
  const oceanTile = tileA.kind === 'ocean' ? tileA : tileB;
  if (!isWaterTerrain(oceanTile.terrain)) {
    return {
      kind: 'ocean_not_water',
      sectorA: tileA.sectorId,
      sectorB: tileB.sectorId,
      qA: tileA.q,
      rA: tileA.r,
      qB: tileB.q,
      rB: tileB.r,
      heightDeltaM: delta,
      message: `ocean halo tile (${oceanTile.q},${oceanTile.r}) in ${oceanTile.sectorId} is not water`,
    };
  }
  if (delta <= limits.maxCoastStepM) return null;
  return {
    kind: 'coast_height_step',
    sectorA: tileA.sectorId,
    sectorB: tileB.sectorId,
    qA: tileA.q,
    rA: tileA.r,
    qB: tileB.q,
    rB: tileB.r,
    heightDeltaM: delta,
    message: `coastal seam step ${delta.toFixed(3)}m exceeds ${limits.maxCoastStepM}m`,
  };
}

export function verifyAtlasSeamContinuity(
  atlas: GeneratedSmallAtlas,
  opts?: SeamContinuityOptions,
): SeamContinuityReport {
  const limits = {
    maxLandStepM: opts?.maxLandStepM ?? 1.25,
    maxCoastStepM: opts?.maxCoastStepM ?? 1.1,
    maxOceanStepM: opts?.maxOceanStepM ?? 0.35,
  };
  const seenEdges = new Set<string>();
  const violations: SeamContinuityViolation[] = [];
  let totalSeamPairs = 0;
  let landToLandPairs = 0;
  let landToOceanPairs = 0;
  let oceanToOceanPairs = 0;
  let maxHeightDeltaM = 0;
  let maxLandToLandHeightDeltaM = 0;
  let sumLandToLandHeightDeltaM = 0;
  let maxLandToOceanHeightDeltaM = 0;
  let maxOceanToOceanHeightDeltaM = 0;

  for (const seam of atlas.partition.seamTiles) {
    const tileA = atlas.getTile(seam.q, seam.r);
    if (!tileA) continue;
    for (const cross of seam.crossSectorNeighbors) {
      if (!cross.inAtlas) continue;
      const edgeKey = seamEdgeKey(seam.q, seam.r, cross.q, cross.r);
      if (seenEdges.has(edgeKey)) continue;
      seenEdges.add(edgeKey);

      const tileB = atlas.getTile(cross.q, cross.r);
      if (!tileB) continue;
      totalSeamPairs++;
      const delta = Math.abs(tileA.height - tileB.height);
      if (delta > maxHeightDeltaM) maxHeightDeltaM = delta;

      if (tileA.kind === 'land' && tileB.kind === 'land') {
        landToLandPairs++;
        sumLandToLandHeightDeltaM += delta;
        if (delta > maxLandToLandHeightDeltaM) maxLandToLandHeightDeltaM = delta;
      } else if (tileA.kind === 'ocean' && tileB.kind === 'ocean') {
        oceanToOceanPairs++;
        if (delta > maxOceanToOceanHeightDeltaM) maxOceanToOceanHeightDeltaM = delta;
      } else {
        landToOceanPairs++;
        if (delta > maxLandToOceanHeightDeltaM) maxLandToOceanHeightDeltaM = delta;
      }

      const violation = checkSeamPairViolation(tileA, tileB, delta, limits);
      if (violation) violations.push(violation);
    }
  }

  return {
    ok: violations.length === 0,
    totalSeamPairs,
    landToLandPairs,
    landToOceanPairs,
    oceanToOceanPairs,
    maxHeightDeltaM,
    maxLandToLandHeightDeltaM,
    meanLandToLandHeightDeltaM: landToLandPairs > 0 ? sumLandToLandHeightDeltaM / landToLandPairs : 0,
    maxLandToOceanHeightDeltaM,
    maxOceanToOceanHeightDeltaM,
    violations,
  };
}

function checkOceanHaloInvariants(
  atlas: GeneratedSmallAtlas,
  reasons: string[],
): { oceanHaloAllWater: boolean; oceanHaloZeroCapacity: boolean } {
  let oceanHaloAllWater = true;
  let oceanHaloZeroCapacity = true;

  for (const sectorId of atlas.oceanSectorIds) {
    const sec = atlas.sectorById.get(sectorId);
    if (!sec) continue;
    if (sec.foundingCapacity !== 0 || sec.continentId !== null) {
      oceanHaloZeroCapacity = false;
      reasons.push(`ocean sector ${sectorId} must have foundingCapacity=0 and continentId=null`);
    }
    for (let i = 0; i < sec.tileCount; i++) {
      const t = sec.terrain[i]!;
      if (!isWaterTerrain(t) || sec.deposit[i] !== DEPOSIT.none) {
        oceanHaloAllWater = false;
        reasons.push(`ocean sector ${sectorId} localIndex ${i} has non-water terrain=${t} or deposit=${sec.deposit[i]}`);
        break;
      }
    }
  }
  return { oceanHaloAllWater, oceanHaloZeroCapacity };
}

function findLargestLandComponent(
  landTilesByKey: ReadonlyMap<string, GeneratedAtlasTile>,
): GeneratedAtlasTile[] {
  const visited = new Set<string>();
  let bestComponent: GeneratedAtlasTile[] = [];

  for (const [startKey, startTile] of landTilesByKey) {
    if (visited.has(startKey)) continue;
    const queue: GeneratedAtlasTile[] = [startTile];
    visited.add(startKey);
    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++]!;
      for (const [dq, dr] of HEX_DIRS) {
        const nKey = tileCoordKey(cur.q + dq, cur.r + dr);
        if (visited.has(nKey)) continue;
        const nb = landTilesByKey.get(nKey);
        if (!nb) continue;
        visited.add(nKey);
        queue.push(nb);
      }
    }
    if (queue.length > bestComponent.length) bestComponent = queue;
  }
  return bestComponent;
}

export function verifyAtlasConnectedContinent(atlas: GeneratedSmallAtlas): ConnectedContinentReport {
  const reasons: string[] = [];
  const { oceanHaloAllWater, oceanHaloZeroCapacity } = checkOceanHaloInvariants(atlas, reasons);

  const landTilesByKey = new Map<string, GeneratedAtlasTile>();
  for (const sectorId of atlas.landSectorIds) {
    const sec = atlas.sectorById.get(sectorId);
    if (!sec) continue;
    if (sec.continentId !== atlas.continentId) {
      reasons.push(`land sector ${sectorId} has continentId=${sec.continentId}, expected ${atlas.continentId}`);
    }
    for (const st of sec.tiles) {
      const tile = atlas.getTile(st.q, st.r);
      if (tile && !isWaterTerrain(tile.terrain)) {
        landTilesByKey.set(tileCoordKey(st.q, st.r), tile);
      }
    }
  }

  const bestComponent = findLargestLandComponent(landTilesByKey);
  const reachedSet = new Set<SectorId>(bestComponent.map((t) => t.sectorId));
  const reachedLandSectorIds = atlas.landSectorIds.filter((id) => reachedSet.has(id));
  if (reachedLandSectorIds.length !== atlas.landSectorIds.length) {
    reasons.push(`connected landmass reached ${reachedLandSectorIds.length}/${atlas.landSectorIds.length} land sectors`);
  }

  const pairLinks = new Map<string, number>();
  let crossSectorLandEdges = 0;
  for (const tile of bestComponent) {
    for (const [dq, dr] of HEX_DIRS) {
      const nb = landTilesByKey.get(tileCoordKey(tile.q + dq, tile.r + dr));
      if (!nb || nb.sectorId === tile.sectorId) continue;
      crossSectorLandEdges++;
      const pairKey = tile.sectorId < nb.sectorId ? `${tile.sectorId}|${nb.sectorId}` : `${nb.sectorId}|${tile.sectorId}`;
      pairLinks.set(pairKey, (pairLinks.get(pairKey) ?? 0) + 1);
    }
  }
  crossSectorLandEdges = Math.floor(crossSectorLandEdges / 2);

  for (let i = 0; i < atlas.landSectorIds.length; i++) {
    const secA = atlas.sectorById.get(atlas.landSectorIds[i]!)!;
    for (let j = i + 1; j < atlas.landSectorIds.length; j++) {
      const secB = atlas.sectorById.get(atlas.landSectorIds[j]!)!;
      if (hexDistance(secA.macroQ, secA.macroR, secB.macroQ, secB.macroR) !== 1) continue;
      const pairKey = secA.sectorId < secB.sectorId ? `${secA.sectorId}|${secB.sectorId}` : `${secB.sectorId}|${secA.sectorId}`;
      if (!pairLinks.get(pairKey)) {
        reasons.push(`adjacent land sectors ${secA.sectorId} and ${secB.sectorId} have no connected land border crossing`);
      }
    }
  }

  const totalLandTileCount = landTilesByKey.size;
  const connectedLandTileCount = bestComponent.length;
  const connectedShare = totalLandTileCount > 0 ? connectedLandTileCount / totalLandTileCount : 0;
  if (connectedShare < 0.85) {
    reasons.push(`connected land share ${connectedShare.toFixed(3)} is below 0.85`);
  }

  return {
    ok: reasons.length === 0,
    continentId: atlas.continentId,
    landSectorCount: atlas.landSectorIds.length,
    reachedLandSectorIds,
    connectedLandTileCount,
    totalLandTileCount,
    connectedShare,
    crossSectorLandEdges,
    oceanHaloAllWater,
    oceanHaloZeroCapacity,
    reasons,
  };
}
