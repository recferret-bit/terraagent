import {
  DEPOSIT_MAX_UNITS,
  ENTITY_KIND,
  ENTITY_STATE,
  depositRemainingUnits,
  depositStageFromRichness,
  getBuildingFootprintTiles,
  hexCount,
  hexDistance,
  hexIndex,
  type ViewEntity,
} from '@terra/sim';
import { forEachEntity, type EntityRow } from '../../store/replica/viewCodec';
import { viewColony } from '../shared/colony';
import { hqJobFromStateCode, type HqStatusView } from '../shared/hqView';
import type { SelectedEntityView } from './selection';
import {
  BLDG_META,
  COMBAT_KIND_CODES,
  COMBAT_UNIT_META,
  KIND_BY_NAME,
  STATE_BY_NAME,
  isArmyCombatUnitKind,
  isFaunaOrHiveKind,
  isHiveKind,
  isSelectableCombatUnitKind,
  normalizeKindCode,
  normalizeStateCode,
} from './selectionMeta';

export {
  BLDG_META,
  COMBAT_KIND_CODES,
  COMBAT_UNIT_META,
  KIND_BY_NAME,
  STATE_BY_NAME,
  depositStageFromRichness,
  isArmyCombatUnitKind,
  isFaunaOrHiveKind,
  isHiveKind,
  isSelectableCombatUnitKind,
  normalizeKindCode,
  normalizeStateCode,
};

export interface SelectedDepositView {
  q: number;
  r: number;
  deposit: number; // 1=metals, 2=minerals, 3=oil/biomass
  /** Deposit tier (sim `depositTier` layer; 0 = legacy → 1). */
  tier: 1 | 2 | 3;
  richness: number; // 0..10000 bp
  remaining: number; // 0..500 units
  maxUnits: number; // 500
  stage: 'full' | 'half' | 'depleted';
}

function clampOpenProgress(p: unknown): number | null {
  const n = Number(p);
  return Number.isFinite(n) && n > 0 && n < 1 ? n : null;
}

function taskProgressFromEntry(t: Record<string, unknown> | null | undefined): number | null {
  if (!t || typeof t !== 'object') return null;
  const direct = clampOpenProgress(t.progress);
  if (direct !== null) return direct;
  const done = Number(t.workDone ?? t.elapsedTicks ?? 0);
  const total = Number(t.buildTicks ?? t.workRequired ?? t.requiredTicks ?? t.totalTicks ?? 0);
  if (total > 0 && done > 0 && done < total) return done / total;
  return null;
}

function lookupHarvesterOrUnitProgress(rawView: Record<string, unknown>, id: number): number | null {
  const key = String(id);
  const harvs = rawView.harvesters as Record<string, unknown> | unknown[] | undefined;
  if (Array.isArray(harvs)) {
    const h = harvs.find((x) => x && typeof x === 'object' && ((x as { id?: number }).id === id || (x as { entityId?: number }).entityId === id)) as Record<string, unknown> | undefined;
    const p = taskProgressFromEntry(h);
    if (p !== null) return p;
  } else if (harvs && typeof harvs === 'object') {
    const p = taskProgressFromEntry((harvs[id] ?? harvs[key]) as Record<string, unknown> | undefined);
    if (p !== null) return p;
  }
  const units = rawView.units as Record<string, unknown> | unknown[] | undefined;
  if (Array.isArray(units)) {
    const u = units.find((x) => x && typeof x === 'object' && ((x as { id?: number }).id === id || (x as { entityId?: number }).entityId === id)) as Record<string, unknown> | undefined;
    const p = taskProgressFromEntry(u);
    if (p !== null) return p;
  } else if (units && typeof units === 'object') {
    const byId = (units.byId ?? units) as Record<string, unknown>;
    const p = taskProgressFromEntry((byId[id] ?? byId[key]) as Record<string, unknown> | undefined);
    if (p !== null) return p;
  }
  const blobs = rawView.blobs as Record<string, unknown> | undefined;
  const blobUnit = ((blobs?.units as { byId?: Record<string, Record<string, unknown>> } | undefined)?.byId)?.[key];
  const buProg = taskProgressFromEntry(blobUnit);
  if (buProg !== null) return buProg;
  const harvAssign = ((blobs?.harvest as { assignments?: Record<string, Record<string, unknown>> } | undefined)?.assignments)?.[key];
  return taskProgressFromEntry(harvAssign);
}

