import { DEPOSIT_CODES, TERRAIN_CODES } from '@terra/contracts/tiles/codes';
import {
  ParticlePresetRegistry,
  computeMeshToolOrigins,
  evalArchetypeToolOrigins,
  type ActiveWorkSiteInput,
  type InteractionTargetKind,
} from '@terra/render/particles';
import { tileXZ, type HexTerrain } from '@terra/render/planets/hex';
import { ENTITY_KIND, ENTITY_STATE, hexDistance } from '@terra/sim';
import { resolveTileIndex } from '../../features/landfall/selectionHelpers';
import type { ClientTiles, ClientView } from '../../store/replica/viewCodec';
import type { EntityMeshRecord } from './EntityMeshes';
import {
  computeWorkTarget,
  entityGroundY,
  hubBuildProgressForState,
  is2x2BuildingKind,
  is3x3FootprintKind,
  isTrackedWalkingUnitKind,
  isWorkerUnitKind,
} from './entityKinds';

export {
  computeWorkTarget,
  entityGroundY,
  hubBuildProgressForState,
  is2x2BuildingKind,
  is3x3FootprintKind,
  isTrackedWalkingUnitKind,
  isWorkerUnitKind,
};

interface RawWorkJob {
  workerEntityId?: number;
  targetEntityId?: number;
  mode?: string;
  terrainKey?: string;
  q?: number;
  r?: number;
  status?: string;
}

interface RawHarvestAssign {
  entityId?: number;
  mode?: string;
  q?: number;
  r?: number;
  resourceKey?: string;
}

const TERRAIN_KEY_BY_CODE: Record<number, string> = {
  [TERRAIN_CODES.flat]: 'flat',
  [TERRAIN_CODES.forest]: 'forest',
  [TERRAIN_CODES.rock]: 'rock',
  [TERRAIN_CODES.slope]: 'slope',
  [TERRAIN_CODES.hole]: 'hole',
  [TERRAIN_CODES.shallow]: 'flat',
  [TERRAIN_CODES.deep]: 'flat',
};

const DEPOSIT_KEY_BY_CODE: Record<number, string> = {
  [DEPOSIT_CODES.metals]: 'metals',
  [DEPOSIT_CODES.minerals]: 'minerals',
  [DEPOSIT_CODES.oil]: 'oil',
};

function unwrapBlob<T>(raw: unknown): T | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  if ('value' in raw && (raw as { value?: unknown }).value && typeof (raw as { value?: unknown }).value === 'object') {
    return (raw as { value: T }).value;
  }
  return raw as T;
}

function archetypeIdForWorkerKind(kind: number): string {
  if (kind === ENTITY_KIND.hq) return 'robot.hero';
  if (kind === ENTITY_KIND.harvester) return 'robot.miner';
  return 'robot.builder';
}

export function computeBotToolOrigins(
  kind: number,
  bx: number,
  by: number,
  bz: number,
  yaw: number,
  time = 0,
  walkWeight = 0,
  workWeight = 1,
): [number, number, number][] {
  return evalArchetypeToolOrigins({
    archetypeId: archetypeIdForWorkerKind(kind),
    position: [bx, by, bz],
    yaw,
    time,
    walkWeight,
    workWeight,
  });
}

export function targetHeightOffset(kind: InteractionTargetKind): number {
  if (kind === 'tree') return 0.52;
  if (kind === 'rock' || kind === 'metals' || kind === 'minerals') return 0.38;
  if (kind === 'dune') return 0.32;
  if (kind === 'repair') return 0.48;
  if (kind === 'hole') return 0.14;
  return 0.22;
}

/** Terrain key of tile `(q, r)` (`grade` on a hole fills it, on a slope levels a dune); undefined off the map. */
function tileTerrainKeyAt(tiles: ClientTiles | null | undefined, planetRadius: number | undefined, q: number, r: number): string | undefined {
  const idx = tiles ? resolveTileIndex(tiles as unknown as Record<string, unknown>, planetRadius, q, r) : -1;
  return idx >= 0 ? TERRAIN_KEY_BY_CODE[Number(tiles!.terrain?.[idx] ?? 0)] : undefined;
}

