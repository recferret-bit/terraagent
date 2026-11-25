import { ENTITY_KIND, ENTITY_STATE, type ViewEntity } from '@terra/sim';
import { forEachEntity, type EntityRow } from '../../../store/replica/viewCodec';
import { extractHqFromView } from '../../shared/hqView';
import type { SelectionCombatSummary } from '../../landfall/HqPanel';
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
  return (Math.round(row.x) === q && Math.round(row.y) === r) || (row.q === q && row.r === r) || Math.hypot(row.x - q, row.y - r) <= 0.75;
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

export function findOwnCombatUnitsOnTile(rawView: unknown, owner: number, q: number, r: number): EntityRow[] {
  const rows = collectEntitiesFromView(rawView, owner);
  const armyHits = rows
    .filter((row) => isEntityAlive(row) && row.owner === owner && isArmyCombatUnitKind(row.kind) && isUnitOnTile(row, q, r))
    .sort((a, b) => Math.hypot(a.x - q, a.y - r) - Math.hypot(b.x - q, b.y - r) || a.id - b.id);
  if (armyHits.length > 0) return armyHits;
  return rows.filter(
    (row) => isEntityAlive(row) && row.owner === owner && isSelectableCombatUnitKind(row.kind) && isUnitOnTile(row, q, r),
  );
}

export function findHostileOrFaunaTargetOnTile(rawView: unknown, owner: number, q: number, r: number): EntityRow | null {
  const rows = collectEntitiesFromView(rawView, owner);
  const candidates = rows.filter((row) => {
    if (!isEntityAlive(row) || !isTargetCoveringTile(row, q, r)) return false;
    if (isFaunaOrHiveKind(row.kind)) return true;
    return (
      row.owner >= 0 &&
      row.owner !== owner &&
      row.kind !== ENTITY_KIND.pod &&
      row.kind !== ENTITY_KIND.tradeHub
    );
  });
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