function resolveWorkerQueueOrTerraformProgress(
  e: { id: number; q: number; r: number; x: number; y: number; state?: number; owner?: number },
  rawView: Record<string, unknown>,
  col: Record<string, unknown> | undefined,
): number | null {
  const qTasks = (rawView.queue as { tasks?: Array<Record<string, unknown>> } | undefined)?.tasks;
  if (Array.isArray(qTasks)) {
    for (const t of qTasks) {
      if (t.status === 'active' || t.state === 'in_progress') {
        const p = taskProgressFromEntry(t);
        if (p !== null) return p;
      }
    }
  }
  const tfActive = (rawView.terraform as { active?: Record<string, unknown> } | undefined)?.active;
  const tfProg = taskProgressFromEntry(tfActive);
  if (tfProg !== null) return tfProg;

  const isWorking = e.state === ENTITY_STATE.working || e.state === ENTITY_STATE.constructing || e.state === ENTITY_STATE.harvesting;
  const blobs = rawView.blobs as Record<string, unknown> | undefined;
  const colQueue = (col?.constructionQueue ?? col?.queue ?? blobs?.queue) as Array<Record<string, unknown>> | undefined;
  if (isWorking && Array.isArray(colQueue)) {
    for (const t of colQueue) {
      if ((t.lane === 'buildings' || !t.lane) && (t.state === 'in_progress' || t.status === 'active')) {
        const p = taskProgressFromEntry(t);
        if (p !== null) return p;
      }
    }
  }
  const tfQueue = blobs?.terraformQueue as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(tfQueue)) {
    for (const op of tfQueue) {
      const p = taskProgressFromEntry(op);
      if (p !== null && (isWorking || hexDistance(Math.round(e.x), Math.round(e.y), Number(op.q ?? e.q), Number(op.r ?? e.r)) <= 3)) {
        return p;
      }
    }
  }
  let nearBldgProg: number | null = null;
  const ents = rawView.entities as Float32Array | ViewEntity[] | undefined;
  forEachEntity(ents, rawView.count as number | undefined, (b) => {
    if (nearBldgProg !== null || b.id === e.id) return;
    if (b.state === ENTITY_STATE.constructing && b.progress > 0 && b.progress < 1) {
      const d = hexDistance(Math.round(e.x), Math.round(e.y), b.q, b.r);
      if (isWorking || d <= 4) nearBldgProg = b.progress;
    }
  });
  return nearBldgProg;
}

export function resolveEntityActivityProgress(
  e: { id: number; kind: number | string; q: number; r: number; x: number; y: number; state?: number; progress?: number; owner?: number },
  rawView: unknown,
): number {
  const direct = clampOpenProgress(e.progress);
  if (direct !== null) return direct;
  if (!rawView || typeof rawView !== 'object') return 0;
  const v = rawView as Record<string, unknown>;
  const kind = normalizeKindCode(e.kind);
  const unitProg = lookupHarvesterOrUnitProgress(v, e.id);
  if (unitProg !== null) return unitProg;

  const col = viewColony(v, e.owner ?? 0) as Record<string, unknown> | undefined;
  if (kind === ENTITY_KIND.hq || kind === ENTITY_KIND.harvester || kind === ENTITY_KIND.builder) {
    const wp = resolveWorkerQueueOrTerraformProgress(e, v, col);
    if (wp !== null) return wp;
  }
  if (kind === ENTITY_KIND.commandHub) {
    const hubActive = (v.hubQueue as { active?: Record<string, unknown> } | undefined)?.active;
    const hp = taskProgressFromEntry(hubActive);
    if (hp !== null) return hp;
    const blobs = v.blobs as Record<string, unknown> | undefined;
    const uQueue = (col?.unitQueue ?? col?.queue ?? blobs?.queue) as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(uQueue)) {
      for (const t of uQueue) {
        if ((t.lane === 'units' || !t.lane) && (t.state === 'in_progress' || t.status === 'active')) {
          const p = taskProgressFromEntry(t);
          if (p !== null) return p;
        }
      }
    }
  }
  return 0;
}

