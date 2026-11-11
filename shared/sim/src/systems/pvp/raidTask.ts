import { compileData } from '../../data';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { rowOf } from '../../ecs/store';
import { hexIndex } from '../../grid/hex';
import { ensureColonyRecord } from '../../kernel/colonies';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import { seedStream } from '../../kernel/rng';
import { setBlob, type PlanetState } from '../../kernel/state';
import { isUnitReserved, UnitBook } from '../../units/book';
import { mobileStats } from '../../units/mobility';
import { getUnitStanceRecord } from '../combat/stances';
import { resolveAttackerWeaponRow } from '../combat/targeting';
import { hasActiveTruce, recordHostilityBetween } from '../diplomacy/store';
import { isWorker } from '../harvest/unit';
import { updateColonyVisionCache } from '../combat/vision';
import { recordLaunchedRaid, stepRaidTargetGoal } from './parts/raidGoalExecutor';
import { orderRaidGroupFlowMarch } from './raidFlowMarch';
import { selectSpottedRaidTarget } from './raidPathing';
import { canRaidTargetSector } from './sectorGuard';
import { dropColonyShield, isColonyRaidProtected } from './shield';
import type { ActiveRaidGroupState } from './store';

export { stepRaidTargetGoal };

export const UNIT_GROUPS_BLOB_KEY = 'unitGroups';

export interface UnitGroupsBlobState {
  byColony: Record<string, Record<number, number[]>>;
  byEntityId: Record<number, number>;
}

export interface LaunchRaidOptions {
  unitIds?: readonly number[];
  q?: number;
  r?: number;
  groupId?: number;
  onlyIdle?: boolean;
  data?: CompiledDataLike;
}

export type LaunchRaidResult =
  | { ok: true; raid: ActiveRaidGroupState }
  | {
      ok: false;
      code: 'invalid_args' | 'cross_sector_disabled' | 'truce_active' | 'raid_protected';
    };

const W18_FALLBACK_FLAGS = new Set([
  'W00', 'W01', 'W02', 'W03', 'W04', 'W05', 'W06', 'W07', 'W08', 'W18',
]);
let cachedW18FallbackData: CompiledDataLike | null = null;

function ensureStepCtx(state: PlanetState, tick: number, ctx?: StepContext, data?: CompiledDataLike): StepContext {
  if (ctx) return ctx;
  if (!cachedW18FallbackData) cachedW18FallbackData = compileData(W18_FALLBACK_FLAGS);
  return {
    dt: 1,
    tick,
    flags: W18_FALLBACK_FLAGS,
    data: data ?? cachedW18FallbackData,
    rng: (s) => seedStream(String(state.meta.seed), `${s}:${tick}`),
    newEntityId: () => state.meta.nextEntityId++,
    emit: () => {},
    events: [],
    record: () => {},
    postings: [],
  };
}

/** Returns `true` when `row` is a living mobile armed combat unit (excluding HQ and workers). */
export function isRaidCombatUnitRow(
  state: PlanetState,
  row: number,
  data?: CompiledDataLike,
): boolean {
  if (row < 0 || row >= state.entities.count) return false;
  const cols = state.entities.cols;
  if (cols.hp[row]! <= 0) return false;
  const st = cols.state[row]!;
  if (
    st === ENTITY_STATE.constructing ||
    st === ENTITY_STATE.inert ||
    st === ENTITY_STATE.descending
  ) {
    return false;
  }
  const kind = cols.kind[row]!;
  if (kind === ENTITY_KIND.hq || isWorker(kind)) return false;
  const id = cols.id[row]!;
  if (isUnitReserved(state, id)) return false;
  if (kind === ENTITY_KIND.recon || kind === ENTITY_KIND.demoTank || kind === ENTITY_KIND.demoArtillery) {
    return true;
  }
  return (
    Boolean(data && mobileStats(kind, data) !== null) &&
    resolveAttackerWeaponRow(state, row, data) !== undefined
  );
}

/**
 * Selects combat units of `colonyIndex` for a raid (`W18-02`).
 * Prefers idle combat units (`ENTITY_STATE.idle` or without an active attack-move / explicit target);
 * falls back to all living combat units of `colonyIndex` unless `opts?.onlyIdle === true`.
 */
