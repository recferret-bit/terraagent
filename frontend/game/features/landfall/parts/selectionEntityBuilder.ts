import { ENTITY_KIND, ENTITY_STATE, hexDistance, type ViewEntity } from '@terra/sim';
import { forEachEntity, type EntityRow } from '../../../store/replica/viewCodec';
import { viewColony } from '../../shared/colony';
import { extractHqFromView, hqJobFromStateCode, type HqStatusView } from '../../shared/hqView';
import { resolveExtractorTierView } from '../extractorTierView';
import type { SelectedEntityView, UnitFailureView } from '../selection';
import { BLDG_META, COMBAT_UNIT_META } from '../selectionMeta';
import {
  buildSupplementalUnitMap,
  normalizeEntityRowWithSupplements,
  resolveEntityActivityProgress,
} from '../selectionHelpers';

/**
 * Whether unit `id` is doing terraform work in `rawView`: a `terraform` unit command (current or shift-queued, from
 * `blobs.units`) or an open work/dismantle job (`blobs.workJobs`) it carries out. Orders in `blobs.terraformTasks` are
 * only the colony queue; the unit's own command is what ties an order to it.
 */
export function unitHasTerraformJob(rawView: unknown, id: number): boolean {
  const blobs = (rawView as { blobs?: Record<string, unknown> } | null)?.blobs;
  const rec = (blobs?.units as { byId?: Record<string, { current?: { kind?: string } | null; queue?: { kind?: string }[] }> } | undefined)?.byId?.[String(id)];
  if (rec?.current?.kind === 'terraform' || (Array.isArray(rec?.queue) && rec.queue.some((c) => c?.kind === 'terraform'))) return true;
  const jobs = (blobs?.workJobs as { byId?: Record<string, { workerEntityId?: number }> } | undefined)?.byId;
  return jobs ? Object.values(jobs).some((j) => j?.workerEntityId === id) : false;
}

export function baseHqSelectedView(hq: HqStatusView): SelectedEntityView {
  return {
    entityId: hq.entityId,
    kind: ENTITY_KIND.hq,
    kindLabel: `HQ T${hq.tier} · COMMANDER DRONE`,
    shortCode: 'HQ',
    isUnit: true,
    isMovable: true,
    tier: hq.tier,
    q: hq.q,
    r: hq.r,
    x: hq.x,
    y: hq.y,
    hp: hq.hp,
    hpMax: hq.hpMax,
    cell: hq.cell,
    cellMax: hq.cellMax,
    currentJob: hq.currentJob,
    queueCount: hq.queueCount,
  };
}

export function enrichHqSelectedView(hq: HqStatusView, rawView: unknown): SelectedEntityView {
  const progress = resolveEntityActivityProgress(
    { id: hq.entityId, kind: ENTITY_KIND.hq, q: hq.q, r: hq.r, x: hq.x, y: hq.y, owner: hq.owner },
    rawView,
  );
  return {
    ...baseHqSelectedView(hq),
    progress,
    terraformJob: unitHasTerraformJob(rawView, hq.entityId),
  };
}

function buildCombatUnitSelectedEntity(
  e: EntityRow,
  progress: number,
  unitsById: Record<string, { current?: unknown; queue?: unknown[] }>,
): SelectedEntityView | null {
  const cu = COMBAT_UNIT_META[e.kind];
  if (!cu) return null;
  const job = hqJobFromStateCode(e.state);
  const uRec = unitsById[String(e.id)];
  const queueCount = uRec
    ? (uRec.current ? 1 : 0) + (Array.isArray(uRec.queue) ? uRec.queue.length : 0)
    : (job === 'idle' ? 0 : 1);
  return {
    entityId: e.id,
    kind: e.kind,
    kindLabel: cu.label,
    shortCode: cu.code,
    isUnit: true,
    isMovable: true,
    tier: 1,
    q: e.q,
    r: e.r,
    x: e.x,
    y: e.y,
    hp: e.hp,
    hpMax: e.hpMax > 0 ? e.hpMax : cu.hpMax,
    currentJob: job,
    queueCount,
    state: e.state,
    progress,
  };
}

function resolveBuildingJobStatus(e: EntityRow, reason: string | undefined, progress: number): string {
  if (reason) return reason;
  if (e.state === ENTITY_STATE.constructing) return 'constructing';
  if (e.state === ENTITY_STATE.waiting) return 'waiting';
  if (e.state === ENTITY_STATE.offlineBrownout) return 'offline: brownout';
  if (e.state === ENTITY_STATE.offlineUnpowered) return 'offline: unpowered';
  if (e.state === ENTITY_STATE.offlineCapped) return 'offline: capped';
  if (e.state === ENTITY_STATE.offlineNoFuel) return 'offline: no fuel';
  if (e.state === ENTITY_STATE.offlineNoGrid) return 'offline: no grid';
  if (e.state === ENTITY_STATE.offlineOverload) return 'offline: overload';
  if (e.kind === ENTITY_KIND.pod) return 'landed';
  return progress > 0 && progress < 1 ? 'working' : 'online';
}

