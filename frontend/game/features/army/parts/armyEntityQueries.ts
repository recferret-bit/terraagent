import { ENTITY_KIND, ENTITY_STATE, hexDistance, type ViewEntity } from '@terra/sim';
import { forEachEntity, type EntityRow } from '../../../store/replica/viewCodec';
import { extractHqFromView } from '../../shared/hqView';
import type { SelectionCombatSummary } from '../../landfall/HqPanel';
import type { SelectedEntityView } from '../../landfall/selection';
import {
  BLDG_META,
  COMBAT_UNIT_META,
  buildSupplementalUnitMap,
  isArmyCombatUnitKind,
  isBuildingCoveringTile,
  isFaunaOrHiveKind,
  isHiveKind,
  isSelectableCombatUnitKind,
  normalizeEntityRowWithSupplements,
} from '../../landfall/selectionHelpers';

export function collectEntitiesFromView(rawView: unknown, ownerColonyIndex: number): EntityRow[] {
  if (!rawView || typeof rawView !== 'object') return [];
  const view = rawView as { entities?: Float32Array | ViewEntity[] | Record<string, unknown>; count?: number } & Record<string, unknown>;
  const supMap = buildSupplementalUnitMap(view);
  const rowsById = new Map<number, EntityRow>();
  const addRaw = (raw: Record<string, unknown>) => {
    const id = Number(raw.id ?? raw.entityId ?? 0);
    const row = normalizeEntityRowWithSupplements(raw, supMap.get(id));
    if (row.id > 0) rowsById.set(row.id, row);
  };
  if (view.entities instanceof Float32Array || Array.isArray(view.entities)) {
    forEachEntity(view.entities, view.count, (e) => addRaw(e as unknown as Record<string, unknown>));
  } else if (view.entities && typeof view.entities === 'object') {
    for (const [k, v] of Object.entries(view.entities)) {
      if (v && typeof v === 'object') addRaw({ id: Number(k), ...(v as Record<string, unknown>) });
    }
  }
  for (const [id, sup] of supMap.entries()) {
    if (!rowsById.has(id)) addRaw(sup);
  }
  const hq = extractHqFromView(rawView, ownerColonyIndex);
  if (hq && !rowsById.has(hq.entityId)) {
    rowsById.set(hq.entityId, {
      id: hq.entityId, kind: ENTITY_KIND.hq, owner: hq.owner ?? ownerColonyIndex,
      q: hq.q, r: hq.r, x: hq.x, y: hq.y, rot: 0, hp: hq.hp, hpMax: hq.hpMax, state: ENTITY_STATE.idle, progress: 0, tier: 1,
    });
  }
  return [...rowsById.values()];
}

export function isEntityAlive(row: EntityRow): boolean {
  return row.hp > 0 && row.state !== ENTITY_STATE.descending && row.state !== ENTITY_STATE.inert;
}

export function isUnitOnTile(row: EntityRow, q: number, r: number): boolean {
  return (
    (Math.round(row.x) === q && Math.round(row.y) === r) ||
    (row.q === q && row.r === r) ||
    Math.hypot(row.x - q, row.y - r) <= 0.75 ||
    hexDistance(row.x, row.y, q, r) <= 0.85
  );
}

export function isStationaryArmedKind(kind: number): boolean {
  return kind === ENTITY_KIND.autocannon || kind === ENTITY_KIND.laserTower;
}

export function pruneAndCollectOptimisticTargets(
  entries: Map<number, { targetId: number; atMs: number }>,
  nowMs: number,
  ttlMs = 1200,
): Map<number, number> {
  const out = new Map<number, number>();
  for (const [id, entry] of entries) {
    if (nowMs - entry.atMs <= ttlMs) out.set(id, entry.targetId);
    else entries.delete(id);
  }
  return out;
}

export function resolveSelectedArmedIssuers(
  selectedArmyIds: readonly number[],
  landfallSel: SelectedEntityView | null | undefined,
): number[] {
  if (selectedArmyIds.length > 0) return [...selectedArmyIds];
  if (!landfallSel) return [];
  if (
    isArmyCombatUnitKind(landfallSel.kind) ||
    landfallSel.kind === ENTITY_KIND.hq ||
    isStationaryArmedKind(landfallSel.kind)
  ) {
    return [landfallSel.entityId];
  }
  return [];
}