export function selectColonyRaidUnits(
  state: PlanetState,
  colonyIndex: number,
  opts?: { unitIds?: readonly number[]; onlyIdle?: boolean; data?: CompiledDataLike },
): number[] {
  const cols = state.entities.cols;
  if (opts?.unitIds && opts.unitIds.length > 0) {
    const explicit: number[] = [];
    for (const id of opts.unitIds) {
      const row = rowOf(state.entities, id);
      if (row >= 0 && cols.owner[row] === colonyIndex && isRaidCombatUnitRow(state, row, opts.data)) {
        explicit.push(id);
      }
    }
    return [...new Set(explicit)].sort((a, b) => a - b);
  }

  const idleIds: number[] = [];
  const allIds: number[] = [];
  for (let row = 0; row < state.entities.count; row++) {
    if (cols.owner[row] !== colonyIndex) continue;
    if (!isRaidCombatUnitRow(state, row, opts?.data)) continue;
    const id = cols.id[row]!;
    allIds.push(id);
    const stanceRec = getUnitStanceRecord(state, row);
    const uRec = new UnitBook(state).peek(id);
    const hasBusyOrder =
      Boolean(stanceRec.attackMoveGoal) ||
      Boolean(stanceRec.explicitTargetId) ||
      (uRec?.current?.kind === 'move' && uRec.current.source === 'player');
    if (cols.state[row] === ENTITY_STATE.idle || !hasBusyOrder) {
      idleIds.push(id);
    }
  }

  idleIds.sort((a, b) => a - b);
  allIds.sort((a, b) => a - b);
  if (idleIds.length > 0 || opts?.onlyIdle === true) return idleIds;
  return allIds;
}

/** Returns the assigned control/army group ID (`1..9`) for `entityId`, or `null` if unassigned. */
export function getUnitGroupId(state: PlanetState, entityId: number): number | null {
  const raw = state.blobs[UNIT_GROUPS_BLOB_KEY]?.value as Partial<UnitGroupsBlobState> | undefined;
  const fromGroups = raw?.byEntityId?.[entityId];
  if (typeof fromGroups === 'number' && fromGroups > 0) return fromGroups;
  const uRec = new UnitBook(state).peek(entityId) as (Record<string, unknown> | null);
  if (typeof uRec?.groupId === 'number' && uRec.groupId > 0) return uRec.groupId;
  return null;
}

/** Assigns `unitIds` of `colonyIndex` to an army group (`1..9`) in `unitGroups`, `UnitBook`, and `col.units`. */
export function assignRaidArmyGroup(
  state: PlanetState,
  colonyIndex: number,
  unitIds: readonly number[],
  preferredGroupId?: number,
  tick = state.meta.tick,
): number {
  const raw = state.blobs[UNIT_GROUPS_BLOB_KEY]?.value as Partial<UnitGroupsBlobState> | undefined;
  const byColony: Record<string, Record<number, number[]>> = raw?.byColony ? { ...raw.byColony } : {};
  const byEntityId: Record<number, number> = raw?.byEntityId ? { ...raw.byEntityId } : {};
  const colKey = String(colonyIndex);
  const colGroups: Record<number, number[]> = byColony[colKey] ? { ...byColony[colKey] } : {};

  const groupId =
    typeof preferredGroupId === 'number' && preferredGroupId >= 1 && preferredGroupId <= 9
      ? Math.floor(preferredGroupId)
      : 1;

  colGroups[groupId] = [...unitIds];
  byColony[colKey] = colGroups;
  for (const id of unitIds) {
    byEntityId[id] = groupId;
  }
  setBlob(state, UNIT_GROUPS_BLOB_KEY, { byColony, byEntityId }, tick);

  const book = new UnitBook(state);
  for (const id of unitIds) {
    const rec = book.get(id) as unknown as Record<string, unknown>;
    rec.groupId = groupId;
  }
  if (unitIds.length > 0) {
    book.touch(true);
    book.flush(tick);
  }

  const col = ensureColonyRecord(state, colonyIndex, tick);
  col.raidGroupId = groupId;
  if (Array.isArray(col.units)) {
    const idSet = new Set(unitIds);
    col.units = col.units.map((u) => {
      if (u && typeof u === 'object' && idSet.has((u as { entityId?: number }).entityId ?? -1)) {
        return { ...(u as Record<string, unknown>), groupId };
      }
      return u;
    });
  }
  col.changedAt = tick;
  return groupId;
}