export function resolveTileIndex(tiles: Record<string, unknown>, planetRadius: number | undefined, q: number, r: number): number {
  if (typeof (tiles as { indexOf?: unknown }).indexOf === 'function') {
    return (tiles as { indexOf(q: number, r: number): number }).indexOf(q, r);
  }
  const width = typeof tiles.width === 'number' ? tiles.width : undefined;
  const height = typeof tiles.height === 'number' ? tiles.height : undefined;
  if (width !== undefined && height !== undefined) {
    if (q < 0 || r < 0 || q >= width || r >= height) return -1;
    return r * width + q;
  }
  let radius = typeof tiles.radius === 'number' ? tiles.radius : planetRadius;
  const count = typeof tiles.count === 'number' ? tiles.count : (tiles.deposit as ArrayLike<number> | undefined)?.length;
  if (radius === undefined && typeof count === 'number' && count > 0) {
    const guessed = Math.round((-3 + Math.sqrt(9 + 12 * (count - 1))) / 6);
    if (guessed >= 0 && hexCount(guessed) === count) radius = guessed;
  }
  if (typeof radius === 'number' && radius >= 0) {
    return hexIndex(radius).indexOf(q, r);
  }
  return -1;
}

export function inspectDepositAt(
  rawView: unknown,
  fallbackTiles: unknown,
  q: number,
  r: number,
  prevDepositKind?: number,
): SelectedDepositView | null {
  const v = (rawView && typeof rawView === 'object' ? rawView : {}) as Record<string, unknown>;
  const tiles = (v.tiles ?? fallbackTiles) as Record<string, unknown> | undefined;
  if (!tiles || typeof tiles !== 'object') return null;
  const planetRadius = (v.planet as { radius?: number } | undefined)?.radius;
  const idx = resolveTileIndex(tiles, planetRadius, q, r);
  if (idx < 0) return null;
  const depArr = tiles.deposit as ArrayLike<number> | undefined;
  const rawDep = Number(depArr?.[idx] ?? 0);
  const deposit = rawDep > 0 ? rawDep : (prevDepositKind ?? 0);
  if (deposit <= 0) return null;

  const richArr = tiles.richness as ArrayLike<number> | undefined;
  const rawRich = richArr !== undefined ? Number(richArr[idx] ?? 0) : (rawDep > 0 ? 10000 : 0);
  const richness = rawDep <= 0 ? 0 : Math.max(0, Math.min(10000, Math.round(rawRich)));
  const maxUnits = DEPOSIT_MAX_UNITS;
  const remaining = depositRemainingUnits(richness);
  const stage = depositStageFromRichness(richness);
  const rawTier = Number((tiles.depositTier as ArrayLike<number> | undefined)?.[idx] ?? 0);
  const tier: 1 | 2 | 3 = rawTier === 2 || rawTier === 3 ? rawTier : 1;
  return { q, r, deposit, tier, richness, remaining, maxUnits, stage };
}

export function isBuildingCoveringTile(e: SelectedEntityView, q: number, r: number): boolean {
  const w = e.footprintW ?? 1;
  const d = e.footprintD ?? 1;
  const bq = Number.isFinite(e.x) ? Math.round(e.x) : e.q;
  const br = Number.isFinite(e.y) ? Math.round(e.y) : e.r;
  // 2×2: the sim's footprint (`getBuildingFootprintTiles`, anchor + offsets 0..1), 4 tiles, never the 3 west / north ones
  if (w === 2 && d === 2) return getBuildingFootprintTiles(e.q, e.r, 2).some((p) => p.q === q && p.r === r);
  const minW = -Math.floor((w - 1) / 2);
  const minD = -Math.floor((d - 1) / 2);
  const inRound = q >= bq + minW && q < bq + minW + w && r >= br + minD && r < br + minD + d;
  const inGrid = q >= e.q + minW && q < e.q + minW + w && r >= e.r + minD && r < e.r + minD + d;
  return inRound || inGrid;
}