function inspectTileTargetKind(
  tiles: ClientTiles | null,
  planetRadius: number | undefined,
  q: number,
  r: number,
  biomeKey: string,
  preferDeposit: boolean,
): InteractionTargetKind {
  if (!tiles) return ParticlePresetRegistry.resolveTargetKind({ terrainKey: 'flat', biomeKey });
  const idx = resolveTileIndex(tiles as unknown as Record<string, unknown>, planetRadius, q, r);
  if (idx < 0) return ParticlePresetRegistry.resolveTargetKind({ terrainKey: 'flat', biomeKey });

  const depCode = Number(tiles.deposit?.[idx] ?? 0);
  const terrainCode = Number(tiles.terrain?.[idx] ?? 0);
  const terrainKey = TERRAIN_KEY_BY_CODE[terrainCode] ?? 'flat';
  const depositKind = DEPOSIT_KEY_BY_CODE[depCode];

  if (preferDeposit && depositKind) return ParticlePresetRegistry.resolveTargetKind({ depositKind, biomeKey });
  if (terrainCode !== TERRAIN_CODES.flat) return ParticlePresetRegistry.resolveTargetKind({ terrainKey, biomeKey });
  if (depositKind) return ParticlePresetRegistry.resolveTargetKind({ depositKind, biomeKey });
  return ParticlePresetRegistry.resolveTargetKind({ terrainKey, biomeKey });
}

interface ResolvedTargetInfo {
  q: number;
  r: number;
  targetKind: InteractionTargetKind;
  targetWorldXZ?: [number, number];
}

function resolveFromWorkJobsAndHarvest(
  rec: EntityMeshRecord,
  records: ReadonlyMap<number, EntityMeshRecord>,
  blobs: Record<string, unknown> | undefined,
  tiles: ClientTiles | null,
  planetRadius: number | undefined,
  biomeKey: string,
): ResolvedTargetInfo | null {
  const key = String(rec.id);
  const workJobs = unwrapBlob<{ byId?: Record<string, RawWorkJob> }>(blobs?.workJobs)?.byId;
  if (workJobs) {
    for (const job of Object.values(workJobs)) {
      if (job.workerEntityId !== rec.id) continue;
      const q = Number.isFinite(job.q) ? Number(job.q) : rec.q;
      const r = Number.isFinite(job.r) ? Number(job.r) : rec.r;
      if (job.mode === 'repair' || job.mode === 'dismantle') { // a dismantle shows the same tool sparks on the building
        const tEnt = job.targetEntityId !== undefined ? records.get(job.targetEntityId) : undefined;
        return { q, r, targetKind: 'repair', targetWorldXZ: tEnt ? [tEnt.mesh.position.x, tEnt.mesh.position.z] : undefined };
      }
      if (job.terrainKey) {
        return { q, r, targetKind: ParticlePresetRegistry.resolveTargetKind({ terrainKey: job.terrainKey, biomeKey, mode: job.mode }) };
      }
      return { q, r, targetKind: inspectTileTargetKind(tiles, planetRadius, q, r, biomeKey, false) };
    }
  }

  const assign = unwrapBlob<{ assignments?: Record<string, RawHarvestAssign> }>(blobs?.harvest)?.assignments?.[key];
  if (assign) {
    const q = Number.isFinite(assign.q) ? Number(assign.q) : rec.q;
    const r = Number.isFinite(assign.r) ? Number(assign.r) : rec.r;
    const resPrefix = assign.resourceKey?.split('.')[0];
    if (assign.mode === 'harvest' && resPrefix) {
      return { q, r, targetKind: ParticlePresetRegistry.resolveTargetKind({ depositKind: resPrefix, biomeKey }) };
    }
    if (assign.mode === 'clear' || assign.mode === 'break') {
      return { q, r, targetKind: ParticlePresetRegistry.resolveTargetKind({ mode: assign.mode, biomeKey }) };
    }
    return { q, r, targetKind: inspectTileTargetKind(tiles, planetRadius, q, r, biomeKey, assign.mode === 'harvest') };
  }
  return null;
}