export function isTargetCoveringTile(row: EntityRow, q: number, r: number): boolean {
  if (isHiveKind(row.kind)) {
    const bq = Number.isFinite(row.x) ? Math.round(row.x) : row.q;
    const br = Number.isFinite(row.y) ? Math.round(row.y) : row.r;
    return (Math.abs(q - row.q) <= 1 && Math.abs(r - row.r) <= 1) || (Math.abs(q - bq) <= 1 && Math.abs(r - br) <= 1);
  }
  const bldg = BLDG_META[row.kind];
  if (bldg) {
    return isBuildingCoveringTile(
      {
        entityId: row.id, kind: row.kind, kindLabel: bldg.label, shortCode: bldg.code,
        isUnit: false, isMovable: false, tier: 1, q: row.q, r: row.r, x: row.x, y: row.y,
        hp: row.hp, hpMax: row.hpMax, currentJob: 'online', queueCount: 0, footprintW: bldg.w, footprintD: bldg.d,
      },
      q,
      r,
    );
  }
  return isUnitOnTile(row, q, r);
}

export function findOwnCombatUnitsOnTile(
  rawView: unknown,
  owner: number,
  q: number,
  r: number,
  pickedEntityId?: number,
): EntityRow[] {
  const rows = collectEntitiesFromView(rawView, owner);
  if (typeof pickedEntityId === 'number' && pickedEntityId > 0) {
    const direct = rows.find(
      (row) => isEntityAlive(row) && row.owner === owner && row.id === pickedEntityId && isSelectableCombatUnitKind(row.kind),
    );
    if (direct) return [direct];
  }
  const armyHits = rows
    .filter((row) => isEntityAlive(row) && row.owner === owner && isArmyCombatUnitKind(row.kind) && isUnitOnTile(row, q, r))
    .sort((a, b) => Math.hypot(a.x - q, a.y - r) - Math.hypot(b.x - q, b.y - r) || a.id - b.id);
  if (armyHits.length > 0) return armyHits;
  return rows.filter(
    (row) => isEntityAlive(row) && row.owner === owner && isSelectableCombatUnitKind(row.kind) && isUnitOnTile(row, q, r),
  );
}

function unwrapViewBlob<T>(blobs: Record<string, unknown> | undefined, key: string): T | undefined {
  const raw = blobs?.[key] as { value?: unknown } | undefined;
  if (!raw || typeof raw !== 'object') return undefined;
  return ('value' in raw && raw.value !== undefined ? raw.value : raw) as T;
}

function resolveViewColonySector(colonies: unknown[] | undefined, colonyIndex: number): string | null {
  const col = colonies?.[colonyIndex] as { foundingSectorId?: unknown; sectorId?: unknown } | undefined;
  if (!col || typeof col !== 'object') return null;
  if (typeof col.foundingSectorId === 'string' && col.foundingSectorId.startsWith('sec_')) return col.foundingSectorId;
  if (typeof col.sectorId === 'string' && col.sectorId.startsWith('sec_')) return col.sectorId;
  if (typeof col.sectorId === 'number' && Number.isFinite(col.sectorId)) return `sec_${Math.floor(col.sectorId)}_0`;
  return null;
}