export function buildSupplementalUnitMap(rawView: Record<string, unknown>): Map<number, Record<string, unknown>> {
  const map = new Map<number, Record<string, unknown>>();
  const mergeRec = (idVal: unknown, rec: unknown) => {
    if (!rec || typeof rec !== 'object') return;
    const r = rec as Record<string, unknown>;
    const id = Number(idVal ?? r.id ?? r.entityId);
    if (!Number.isFinite(id) || id <= 0) return;
    const prev = map.get(id) ?? {};
    map.set(id, {
      ...prev,
      ...r,
      id,
      kind: prev.kind ?? r.kind,
      x: r.x ?? r.q ?? prev.x ?? prev.q,
      y: r.y ?? r.r ?? prev.y ?? prev.r,
      q: r.q ?? (typeof r.x === 'number' ? Math.round(r.x) : prev.q),
      r: r.r ?? (typeof r.y === 'number' ? Math.round(r.y) : prev.r),
      progress: r.progress ?? prev.progress,
      state: r.state ?? prev.state,
    });
  };
  const units = rawView.units as Record<string, unknown> | unknown[] | undefined;
  if (Array.isArray(units)) {
    for (const u of units) mergeRec(undefined, u);
  } else if (units && typeof units === 'object') {
    const byId = (units.byId && typeof units.byId === 'object' ? units.byId : units) as Record<string, unknown>;
    for (const [k, u] of Object.entries(byId)) mergeRec(k, u);
  }
  const harvs = rawView.harvesters as Record<string, unknown> | unknown[] | undefined;
  if (Array.isArray(harvs)) {
    for (const h of harvs) mergeRec(undefined, h);
  } else if (harvs && typeof harvs === 'object') {
    for (const [k, h] of Object.entries(harvs)) mergeRec(k, h);
  }
  return map;
}

export function normalizeEntityRowWithSupplements(
  raw: Partial<EntityRow> & Record<string, unknown>,
  sup: Record<string, unknown> | undefined,
): EntityRow {
  const id = Number(raw.id ?? raw.entityId ?? sup?.id ?? 0);
  const kind = normalizeKindCode(raw.kind) || normalizeKindCode(sup?.kind) || ENTITY_KIND.harvester;
  const rx = raw.x ?? raw.q ?? sup?.x ?? sup?.q ?? 0;
  const ry = raw.y ?? raw.r ?? sup?.y ?? sup?.r ?? 0;
  const x = Number.isFinite(Number(rx)) ? Number(rx) : 0;
  const y = Number.isFinite(Number(ry)) ? Number(ry) : 0;
  const q = Number.isFinite(Number(raw.q)) ? Number(raw.q) : (Number.isFinite(Number(sup?.q)) ? Number(sup?.q) : Math.round(x));
  const r = Number.isFinite(Number(raw.r)) ? Number(raw.r) : (Number.isFinite(Number(sup?.r)) ? Number(sup?.r) : Math.round(y));
  const state = raw.state !== undefined ? normalizeStateCode(raw.state) : normalizeStateCode(sup?.state);
  const progress = clampOpenProgress(raw.progress) ?? clampOpenProgress(sup?.progress) ?? Number(raw.progress ?? sup?.progress ?? 0);
  const defaultHpMax =
    kind === ENTITY_KIND.hq
      ? 900
      : (COMBAT_UNIT_META[kind]?.hpMax ?? BLDG_META[kind]?.hpMax ?? ( isHiveKind(kind) ? 1500 : 160 ));
  const rawHpMax = Number(raw.hpMax ?? sup?.hpMax ?? 0);
  const hpMax = rawHpMax > 0 ? rawHpMax : defaultHpMax;
  const rawHp = raw.hp ?? sup?.hp;
  const hp = rawHp !== undefined && Number.isFinite(Number(rawHp)) ? Number(rawHp) : hpMax;
  const rawOwner = raw.owner ?? sup?.owner;
  const owner = rawOwner !== undefined && Number.isFinite(Number(rawOwner)) ? Number(rawOwner) : (isFaunaOrHiveKind(kind) ? -1 : 0);
  return {
    id,
    kind,
    owner,
    q,
    r,
    x,
    y,
    rot: Number(raw.rot ?? 0),
    hp,
    hpMax,
    state,
    progress,
  };
}

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