function lookupTerraformTaskOp(
  blobs: Record<string, unknown> | undefined,
  owner: number,
  orderId?: string,
  q?: number,
  r?: number,
): string | undefined {
  const byColony = unwrapBlob<{
    byColony?: Record<number, Array<{ orderId?: string; q?: number; r?: number; op?: string; jobs?: Array<{ q?: number; r?: number; op?: string }> }>>;
  }>(blobs?.terraformTasks)?.byColony;
  const orders = byColony?.[owner];
  if (!Array.isArray(orders)) return undefined;
  for (const ord of orders) {
    if (orderId && ord.orderId === orderId) return ord.jobs?.[0]?.op ?? ord.op;
    if (q !== undefined && r !== undefined) {
      if (ord.q === q && ord.r === r && ord.op) return ord.op;
      const matchedJob = ord.jobs?.find((j) => j.q === q && j.r === r);
      if (matchedJob) return matchedJob.op ?? ord.op;
    }
  }
  return undefined;
}

function findNearbyTerraformOrderTarget(
  blobs: Record<string, unknown> | undefined,
  owner: number,
  bq: number,
  br: number,
  tiles: ClientTiles | null,
  planetRadius: number | undefined,
  biomeKey: string,
): ResolvedTargetInfo | null {
  const byColony = unwrapBlob<{
    byColony?: Record<number, Array<{ q?: number; r?: number; op?: string; jobs?: Array<{ q?: number; r?: number; op?: string }> }>>;
  }>(blobs?.terraformTasks)?.byColony;
  const orders = byColony?.[owner];
  if (!Array.isArray(orders)) return null;
  for (const ord of orders) {
    const job = ord.jobs?.[0] ?? ord;
    if (!Number.isFinite(job.q) || !Number.isFinite(job.r)) continue;
    const jq = Number(job.q);
    const jr = Number(job.r);
    if (hexDistance(bq, br, jq, jr) > 3) continue;
    const op = job.op ?? ord.op;
    if (op && op !== 'prepare' && op !== 'work') {
      return { q: jq, r: jr, targetKind: ParticlePresetRegistry.resolveTargetKind({ mode: op, biomeKey }) };
    }
    return { q: jq, r: jr, targetKind: inspectTileTargetKind(tiles, planetRadius, jq, jr, biomeKey, false) };
  }
  return null;
}

function isObstacleCode(tCode: number): boolean {
  return tCode === TERRAIN_CODES.rock || tCode === TERRAIN_CODES.forest || tCode === TERRAIN_CODES.slope || tCode === TERRAIN_CODES.hole;
}

function findNearestWorkableNeighborTile(
  rec: EntityMeshRecord,
  tiles: ClientTiles | null,
  planetRadius: number | undefined,
  biomeKey: string,
): ResolvedTargetInfo | null {
  if (!tiles) return null;
  const ownIdx = resolveTileIndex(tiles as unknown as Record<string, unknown>, planetRadius, rec.q, rec.r);
  if (ownIdx >= 0) {
    const ownT = Number(tiles.terrain?.[ownIdx] ?? 0);
    const ownD = Number(tiles.deposit?.[ownIdx] ?? 0);
    if (isObstacleCode(ownT) || ownD > 0) return null;
  }

  const bx = rec.mesh.position.x;
  const bz = rec.mesh.position.z;
  const yaw = rec.mesh.rotation.y || Math.PI / 2 - rec.rot;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const preferDeposit = rec.state === ENTITY_STATE.harvesting;

  let bestQ = rec.q;
  let bestR = rec.r;
  let bestScore = -Infinity;

  for (let dr = -2; dr <= 2; dr++) {
    for (let dq = -2; dq <= 2; dq++) {
      const distHex = hexDistance(0, 0, dq, dr);
      if (distHex < 1 || distHex > 2) continue;
      const nq = rec.q + dq;
      const nr = rec.r + dr;
      const idx = resolveTileIndex(tiles as unknown as Record<string, unknown>, planetRadius, nq, nr);
      if (idx < 0) continue;
      const tCode = Number(tiles.terrain?.[idx] ?? 0);
      const dCode = Number(tiles.deposit?.[idx] ?? 0);
      if (!isObstacleCode(tCode) && dCode <= 0) continue;

      const [tx, tz] = tileXZ(nq, nr);
      const dx = tx - bx;
      const dz = tz - bz;
      const align = (dx * fx + dz * fz) / (Math.hypot(dx, dz) || 1);
      const score = align - distHex * 0.35 + (preferDeposit && dCode > 0 ? 0.5 : 0);
      if (score > bestScore) {
        bestScore = score;
        bestQ = nq;
        bestR = nr;
      }
    }
  }

  if (bestScore === -Infinity) return null;
  return { q: bestQ, r: bestR, targetKind: inspectTileTargetKind(tiles, planetRadius, bestQ, bestR, biomeKey, preferDeposit) };
}

