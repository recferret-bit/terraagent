import type { ActorKind, PriceBoardRow } from '@terra/contracts';
import { excludeOutliers, type BoardLimits, type BoardTrade } from '@terra/sim/systems/trade/market-board';

/** A FINAL trade with the actor kinds of its two sides (the pure board model does not carry them). */
export interface ActorTrade extends BoardTrade {
  readonly buyerKind: string;
  readonly sellerKind: string;
}

/**
 * `botShareBp` and `actorMix` of one pair over the board window. Eligible volume is the board's own (organic trades without
 * price outliers, the same `excludeOutliers` the sim uses), so `botShareBp` is bot volume / `eligibleVolume`. `actorMix`
 * counts every FINAL trade of the window once per actor kind present on its sides.
 */
export function actorStats(pair: string, trades: readonly ActorTrade[], nowMs: number, limits: BoardLimits): Pick<PriceBoardRow, 'botShareBp' | 'actorMix'> {
  const inWindow = trades.filter((t) => t.pair === pair && t.amount > 0n && t.atMs > nowMs - limits.windowS * 1000 && t.atMs <= nowMs);
  const mix: Partial<Record<ActorKind, number>> = {};
  for (const t of inWindow) for (const k of new Set([t.buyerKind, t.sellerKind])) mix[k as ActorKind] = (mix[k as ActorKind] ?? 0) + 1;
  const { kept } = excludeOutliers(inWindow.filter((t) => t.organic), limits.maxMoveBp);
  const keptSet = new Set<BoardTrade>(kept);
  let total = 0n;
  let bot = 0n;
  for (const t of inWindow) {
    if (!keptSet.has(t)) continue;
    total += t.amount;
    if (t.buyerKind === 'bot' || t.sellerKind === 'bot') bot += t.amount;
  }
  return { botShareBp: total === 0n ? 0 : Number((bot * 10_000n) / total), actorMix: mix };
}
