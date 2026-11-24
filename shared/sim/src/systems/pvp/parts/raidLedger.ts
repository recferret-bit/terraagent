import type { PlanetState } from '../../../kernel/state';
import {
  getPvpState,
  peekPvpState,
  savePvpState,
  type ActiveRaidGroupState,
  type PvpBlobState,
} from '../store';

/**
 * Open-raid ledger invariants (`pvp.activeRaids`):
 * - one open raid per raider unit: a new launch supersedes every open raid sharing a unit;
 * - a raid against an eliminated colony is closed.
 * Superseded / closed raids are dropped silently (no `raidRepelled`).
 */

/** Launch sequence of a raid id (`raid_<attacker>_<target>_<seq>`), `-1` when absent. */
export function raidLaunchSeq(raidId: string): number {
  const m = /_(\d+)$/.exec(raidId);
  return m ? Number(m[1]) : -1;
}

function isColonyGone(state: PlanetState, colonyIndex: number): boolean {
  const col = state.colonies[colonyIndex];
  return !col || col.status === 'eliminated';
}

/** Deletes (in place) every raid of `activeRaids` that shares a unit with `unitIds`; returns the dropped ids. */
export function dropRaidsSharingUnits(
  activeRaids: Record<string, ActiveRaidGroupState>,
  unitIds: readonly number[],
): string[] {
  if (unitIds.length === 0) return [];
  const units = new Set(unitIds);
  const dropped: string[] = [];
  for (const raidId in activeRaids) {
    const raid = activeRaids[raidId];
    if (raid && raid.unitIds.some((id) => units.has(id))) dropped.push(raidId);
  }
  for (const raidId of dropped) delete activeRaids[raidId];
  return dropped;
}

/** Newest-first raid ids (launch sequence, then insertion order). */
function raidIdsNewestFirst(activeRaids: Readonly<Record<string, unknown>>): string[] {
  const ids = Object.keys(activeRaids);
  const order = new Map(ids.map((id, i) => [id, i]));
  return ids.sort((a, b) => raidLaunchSeq(b) - raidLaunchSeq(a) || order.get(b)! - order.get(a)!);
}

/** Ids of raids to drop: superseded by a newer raid sharing a unit, or aimed at an eliminated colony. */
export function findStaleRaidIds(
  state: PlanetState,
  activeRaids: Readonly<Record<string, Readonly<ActiveRaidGroupState>>>,
): string[] {
  const stale: string[] = [];
  const claimed = new Set<number>();
  for (const raidId of raidIdsNewestFirst(activeRaids)) {
    const raid = activeRaids[raidId];
    if (!raid) continue;
    if (isColonyGone(state, raid.targetColony) || raid.unitIds.some((id) => claimed.has(id))) {
      stale.push(raidId);
      continue;
    }
    for (const id of raid.unitIds) claimed.add(id);
  }
  return stale;
}

/** Re-points each attacker's `activeRaidId` at its newest surviving raid when its raid was dropped. */
function repointColonyRaids(pvpState: PvpBlobState, dropped: ReadonlySet<string>): void {
  const newestByAttacker = new Map<number, ActiveRaidGroupState>();
  for (const raidId of raidIdsNewestFirst(pvpState.activeRaids)) {
    const raid = pvpState.activeRaids[raidId]!;
    if (!newestByAttacker.has(raid.attackerColony)) newestByAttacker.set(raid.attackerColony, raid);
  }
  for (const [key, rec] of Object.entries(pvpState.byColony)) {
    if (!rec?.activeRaidId || !dropped.has(rec.activeRaidId)) continue;
    const next = newestByAttacker.get(rec.colonyIndex);
    pvpState.byColony[key] = {
      ...rec,
      activeRaidId: next?.raidId ?? null,
      activeRaidTargetColony: next?.targetColony ?? null,
      raidGroupId: next?.groupId ?? null,
      raiderUnitIds: next ? [...next.unitIds] : [],
    };
  }
}

/**
 * Self-heal for the open-raid ledger (run every PvP tick; a no-op without writes once the ledger is clean):
 * keeps only the newest raid per raider unit and closes raids against eliminated colonies. Emits no events.
 */
export function healActiveRaids(state: PlanetState, tick: number = state.meta.tick): number {
  const stale = findStaleRaidIds(state, peekPvpState(state).activeRaids);
  if (stale.length === 0) return 0;
  const pvpState = getPvpState(state);
  for (const raidId of stale) delete pvpState.activeRaids[raidId];
  repointColonyRaids(pvpState, new Set(stale));
  savePvpState(state, pvpState, tick);
  return stale.length;
}

/** Newest open raid (toward a live colony) that includes any of `unitIds`. */
export function findOpenRaidWithUnits(
  state: PlanetState,
  unitIds: readonly number[],
): Readonly<ActiveRaidGroupState> | undefined {
  if (unitIds.length === 0) return undefined;
  const units = new Set(unitIds);
  const activeRaids = peekPvpState(state).activeRaids;
  let best: Readonly<ActiveRaidGroupState> | undefined;
  for (const raidId in activeRaids) {
    const raid = activeRaids[raidId];
    if (!raid || raid.repelled || isColonyGone(state, raid.targetColony)) continue;
    if (!raid.unitIds.some((id) => units.has(id))) continue;
    if (!best || raidLaunchSeq(raidId) >= raidLaunchSeq(best.raidId)) best = raid;
  }
  return best;
}

/** Newest open (not repelled) raid of `attackerColony` against a live colony, optionally only toward `targetColony`. */
export function findOpenRaidOf(
  state: PlanetState,
  attackerColony: number,
  targetColony?: number,
): Readonly<ActiveRaidGroupState> | undefined {
  const activeRaids = peekPvpState(state).activeRaids;
  let best: Readonly<ActiveRaidGroupState> | undefined;
  let bestSeq = -Infinity;
  for (const raidId in activeRaids) {
    const raid = activeRaids[raidId];
    if (!raid || raid.repelled || raid.attackerColony !== attackerColony) continue;
    if (targetColony !== undefined && raid.targetColony !== targetColony) continue;
    if (isColonyGone(state, raid.targetColony)) continue;
    const seq = raidLaunchSeq(raidId);
    if (seq >= bestSeq) {
      best = raid;
      bestSeq = seq;
    }
  }
  return best;
}