function resolveWorkerTargetFromView(
  rec: EntityMeshRecord,
  records: ReadonlyMap<number, EntityMeshRecord>,
  view: ClientView | null,
  tiles: ClientTiles | null,
  biomeKey: string,
): ResolvedTargetInfo {
  const blobs = view?.blobs;
  const planetRadius = view?.planet?.radius;
  const fromJobs = resolveFromWorkJobsAndHarvest(rec, records, blobs, tiles, planetRadius, biomeKey);
  if (fromJobs) return fromJobs;

  const key = String(rec.id);
  const unitRec = unwrapBlob<{ byId?: Record<string, { current?: { kind?: string; op?: string; orderId?: string; q?: number; r?: number } }> }>(
    blobs?.units,
  )?.byId?.[key];
  if (unitRec?.current) {
    const cur = unitRec.current;
    const q = Number.isFinite(cur.q) ? Number(cur.q) : rec.q;
    const r = Number.isFinite(cur.r) ? Number(cur.r) : rec.r;
    if (cur.kind === 'build' || cur.kind === 'construct') return { q, r, targetKind: 'repair' };
    const tfOp = cur.op ?? lookupTerraformTaskOp(blobs, rec.owner, cur.orderId, q, r);
    if (tfOp && tfOp !== 'prepare' && tfOp !== 'work') {
      const terrainKey = tileTerrainKeyAt(tiles, planetRadius, q, r);
      return { q, r, targetKind: ParticlePresetRegistry.resolveTargetKind({ mode: tfOp, terrainKey, biomeKey }) };
    }
    return { q, r, targetKind: inspectTileTargetKind(tiles, planetRadius, q, r, biomeKey, false) };
  }

  if (rec.state === ENTITY_STATE.constructing) {
    for (const other of records.values()) {
      if (other.id !== rec.id && other.state === ENTITY_STATE.constructing && Math.hypot(other.q - rec.q, other.r - rec.r) <= 3) {
        return { q: other.q, r: other.r, targetKind: 'repair', targetWorldXZ: [other.mesh.position.x, other.mesh.position.z] };
      }
    }
    return { q: rec.q, r: rec.r, targetKind: 'repair' };
  }

  if (rec.kind === ENTITY_KIND.hq) {
    const hqView =
      view?.colonies?.[rec.owner]?.hq ??
      unwrapBlob<{ byColony?: Record<number, { targetQ?: number; targetR?: number }> }>(blobs?.hq)?.byColony?.[rec.owner];
    if (hqView && Number.isFinite(hqView.targetQ) && Number.isFinite(hqView.targetR)) {
      const tq = Number(hqView.targetQ);
      const tr = Number(hqView.targetR);
      if (tq !== rec.q || tr !== rec.r) {
        const tfOp = lookupTerraformTaskOp(blobs, rec.owner, undefined, tq, tr);
        if (tfOp && tfOp !== 'prepare' && tfOp !== 'work') {
          const terrainKey = tileTerrainKeyAt(tiles, planetRadius, tq, tr);
          return { q: tq, r: tr, targetKind: ParticlePresetRegistry.resolveTargetKind({ mode: tfOp, terrainKey, biomeKey }) };
        }
        return { q: tq, r: tr, targetKind: inspectTileTargetKind(tiles, planetRadius, tq, tr, biomeKey, false) };
      }
    }
  }

  const nearbyOrder = findNearbyTerraformOrderTarget(blobs, rec.owner, rec.q, rec.r, tiles, planetRadius, biomeKey);
  if (nearbyOrder) return nearbyOrder;

  const fallbackOp = lookupTerraformTaskOp(blobs, rec.owner, undefined, rec.q, rec.r);
  if (fallbackOp && fallbackOp !== 'prepare' && fallbackOp !== 'work') {
    const terrainKey = tileTerrainKeyAt(tiles, planetRadius, rec.q, rec.r);
    return { q: rec.q, r: rec.r, targetKind: ParticlePresetRegistry.resolveTargetKind({ mode: fallbackOp, terrainKey, biomeKey }) };
  }

  const neighborTarget = findNearestWorkableNeighborTile(rec, tiles, planetRadius, biomeKey);
  if (neighborTarget) return neighborTarget;

  return { q: rec.q, r: rec.r, targetKind: inspectTileTargetKind(tiles, planetRadius, rec.q, rec.r, biomeKey, rec.state === ENTITY_STATE.harvesting) };
}

