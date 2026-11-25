import { ENTITY_KIND, ENTITY_STATE, getBuildingFootprintTiles, hexDistance } from '@terra/sim';
import type { EntityMeshRecord } from './EntityMeshes';
import { is2x2BuildingKind, is3x3FootprintKind, isConstructibleBuilding } from './entityKinds';

/** Fallback horizontal hull radius (m) when a building mesh has no triangle geometry (e.g. mock meshes in unit tests). */
export function buildingFootprintSurfaceRadius(kind: number): number {
  if (is3x3FootprintKind(kind)) return 2.35;
  if (is2x2BuildingKind(kind)) return 1.45;
  return 0.55;
}

export function isTargetableBuildingRecord(rec: EntityMeshRecord): boolean {
  return isConstructibleBuilding(rec.kind) || rec.kind === ENTITY_KIND.pod;
}

function buildingCoversTile(bldg: EntityMeshRecord, q: number, r: number): boolean {
  const fp = is3x3FootprintKind(bldg.kind) ? 3 : is2x2BuildingKind(bldg.kind) ? 2 : 1;
  return getBuildingFootprintTiles(bldg.q, bldg.r, fp).some((t) => t.q === q && t.r === r);
}

function rankBuildingCandidate(a: EntityMeshRecord, b: EntityMeshRecord, worker: EntityMeshRecord, q: number, r: number): number {
  const aActiveBuild = a.state === ENTITY_STATE.constructing || a.state === ENTITY_STATE.waiting ? 0 : 1;
  const bActiveBuild = b.state === ENTITY_STATE.constructing || b.state === ENTITY_STATE.waiting ? 0 : 1;
  if (aActiveBuild !== bActiveBuild) return aActiveBuild - bActiveBuild;
  const aOwn = a.owner === worker.owner ? 0 : 1;
  const bOwn = b.owner === worker.owner ? 0 : 1;
  if (aOwn !== bOwn) return aOwn - bOwn;
  const aAnchorDist = hexDistance(a.q, a.r, q, r);
  const bAnchorDist = hexDistance(b.q, b.r, q, r);
  if (aAnchorDist !== bAnchorDist) return aAnchorDist - bAnchorDist;
  const aWorkerDist = hexDistance(a.q, a.r, worker.q, worker.r);
  const bWorkerDist = hexDistance(b.q, b.r, worker.q, worker.r);
  if (aWorkerDist !== bWorkerDist) return aWorkerDist - bWorkerDist;
  return a.id - b.id;
}

/** Finds the building mesh whose footprint covers `(q, r)` or sits closest within reach of `worker`. */
export function findBuildingAtOrNear(
  records: ReadonlyMap<number, EntityMeshRecord>,
  q: number,
  r: number,
  worker: EntityMeshRecord,
): EntityMeshRecord | null {
  const covering: EntityMeshRecord[] = [];
  const nearby: EntityMeshRecord[] = [];
  for (const other of records.values()) {
    if (other.id === worker.id || !isTargetableBuildingRecord(other)) continue;
    if (buildingCoversTile(other, q, r)) covering.push(other);
    else if (hexDistance(other.q, other.r, q, r) <= 2 && hexDistance(other.q, other.r, worker.q, worker.r) <= 4) {
      nearby.push(other);
    }
  }
  const pool = covering.length > 0 ? covering : nearby;
  if (pool.length === 0) return null;
  pool.sort((a, b) => rankBuildingCandidate(a, b, worker, q, r));
  return pool[0] ?? null;
}

/** Resolves the target building entity for a `build` / `construct` unit command from `orderId` or coordinates. */
export function resolveBuildOrderTargetEntity(
  worker: EntityMeshRecord,
  cur: { orderId?: string },
  records: ReadonlyMap<number, EntityMeshRecord>,
  blobs: Record<string, unknown> | undefined,
  q: number,
  r: number,
): EntityMeshRecord | null {
  const orderId = cur.orderId;
  if (typeof orderId === 'string' && orderId.startsWith('job:')) {
    const id = Number(orderId.slice(4));
    const direct = Number.isInteger(id) && id > 0 ? records.get(id) : undefined;
    if (direct && isTargetableBuildingRecord(direct)) return direct;
  }

  const cQueue = (blobs?.constructionQueue as { value?: unknown } | undefined)?.value ?? blobs?.constructionQueue;
  const orders = (cQueue as { orders?: Array<{ orderId?: string; entityId?: number }> } | undefined)?.orders;
  if (orderId && Array.isArray(orders)) {
    const match = orders.find((o) => o.orderId === orderId && typeof o.entityId === 'number');
    const rec = match?.entityId ? records.get(match.entityId) : undefined;
    if (rec && isTargetableBuildingRecord(rec)) return rec;
  }

  const cBlob = (blobs?.construction as { value?: unknown } | undefined)?.value ?? blobs?.construction;
  const jobs = (cBlob as { jobs?: Record<string, { entityId?: number; q?: number; r?: number }> } | undefined)?.jobs;
  if (jobs) {
    for (const job of Object.values(jobs)) {
      if (!job.entityId) continue;
      if ((orderId && `job:${job.entityId}` === orderId) || (job.q === q && job.r === r)) {
        const rec = records.get(job.entityId);
        if (rec && isTargetableBuildingRecord(rec)) return rec;
      }
    }
  }

  return findBuildingAtOrNear(records, q, r, worker);
}

/** Resolves the building entity when a worker is in `constructing` or `repairing` state without an explicit job entry. */
export function findConstructingOrRepairTargetForWorker(
  worker: EntityMeshRecord,
  records: ReadonlyMap<number, EntityMeshRecord>,
  blobs: Record<string, unknown> | undefined,
): EntityMeshRecord | null {
  const blobCandidates: EntityMeshRecord[] = [];
  const pushBlobBuilding = (entityId: number | undefined) => {
    if (!entityId) return;
    const rec = records.get(entityId);
    if (rec && isConstructibleBuilding(rec.kind) && hexDistance(rec.q, rec.r, worker.q, worker.r) <= 4) {
      blobCandidates.push(rec);
    }
  };

  const cQueue = (blobs?.constructionQueue as { value?: unknown } | undefined)?.value ?? blobs?.constructionQueue;
  const orders = (cQueue as { orders?: Array<{ colonyId?: number; entityId?: number; status?: string }> } | undefined)?.orders;
  if (Array.isArray(orders)) {
    for (const o of orders) {
      if (o.colonyId === undefined || o.colonyId === worker.owner) pushBlobBuilding(o.entityId);
    }
  }

  const cBlob = (blobs?.construction as { value?: unknown } | undefined)?.value ?? blobs?.construction;
  const jobs = (cBlob as { jobs?: Record<string, { owner?: number; entityId?: number }> } | undefined)?.jobs;
  if (jobs) {
    for (const j of Object.values(jobs)) {
      if (j.owner === undefined || j.owner === worker.owner) pushBlobBuilding(j.entityId);
    }
  }

  if (blobCandidates.length > 0) {
    blobCandidates.sort((a, b) => rankBuildingCandidate(a, b, worker, worker.q, worker.r));
    return blobCandidates[0] ?? null;
  }

  const nearby: EntityMeshRecord[] = [];
  for (const other of records.values()) {
    if (other.id === worker.id || !isConstructibleBuilding(other.kind)) continue;
    if (hexDistance(other.q, other.r, worker.q, worker.r) <= 4) nearby.push(other);
  }
  if (nearby.length === 0) return null;
  nearby.sort((a, b) => rankBuildingCandidate(a, b, worker, worker.q, worker.r));
  return nearby[0] ?? null;
}
