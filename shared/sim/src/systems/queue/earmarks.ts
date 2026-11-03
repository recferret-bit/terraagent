import {
  RESOURCE_FAMILY_OF,
  type ResourceFamily,
  type ResourceKey,
} from '@terra/contracts';
import { ENTITY_STATE } from '../../ecs/columns';
import { rowOf } from '../../ecs/store';
import type { CompiledDataLike } from '../../kernel/config';
import type { ColonyState, PlanetState } from '../../kernel/state';
import type { BuildingJobRecord } from '../economy/construction';
import { checkCostAffordability, ensureColonyLedger } from '../economy/ledger';
import { ensureColony } from './cancel';
import { PRECEDENCE_RANK, type QueueEntry } from './types';

export const DEFAULT_EARMARK_AFTER_TICKS = 300;
export const DEFAULT_EARMARK_CAP_RATIO = 0.8;

export function resolveEarmarkConfig(data?: CompiledDataLike): { earmarkAfterTicks: number; earmarkCapRatio: number } {
  const tables = data?.tables as
    | Record<string, Record<string, { earmarkAfterS?: number; designEarmarkAfterS?: number; earmarkCapRatio?: number }> | undefined>
    | undefined;
  const qCfg = tables?.grid?.queueConfig;
  let earmarkAfterTicks = DEFAULT_EARMARK_AFTER_TICKS;
  if (typeof qCfg?.earmarkAfterS === 'number' && qCfg.earmarkAfterS > 0) {
    earmarkAfterTicks =
      qCfg.designEarmarkAfterS === qCfg.earmarkAfterS ? Math.round(qCfg.earmarkAfterS * 5) : Math.round(qCfg.earmarkAfterS);
  }
  const earmarkCapRatio =
    typeof qCfg?.earmarkCapRatio === 'number' && qCfg.earmarkCapRatio > 0 && qCfg.earmarkCapRatio <= 1
      ? qCfg.earmarkCapRatio
      : DEFAULT_EARMARK_CAP_RATIO;
  return { earmarkAfterTicks, earmarkCapRatio };
}

export function hasActiveEarmark(entry: QueueEntry): boolean {
  if (!entry.earmarked) return false;
  return Object.values(entry.earmarked).some((v) => (v ?? 0) > 0);
}

/**
 * Compares two entries by earmark starvation priority: oldest `resourceWaitSinceTick` first,
 * then higher `PRECEDENCE_RANK`, then oldest `createdAt`.
 */
export function compareEarmarkPriority(a: QueueEntry, b: QueueEntry): number {
  const aSince = a.resourceWaitSinceTick ?? a.createdAt;
  const bSince = b.resourceWaitSinceTick ?? b.createdAt;
  if (aSince !== bSince) return aSince - bSince;
  const rankDiff = PRECEDENCE_RANK[b.precedence] - PRECEDENCE_RANK[a.precedence];
  if (rankDiff !== 0) return rankDiff;
  return a.createdAt - b.createdAt;
}

/**
 * Updates `entry.earmarked` on all waiting entries of `colonyIndex` that have been resource-starved
 * for `>= earmarkAfterTicks` (60 s = 300 ticks), ordered oldest-blocked first and clamped so total earmarks
 * per resource family never exceed `80 %` of the family storage cap (`UO-D-02`).
 * Entries in `waiting(storage)` never earmark.
 */
export function updateColonyEarmarks(
  state: PlanetState,
  entries: QueueEntry[],
  colonyIndex: number,
  tick: number,
  data?: CompiledDataLike,
): Partial<Record<ResourceKey, number>> {
  const colony = ensureColonyLedger(ensureColony(state, colonyIndex, tick));
  const { earmarkAfterTicks, earmarkCapRatio } = resolveEarmarkConfig(data);

  const familyMaxEarmark: Record<ResourceFamily, number> = {
    metals: Math.floor((colony.caps.metals ?? 500) * earmarkCapRatio),
    minerals: Math.floor((colony.caps.minerals ?? 500) * earmarkCapRatio),
    bio: Math.floor((colony.caps.bio ?? 500) * earmarkCapRatio),
  };
  const familyUsedEarmark: Record<ResourceFamily, number> = { metals: 0, minerals: 0, bio: 0 };
  const claimedStock: Partial<Record<ResourceKey, number>> = {};
  const colonyEarmarks: Partial<Record<ResourceKey, number>> = {};

  const starved: QueueEntry[] = [];
  for (const entry of entries) {
    if (entry.colonyIndex !== colonyIndex) continue;
    if (entry.state !== 'waiting' || entry.waitReason !== 'resources') {
      entry.earmarked = undefined;
      if (entry.state !== 'waiting') entry.resourceWaitSinceTick = undefined;
      continue;
    }
    const afford = checkCostAffordability(colony, entry.totalCost ?? entry.cost);
    if (Object.keys(afford.exceedsCap).length > 0) {
      entry.earmarked = undefined;
      entry.resourceWaitSinceTick = undefined;
      continue;
    }
    const waitSince = entry.resourceWaitSinceTick ?? tick;
    entry.resourceWaitSinceTick = waitSince;
    if (tick - waitSince >= earmarkAfterTicks) {
      starved.push(entry);
    } else {
      entry.earmarked = undefined;
    }
  }

  starved.sort(compareEarmarkPriority);

  for (const entry of starved) {
    const totalCost = entry.totalCost ?? entry.cost;
    const spentCost = entry.spentCost ?? {};
    const prevEarmarked = entry.earmarked ?? {};
    const nextEarmarked: Partial<Record<ResourceKey, number>> = {};

    for (const [k, v] of Object.entries(totalCost) as [ResourceKey, number][]) {
      if (!v || v <= 0) continue;
      const needed = Math.max(0, v - (spentCost[k] ?? 0));
      if (needed <= 0) continue;
      const family = RESOURCE_FAMILY_OF[k];
      const remBudget = Math.max(0, familyMaxEarmark[family] - familyUsedEarmark[family]);
      if (remBudget <= 0) continue;

      const unreservedHave = Math.max(0, (colony.stock[k] ?? 0) - (claimedStock[k] ?? 0));
      const currentShortfall = Math.max(0, needed - unreservedHave);
      const lockedShortfall =
        typeof prevEarmarked[k] === 'number' && prevEarmarked[k]! > 0
          ? prevEarmarked[k]!
          : currentShortfall;
      const earmarkedAmt = Math.min(remBudget, lockedShortfall);
      if (earmarkedAmt > 0) {
        nextEarmarked[k] = earmarkedAmt;
        familyUsedEarmark[family] += earmarkedAmt;
        colonyEarmarks[k] = (colonyEarmarks[k] ?? 0) + earmarkedAmt;
      }
      claimedStock[k] = (claimedStock[k] ?? 0) + Math.min(needed, familyMaxEarmark[family]);
    }

    entry.earmarked = Object.keys(nextEarmarked).length > 0 ? nextEarmarked : undefined;
  }

  (colony as ColonyState & { earmarks?: Partial<Record<ResourceKey, number>> }).earmarks = colonyEarmarks;
  return colonyEarmarks;
}