export function enrichHqSelectedView(hq: HqStatusView, rawView: unknown): SelectedEntityView {
  const progress = resolveEntityActivityProgress(
    { id: hq.entityId, kind: ENTITY_KIND.hq, q: hq.q, r: hq.r, x: hq.x, y: hq.y, owner: hq.owner },
    rawView,
  );
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
  if (e.kind === ENTITY_KIND.harvester || e.kind === ENTITY_KIND.builder) {
    const isBuilder = e.kind === ENTITY_KIND.builder;
    const job =
      e.state === ENTITY_STATE.moving ? 'moving'
      : e.state === ENTITY_STATE.harvesting ? 'harvesting'
      : e.state === ENTITY_STATE.repairing ? 'repairing'
      : e.state === ENTITY_STATE.constructing ? 'constructing'
      : e.state === ENTITY_STATE.working ? 'working'
      : e.state === ENTITY_STATE.offlineBrownout ? 'offline: brownout'
      : progress > 0 && progress < 1 ? (isBuilder ? 'working' : 'harvesting')
      : 'idle';
    const uRec = unitsById[String(e.id)];
    const queueCount = uRec ? (uRec.current ? 1 : 0) + (Array.isArray(uRec.queue) ? uRec.queue.length : 0) : (job === 'idle' ? 0 : 1);
    return {
      entityId: e.id, kind: e.kind,
      kindLabel: isBuilder ? 'BUILDER DRONE' : 'HARVESTER DRONE',
      shortCode: isBuilder ? 'BLD' : 'HRV',
      isUnit: true, isMovable: true, tier: 1, q: e.q, r: e.r, x: e.x, y: e.y,
      hp: e.hp, hpMax: e.hpMax > 0 ? e.hpMax : (isBuilder ? 150 : 160), currentJob: job, queueCount,
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
  const reason = offlineReasons[e.id];
  const dismantle = dismantleJobOf(rawView, e.id);
  if (dismantle) {
    // Coming down (owner feedback W03 #6): a site again, its progress is the dismantle job's (0 → 100 %).
    return {
      entityId: e.id, kind: e.kind, kindLabel: b.label, shortCode: b.code,
      isUnit: false, isMovable: false, tier: 1, q: e.q, r: e.r, x: e.x, y: e.y,
      hp: e.hp, hpMax: e.hpMax > 0 ? e.hpMax : b.hpMax, currentJob: 'dismantling', queueCount: 1,
      footprintW: b.w, footprintD: b.d, state: e.state, progress: Math.max(0.001, Math.min(0.999, dismantle.progress)),
    };
  }
  const job = reason
    ? reason
    : e.state === ENTITY_STATE.constructing ? 'constructing'
    : e.state === ENTITY_STATE.waiting ? 'waiting'
    : e.state === ENTITY_STATE.offlineBrownout ? 'offline: brownout'
    : e.state === ENTITY_STATE.offlineUnpowered ? 'offline: unpowered'
    : e.state === ENTITY_STATE.offlineCapped ? 'offline: capped'
    : e.state === ENTITY_STATE.offlineNoFuel ? 'offline: no fuel'
    : e.state === ENTITY_STATE.offlineNoGrid ? 'offline: no grid'
    : e.state === ENTITY_STATE.offlineOverload ? 'offline: overload'
    : e.kind === ENTITY_KIND.pod ? 'landed'
    : progress > 0 && progress < 1 ? 'working' : 'online';
  const queueCount = progress > 0 && progress < 1 ? 1 : 0;
  return {
    entityId: e.id, kind: e.kind, kindLabel: b.label, shortCode: b.code,
    isUnit: false, isMovable: false, tier: 1, q: e.q, r: e.r, x: e.x, y: e.y,
    hp: e.hp, hpMax: e.hpMax > 0 ? e.hpMax : b.hpMax, currentJob: job, queueCount,
    footprintW: b.w, footprintD: b.d, state: e.state, progress,
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