export function buildSelectedEntityFromRow(
  e: EntityRow,
  rawView: unknown,
  offlineReasons: Record<number, string>,
  unitsById: Record<string, { current?: unknown; queue?: unknown[] }>,
): SelectedEntityView | null {
  if (e.hp <= 0 || e.state === ENTITY_STATE.descending || (e.kind === ENTITY_KIND.tradeHub && e.state === ENTITY_STATE.inert)) return null;
  const progress = resolveEntityActivityProgress(e, rawView);
  const combatUnit = buildCombatUnitSelectedEntity(e, progress, unitsById);
  if (combatUnit) return combatUnit;
  if (e.kind === ENTITY_KIND.worker) {
    const tier = e.tier === 2 || e.tier === 3 ? e.tier : 1;
    const job =
      e.state === ENTITY_STATE.moving ? 'moving'
      : e.state === ENTITY_STATE.harvesting ? 'harvesting'
      : e.state === ENTITY_STATE.repairing ? 'repairing'
      : e.state === ENTITY_STATE.constructing ? 'constructing'
      : e.state === ENTITY_STATE.working ? 'working'
      : e.state === ENTITY_STATE.offlineBrownout ? 'offline: brownout'
      : progress > 0 && progress < 1 ? 'working' : 'idle';
    const uRec = unitsById[String(e.id)];
    const queueCount = uRec ? (uRec.current ? 1 : 0) + (Array.isArray(uRec.queue) ? uRec.queue.length : 0) : (job === 'idle' ? 0 : 1);
    return {
      entityId: e.id, kind: e.kind, kindLabel: `WORKER DRONE T${tier}`, shortCode: 'WRK',
      isUnit: true, isMovable: true, tier, q: e.q, r: e.r, x: e.x, y: e.y,
      hp: e.hp, hpMax: e.hpMax > 0 ? e.hpMax : (tier === 2 ? 150 : 160), currentJob: job, queueCount,
      state: e.state, progress, terraformJob: unitHasTerraformJob(rawView, e.id),
    };
  }
  if (e.kind === ENTITY_KIND.devProbe) {
    const job = hqJobFromStateCode(e.state);
    return {
      entityId: e.id, kind: e.kind, kindLabel: 'PROBE DRONE', shortCode: 'PRB',
      isUnit: true, isMovable: true, tier: 1, q: e.q, r: e.r, x: e.x, y: e.y,
      hp: e.hp, hpMax: e.hpMax > 0 ? e.hpMax : 100, currentJob: job, queueCount: job === 'idle' ? 0 : 1,
      state: e.state, progress,
    };
  }
  const b = BLDG_META[e.kind];
  if (!b) return null;
  const dismantle = dismantleJobOf(rawView, e.id);
  if (dismantle) {
    return {
      entityId: e.id, kind: e.kind, kindLabel: b.label, shortCode: b.code,
      isUnit: false, isMovable: false, tier: 1, q: e.q, r: e.r, x: e.x, y: e.y,
      hp: e.hp, hpMax: e.hpMax > 0 ? e.hpMax : b.hpMax, currentJob: 'dismantling', queueCount: 1,
      footprintW: b.w, footprintD: b.d, state: e.state, progress: Math.max(0.001, Math.min(0.999, dismantle.progress)),
    };
  }
  const job = resolveBuildingJobStatus(e, offlineReasons[e.id], progress);
  const queueCount = progress > 0 && progress < 1 ? 1 : 0;
  const extractorTier = resolveExtractorTierView(rawView, e.owner ?? 0, e.id, e.kind);
  return {
    entityId: e.id, kind: e.kind, kindLabel: b.label, shortCode: b.code,
    isUnit: false, isMovable: false, tier: 1, q: e.q, r: e.r, x: e.x, y: e.y,
    hp: e.hp, hpMax: e.hpMax > 0 ? e.hpMax : b.hpMax, currentJob: job, queueCount,
    footprintW: b.w, footprintD: b.d, state: e.state, progress,
    ...(extractorTier ? { extractorTier } : {}),
  };
}