function computeRaiderOrigin(state: PlanetState, colonyIndex: number, unitIds: readonly number[]): { q: number; r: number } {
  const cols = state.entities.cols;
  if (unitIds.length > 0) {
    let sumQ = 0;
    let sumR = 0;
    let cnt = 0;
    for (const id of unitIds) {
      const r = rowOf(state.entities, id);
      if (r >= 0) {
        sumQ += cols.q[r]!;
        sumR += cols.r[r]!;
        cnt++;
      }
    }
    if (cnt > 0) return { q: Math.round(sumQ / cnt), r: Math.round(sumR / cnt) };
  }
  for (let r = 0; r < state.entities.count; r++) {
    if (cols.owner[r] !== colonyIndex || cols.hp[r]! <= 0) continue;
    if (cols.kind[r] === ENTITY_KIND.commandHub || cols.kind[r] === ENTITY_KIND.hq) {
      return { q: cols.q[r]!, r: cols.r[r]! };
    }
  }
  return { q: 0, r: 0 };
}

/** Resolves the target hex `(q, r)` and target entity ID in `targetColony` for a raid (`W18-02`, `W18-04`). */
export function resolveRaidTargetDestination(
  state: PlanetState,
  attackerColony: number,
  targetColony: number,
  unitIds: readonly number[] = [],
  explicit?: { q?: number; r?: number; data?: CompiledDataLike },
): { q: number; r: number; targetEntityId: number | null } {
  const idx = hexIndex(state.grid.radius);
  if (
    typeof explicit?.q === 'number' &&
    typeof explicit?.r === 'number' &&
    idx.indexOf(explicit.q, explicit.r) >= 0
  ) {
    return { q: explicit.q, r: explicit.r, targetEntityId: null };
  }

  updateColonyVisionCache(state, state.meta.tick, explicit?.data, true);
  const origin = computeRaiderOrigin(state, attackerColony, unitIds);
  const sel = selectSpottedRaidTarget(state, attackerColony, targetColony, origin.q, origin.r, {
    data: explicit?.data,
  });
  return {
    q: sel.q,
    r: sel.r,
    targetEntityId: sel.targetEntityId,
  };
}

/**
 * Validates and launches a PvP raid from `attackerColony` against `targetColony` (`W18-02`).
 * - Enforces sector, truce, and newcomer shield gates.
 * - Drops attacker's newcomer shield and records hostility.
 * - Selects idle combat units, assigns them a group ID, orders them toward `targetColony`, and emits `raidStarted`.
 */
export function launchColonyRaid(
  state: PlanetState,
  attackerColony: number,
  targetColony: number,
  ctx?: StepContext,
  opts?: LaunchRaidOptions,
): LaunchRaidResult {
  const tick = ctx?.tick ?? state.meta.tick;
  const data = opts?.data ?? ctx?.data;
  if (
    targetColony < 0 ||
    attackerColony < 0 ||
    targetColony === attackerColony ||
    !state.colonies[targetColony]
  ) {
    return { ok: false, code: 'invalid_args' };
  }
  if (!canRaidTargetSector(state, attackerColony, targetColony).ok) {
    return { ok: false, code: 'cross_sector_disabled' };
  }
  if (hasActiveTruce(state, attackerColony, targetColony, tick)) {
    return { ok: false, code: 'truce_active' };
  }
  if (isColonyRaidProtected(state, targetColony, tick, data)) {
    return { ok: false, code: 'raid_protected' };
  }

  dropColonyShield(state, attackerColony, tick, data);
  recordHostilityBetween(state, attackerColony, targetColony, tick);

  const unitIds = selectColonyRaidUnits(state, attackerColony, {
    unitIds: opts?.unitIds,
    onlyIdle: opts?.onlyIdle,
    data,
  });
  const groupId = assignRaidArmyGroup(state, attackerColony, unitIds, opts?.groupId, tick);
  const dest = resolveRaidTargetDestination(state, attackerColony, targetColony, unitIds, {
    q: opts?.q,
    r: opts?.r,
    data,
  });

  const stepCtx = ensureStepCtx(state, tick, ctx, data);
  orderRaidGroupFlowMarch(state, unitIds, { q: dest.q, r: dest.r }, stepCtx, 'together');
  const raid = recordLaunchedRaid(state, attackerColony, targetColony, unitIds, groupId, dest, tick, ctx);
  return { ok: true, raid };
}