function isForeignColonyAttackBlocked(rawView: unknown, attackerOwner: number, targetOwner: number): boolean {
  if (attackerOwner < 0 || targetOwner < 0 || attackerOwner === targetOwner) return false;
  if (!rawView || typeof rawView !== 'object') return false;
  const v = rawView as { tick?: unknown; colonies?: unknown[]; blobs?: Record<string, unknown> };
  const tick = typeof v.tick === 'number' ? v.tick : 0;
  const combatTest = unwrapViewBlob<{ enabled?: boolean }>(v.blobs, 'combatTest');
  const pvp = unwrapViewBlob<{
    crossSectorEnabled?: boolean;
    byColony?: Record<string, { raidProtectedUntil?: number; shieldDropped?: boolean }>;
    raidProtectedUntilByColony?: Record<string, number>;
  }>(v.blobs, 'pvp');
  const diplomacy = unwrapViewBlob<{
    truces?: Record<string, {
      colonyAIndex?: number;
      colonyBIndex?: number;
      status?: string;
      cancelEffectiveTick?: number;
    }>;
  }>(v.blobs, 'diplomacy');

  if (!combatTest?.enabled) {
    const key = String(targetOwner);
    const pvpRec = pvp?.byColony?.[key];
    const colRec = v.colonies?.[targetOwner] as { raidProtectedUntil?: unknown } | undefined;
    const shieldUntil =
      pvpRec?.raidProtectedUntil ??
      pvp?.raidProtectedUntilByColony?.[key] ??
      (typeof colRec?.raidProtectedUntil === 'number' ? colRec.raidProtectedUntil : 0);
    if (pvpRec?.shieldDropped !== true && typeof shieldUntil === 'number' && shieldUntil > tick) {
      return true;
    }
  }

  if (!pvp && !diplomacy) return false;

  if (pvp && pvp.crossSectorEnabled !== true) {
    const rivalBlob = unwrapViewBlob<{ rivals?: Record<string, { colonyIndex?: number }> }>(v.blobs, 'rivalAi');
    const rivalOwners = new Set(
      Object.values(rivalBlob?.rivals ?? {})
        .map((rv) => rv?.colonyIndex)
        .filter((idx): idx is number => typeof idx === 'number'),
    );
    if (!rivalOwners.has(attackerOwner) && !rivalOwners.has(targetOwner)) {
      const secA = resolveViewColonySector(v.colonies, attackerOwner);
      const secB = resolveViewColonySector(v.colonies, targetOwner);
      if (secA && secB && secA !== secB) return true;
    }
  }

  if (diplomacy?.truces) {
    for (const t of Object.values(diplomacy.truces)) {
      const matchesPair =
        (t.colonyAIndex === attackerOwner && t.colonyBIndex === targetOwner) ||
        (t.colonyAIndex === targetOwner && t.colonyBIndex === attackerOwner);
      if (!matchesPair) continue;
      if (t.status === 'active') return true;
      if (t.status === 'cancelling' && typeof t.cancelEffectiveTick === 'number' && t.cancelEffectiveTick > tick) {
        return true;
      }
    }
  }
  return false;
}

function isHostileRow(row: EntityRow, owner: number, rawView?: unknown): boolean {
  if (!isEntityAlive(row)) return false;
  if (isFaunaOrHiveKind(row.kind)) return true;
  if (
    row.owner < 0 ||
    row.owner === owner ||
    row.kind === ENTITY_KIND.pod ||
    row.kind === ENTITY_KIND.tradeHub
  ) {
    return false;
  }
  return !isForeignColonyAttackBlocked(rawView, owner, row.owner);
}

export function findHostileOrFaunaTargetOnTile(
  rawView: unknown,
  owner: number,
  q: number,
  r: number,
  pickedEntityId?: number,
): EntityRow | null {
  const rows = collectEntitiesFromView(rawView, owner);
  if (typeof pickedEntityId === 'number' && pickedEntityId > 0) {
    const direct = rows.find((row) => row.id === pickedEntityId && isHostileRow(row, owner, rawView));
    if (direct) return direct;
  }
  const candidates = rows.filter((row) => isHostileRow(row, owner, rawView) && isTargetCoveringTile(row, q, r));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const aMobile = !isHiveKind(a.kind) && !BLDG_META[a.kind] ? 0 : 1;
    const bMobile = !isHiveKind(b.kind) && !BLDG_META[b.kind] ? 0 : 1;
    return aMobile !== bMobile ? aMobile - bMobile : Math.hypot(a.x - q, a.y - r) - Math.hypot(b.x - q, b.y - r) || a.id - b.id;
  });
  return candidates[0] ?? null;
}

export function summarizeSelectedCombatUnits(
  rawView: unknown,
  owner: number,
  selectedEntityIds: readonly number[],
): SelectionCombatSummary | null {
  if (selectedEntityIds.length === 0) return null;
  const rows = collectEntitiesFromView(rawView, owner);
  const byId = new Map(rows.map((r) => [r.id, r]));
  let totalHp = 0;
  let totalHpMax = 0;
  let matched = 0;
  const kinds = new Set<number>();
  for (const id of selectedEntityIds) {
    const r = byId.get(id);
    if (!r) continue;
    matched++;
    totalHp += r.hp;
    totalHpMax += r.hpMax;
    kinds.add(r.kind);
  }
  if (matched === 0) {
    return { count: selectedEntityIds.length };
  }
  const singleKind = kinds.size === 1 ? [...kinds][0] : undefined;
  const meta = singleKind !== undefined ? COMBAT_UNIT_META[singleKind] : undefined;
  return {
    count: selectedEntityIds.length,
    code: meta ? meta.code : 'SQD',
    title: meta ? meta.label : 'COMBAT SQUAD',
    hp: totalHp,
    hpMax: totalHpMax,
  };
}