/** The open dismantle job (`blobs.workJobs`, mode `dismantle`, not a helper record) of building `entityId`, if any. */
export function dismantleJobOf(rawView: unknown, entityId: number): { progress: number } | null {
  const byId = ((rawView as { blobs?: Record<string, unknown> } | null)?.blobs?.workJobs as
    { byId?: Record<string, { mode?: string; targetEntityId?: number; helpOf?: string; progress?: number }> } | undefined)?.byId;
  if (!byId) return null;
  for (const j of Object.values(byId)) {
    if (j?.mode === 'dismantle' && j.targetEntityId === entityId && j.helpOf === undefined) return { progress: Number(j.progress) || 0 };
  }
  return null;
}

/** Colony `owner`'s Units-lane entry CANCEL JOB on the Command Hub ends: the running one, else the next queued; null if none. */
export function hubUnitsLaneTaskId(rawView: unknown, owner: number): string | null {
  const queue = (viewColony(rawView, owner) as { queue?: Array<{ taskId?: string; lane?: string; state?: string }> } | undefined)?.queue;
  const lane = (queue ?? []).filter((t) => t.lane === 'units' && typeof t.taskId === 'string');
  return (lane.find((t) => t.state === 'in_progress') ?? lane[0])?.taskId ?? null;
}

/** The last failed command of unit `id` in a view, or null. */
export function unitFailureFromView(view: unknown, id: number): UnitFailureView | null {
  const units = (view as { blobs?: { units?: { byId?: Record<string, { lastFailure?: UnitFailureView | null }> } } } | null)?.blobs?.units;
  const f = units?.byId?.[String(id)]?.lastFailure;
  return f && typeof f.tick === 'number' && typeof f.code === 'string' ? f : null;
}

export function isTileNearHq(hq: HqStatusView, q: number, r: number, maxDist = 1): boolean {
  return (
    hexDistance(q, r, hq.q, hq.r) <= maxDist ||
    hexDistance(q, r, Math.round(hq.x), Math.round(hq.y)) <= maxDist
  );
}

export function extractSelectableEntities(
  rawView: unknown,
  ownerColonyIndex?: number,
  hq?: HqStatusView | null,
): Map<number, SelectedEntityView> {
  const out = new Map<number, SelectedEntityView>();
  const resolvedHq = hq === undefined ? extractHqFromView(rawView, ownerColonyIndex) : hq;
  if (resolvedHq) out.set(resolvedHq.entityId, enrichHqSelectedView(resolvedHq, rawView));
  if (!rawView || typeof rawView !== 'object') return out;
  const view = rawView as { entities?: Float32Array | ViewEntity[] | Record<string, unknown>; count?: number; blobs?: Record<string, unknown> } & Record<string, unknown>;
  const owner = ownerColonyIndex ?? resolvedHq?.owner ?? 0;
  const col = viewColony(view, owner) as Record<string, unknown> | undefined;
  const powerBlob = (view.blobs?.power as { byColony?: Record<number, { offlineReasons?: Record<number, string> }> } | undefined)?.byColony?.[owner];
  const colPower = col?.power as { offlineReasons?: Record<number, string> } | undefined;
  const offlineReasons = colPower?.offlineReasons ?? powerBlob?.offlineReasons ?? {};
  const unitsById = ((view.blobs?.units as { byId?: Record<string, { current?: unknown; queue?: unknown[] }> } | undefined)?.byId) ?? {};
  const supMap = buildSupplementalUnitMap(view);

  const addRaw = (raw: Record<string, unknown>) => {
    const id = Number(raw.id ?? raw.entityId ?? 0);
    const row = normalizeEntityRowWithSupplements(raw, supMap.get(id));
    if (ownerColonyIndex !== undefined && row.owner !== ownerColonyIndex) return;
    if (row.kind === ENTITY_KIND.hq) {
      if (resolvedHq) out.set(resolvedHq.entityId, enrichHqSelectedView(resolvedHq, rawView));
      return;
    }
    const sel = buildSelectedEntityFromRow(row, rawView, offlineReasons, unitsById);
    if (sel) out.set(sel.entityId, sel);
  };

  if (view.entities instanceof Float32Array || Array.isArray(view.entities)) {
    forEachEntity(view.entities, view.count, (e) => addRaw(e as unknown as Record<string, unknown>));
  } else if (view.entities && typeof view.entities === 'object') {
    for (const [k, v] of Object.entries(view.entities)) {
      if (v && typeof v === 'object') addRaw({ id: Number(k), ...(v as Record<string, unknown>) });
    }
  }
  for (const [id, sup] of supMap.entries()) {
    if (!out.has(id)) addRaw(sup);
  }
  return out;
}