/**
 * Adds stock commitments from older earmarked entries so later entries can only spend stock above the earmark (`UO-D-02`).
 */
export function addEarmarkedCommitments(
  colony: ColonyState,
  entry: QueueEntry,
  allEntries: readonly QueueEntry[],
  committed: Partial<Record<ResourceKey, number>>,
  data?: CompiledDataLike,
): void {
  const c = ensureColonyLedger(colony);
  const { earmarkCapRatio } = resolveEarmarkConfig(data);
  const familyRemCap: Record<ResourceFamily, number> = {
    metals: Math.floor((c.caps.metals ?? 500) * earmarkCapRatio),
    minerals: Math.floor((c.caps.minerals ?? 500) * earmarkCapRatio),
    bio: Math.floor((c.caps.bio ?? 500) * earmarkCapRatio),
  };

  const earmarkedEntries = allEntries
    .filter(
      (other) =>
        other.colonyIndex === entry.colonyIndex &&
        other.state === 'waiting' &&
        other.waitReason === 'resources' &&
        hasActiveEarmark(other),
    )
    .sort(compareEarmarkPriority);

  const entryHasEarmark = hasActiveEarmark(entry);
  for (const other of earmarkedEntries) {
    if (other.taskId === entry.taskId) break;
    if (entryHasEarmark && compareEarmarkPriority(entry, other) < 0) break;

    const oTotal = other.totalCost ?? other.cost;
    const oSpent = other.spentCost ?? {};
    for (const [k, v] of Object.entries(oTotal) as [ResourceKey, number][]) {
      if (!v || v <= 0) continue;
      if (!(other.earmarked?.[k] && other.earmarked[k]! > 0)) continue;
      const needed = Math.max(0, v - (oSpent[k] ?? 0));
      const family = RESOURCE_FAMILY_OF[k];
      const reserve = Math.min(needed, familyRemCap[family]);
      if (reserve > 0) {
        committed[k] = (committed[k] ?? 0) + reserve;
        familyRemCap[family] = Math.max(0, familyRemCap[family] - reserve);
      }
    }
  }
}

export function checkStartMissing(
  state: PlanetState,
  colony: ColonyState,
  entry: QueueEntry,
  allEntries: QueueEntry[],
  data?: CompiledDataLike,
): Partial<Record<ResourceKey, number>> | null {
  const totalCost = entry.totalCost ?? entry.cost;
  const spentCost = entry.spentCost ?? {};
  const stock = (colony.stock ?? {}) as Partial<Record<ResourceKey, number>>;
  const committed: Partial<Record<ResourceKey, number>> = {};
  const jobs = (state.blobs.construction?.value as { jobs?: Record<number, BuildingJobRecord> } | undefined)?.jobs ?? {};

  for (const other of allEntries) {
    if (other.colonyIndex !== entry.colonyIndex || other.state !== 'in_progress' || other.taskId === entry.taskId) continue;
    if (other.entityId !== undefined) {
      const eRow = rowOf(state.entities, other.entityId);
      if (eRow < 0 || state.entities.cols.state[eRow] !== ENTITY_STATE.constructing) continue;
    }
    const oTotal = other.totalCost ?? other.cost;
    const oSpent = (other.entityId !== undefined ? jobs[other.entityId]?.spentCost : undefined) ?? other.spentCost ?? {};
    for (const [k, v] of Object.entries(oTotal) as [ResourceKey, number][]) {
      if (!v || v <= 0) continue;
      const rem = Math.max(0, v - (oSpent[k] ?? 0));
      if (rem > 0) committed[k] = (committed[k] ?? 0) + rem;
    }
  }

  addEarmarkedCommitments(colony, entry, allEntries, committed, data);

  const missing: Partial<Record<ResourceKey, number>> = {};
  let short = false;
  for (const [k, v] of Object.entries(totalCost) as [ResourceKey, number][]) {
    if (!v || v <= 0) continue;
    const needed = Math.max(0, v - (spentCost[k] ?? 0));
    const avail = Math.max(0, (stock[k] ?? 0) - (committed[k] ?? 0));
    if (avail + 1e-6 < needed) {
      missing[k] = needed - avail;
      short = true;
    }
  }
  return short ? missing : null;
}
