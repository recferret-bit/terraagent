import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import type { CompiledDataLike } from '../../kernel/config';
import type { PlanetState } from '../../kernel/state';
import {
  ensureColonyCargoCapState,
  getRollingThroughputUsed,
  getTradeHubTierThroughputPerMin,
} from './caps';

export interface TradeHubEntityStatus {
  entityId: number;
  row: number;
  tier: number;
  online: boolean;
  state: number;
  throughputCapPerMin: number;
  throughputUsedPerMin: number;
}

export interface ColonyTradeHubStatus {
  hubCount: number;
  onlineCount: number;
  anyOnline: boolean;
  highestTier: number;
  onlineHighestTier: number;
  throughputCapPerMin: number;
  throughputUsedPerMin: number;
  hubs: TradeHubEntityStatus[];
}

/**
 * Returns `true` iff entity row `row` is an alive, powered, non-shed Trade Hub (`ENTITY_STATE.active`).
 * Under-construction (`constructing`), brownout-shed (`offlineBrownout`), unpowered (`offlineUnpowered`),
 * or dead (`hp <= 0`) Trade Hubs are offline (`false`).
 */
export function isTradeHubEntityOnline(state: PlanetState, row: number): boolean {
  if (row < 0 || row >= state.entities.count) return false;
  const cols = state.entities.cols;
  return (
    cols.kind[row] === ENTITY_KIND.tradeHub &&
    cols.hp[row] > 0 &&
    cols.state[row] === ENTITY_STATE.active
  );
}

/** Alias for {@link isTradeHubEntityOnline}. */
export const isTradeHubOnline = isTradeHubEntityOnline;

/**
 * Computes the Trade Hub online status, tier summary, and rolling 60 s throughput meter for `colonyIndex`.
 */
export function getColonyTradeHubStatus(
  state: PlanetState,
  colonyIndex: number,
  data?: CompiledDataLike,
  currentTick: number = state.meta.tick,
): ColonyTradeHubStatus {
  const colony = state.colonies[colonyIndex];
  const throughputUsedPerMin = colony
    ? getRollingThroughputUsed(ensureColonyCargoCapState(colony), currentTick)
    : 0;

  const e = state.entities;
  const cols = e.cols;
  const hubs: TradeHubEntityStatus[] = [];
  let hubCount = 0;
  let onlineCount = 0;
  let highestTier = 0;
  let onlineHighestTier = 0;
  let throughputCapPerMin = 0;

  for (let row = 0; row < e.count; row++) {
    if (cols.owner[row] !== colonyIndex || cols.kind[row] !== ENTITY_KIND.tradeHub || cols.hp[row] <= 0) {
      continue;
    }
    hubCount++;
    const rawTier = cols.tier?.[row] || 1;
    const tier = rawTier >= 3 ? 3 : rawTier >= 2 ? 2 : 1;
    if (tier > highestTier) highestTier = tier;

    const online = isTradeHubEntityOnline(state, row);
    const hubCap = online ? getTradeHubTierThroughputPerMin(tier, data) : 0;
    if (online) {
      onlineCount++;
      if (tier > onlineHighestTier) onlineHighestTier = tier;
      throughputCapPerMin += hubCap;
    }

    hubs.push({
      entityId: cols.id[row],
      row,
      tier,
      online,
      state: cols.state[row],
      throughputCapPerMin: hubCap,
      throughputUsedPerMin,
    });
  }

  return {
    hubCount,
    onlineCount,
    anyOnline: onlineCount > 0,
    highestTier,
    onlineHighestTier,
    throughputCapPerMin,
    throughputUsedPerMin,
    hubs,
  };
}