function resolveTargetWorldPosition(
  info: ResolvedTargetInfo,
  bx: number,
  bz: number,
  terrain: HexTerrain | null,
  tiles: ClientTiles | null,
  planetRadius: number | undefined,
): [number, number] {
  if (info.targetWorldXZ) return info.targetWorldXZ;
  const [tileX, tileZ] = tileXZ(info.q, info.r);
  if (terrain?.props && tiles) {
    const tileIdx = resolveTileIndex(tiles as unknown as Record<string, unknown>, planetRadius, info.q, info.r);
    if (tileIdx >= 0) {
      const instances = terrain.props.instancesForTile(tileIdx);
      if (instances.length > 0) {
        let nearest = instances[0];
        let bestD2 = (nearest.x - bx) ** 2 + (nearest.z - bz) ** 2;
        for (let i = 1; i < instances.length; i++) {
          const inst = instances[i];
          const d2 = (inst.x - bx) ** 2 + (inst.z - bz) ** 2;
          if (d2 < bestD2) {
            bestD2 = d2;
            nearest = inst;
          }
        }
        return [nearest.x * 0.65 + tileX * 0.35, nearest.z * 0.65 + tileZ * 0.35];
      }
    }
  }
  return [tileX, tileZ];
}

export function buildActiveWorkSites(params: {
  records: ReadonlyMap<number, EntityMeshRecord>;
  view: ClientView | null;
  tiles: ClientTiles | null;
  terrain: HexTerrain | null;
  biomeKey: string;
  dt?: number;
}): ActiveWorkSiteInput[] {
  const { records, view, tiles, terrain, biomeKey, dt } = params;
  const sites: ActiveWorkSiteInput[] = [];
  const planetRadius = view?.planet?.radius;
  const turnAlpha = dt !== undefined ? Math.min(1, 1 - Math.exp(-dt * 18)) : 1;

  for (const rec of records.values()) {
    if (!isWorkerUnitKind(rec.kind) || !rec.mesh.visible) continue;
    const isWorkingState =
      rec.state === ENTITY_STATE.working ||
      rec.state === ENTITY_STATE.constructing ||
      rec.state === ENTITY_STATE.harvesting;
    if (!isWorkingState) continue;

    const info = resolveWorkerTargetFromView(rec, records, view, tiles, biomeKey);
    const bx = rec.mesh.position.x;
    const by = rec.mesh.position.y;
    const bz = rec.mesh.position.z;

    const [rawTx, rawTz] = resolveTargetWorldPosition(info, bx, bz, terrain, tiles, planetRadius);
    const dx = rawTx - bx;
    const dz = rawTz - bz;
    const dist = Math.hypot(dx, dz);

    let tx: number;
    let tz: number;
    if (dist > 0.35) {
      rec.targetYaw = Math.atan2(dx, dz);
      const pullBack = Math.min(0.12, dist * 0.05);
      tx = rawTx - (dx / dist) * pullBack;
      tz = rawTz - (dz / dist) * pullBack;
    } else {
      tx = bx + Math.sin(rec.mesh.rotation.y) * 1.12;
      tz = bz + Math.cos(rec.mesh.rotation.y) * 1.12;
    }

    const diff = ((((rec.targetYaw - rec.mesh.rotation.y) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    rec.mesh.rotation.y += diff * turnAlpha;

    const groundY = terrain ? terrain.heightAt(tx, tz) : by;
    const ty = groundY + targetHeightOffset(info.targetKind);
    const toolOrigins = computeMeshToolOrigins(rec.mesh, archetypeIdForWorkerKind(rec.kind), rec.walk, rec.work);

    sites.push({
      workerId: String(rec.id),
      targetKind: info.targetKind,
      botOrigin: [bx, by, bz],
      toolOrigins,
      targetPos: [tx, ty, tz],
      groundY,
      intensity: Math.max(0.85, rec.work),
    });
  }

  return sites;
}
