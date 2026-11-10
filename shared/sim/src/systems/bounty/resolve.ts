import type { BountyRefundReason } from '@terra/contracts';
import { dataRow } from '../../data';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { rowNum } from '../rows';
import { bountyAudience, bountyColonyId, isLiveClearNest, readBounty, writeBounty, type BountyRecord, type NestDamageHit } from './blob';

/** `clear_nest.damageWindowTicks` (raw ticks, not compiled from seconds). */
export function clearNestWindowTicks(ctx: StepContext): number {
  return rowNum(dataRow(ctx.data, 'bounty', 'clear_nest'), 'damageWindowTicks');
}

/**
 * Nest `nestId` (the hive entity id as a string) is gone.
 * A hit counts when `tick - hit.tick <= damageWindowTicks` (exactly 60 s still counts).
 * The greatest sum wins. Equal sums go to the lower colony index (GP-118).
 * That colony completes the bounty only when it is a claimer and not the poster.
 */
export function resolveClearNests(state: PlanetState, nestId: string, tick: number, ctx: StepContext): void {
  const window = clearNestWindowTicks(ctx);
  const blob = readBounty(state);
  const totals = damageTotals(blob.damage, nestId, tick, window);
  let changed = false;
  for (const bounty of blob.bounties) {
    if (!isLiveClearNest(bounty, nestId)) continue;
    settle(state, ctx, bounty, totals);
    changed = true;
  }
  const damage = blob.damage.filter((hit) => hit.nestId !== nestId && tick - hit.tick <= window);
  if (!changed && damage.length === blob.damage.length) return;
  blob.damage = damage;
  writeBounty(state, blob, tick);
}

function settle(state: PlanetState, ctx: StepContext, bounty: BountyRecord, totals: ReadonlyMap<number, number>): void {
  const top = topDamageColony(totals);
  if (top !== null && top !== bounty.poster && bounty.claimers.includes(top)) {
    bounty.state = 'completed';
    const claimer = bountyColonyId(state, top);
    ctx.emit({
      kind: 'bountyCompleted',
      colonyIds: bountyAudience(claimer, bountyColonyId(state, bounty.poster)),
      data: { bountyId: bounty.id, claimer, kind: 'clear_nest' },
    });
    return;
  }
  bounty.state = 'refunded';
  emitBountyRefund(state, ctx, bounty, top === bounty.poster ? 'cancelled' : 'failed');
}

export function emitBountyRefund(state: PlanetState, ctx: StepContext, bounty: BountyRecord, reason: BountyRefundReason): void {
  const posterId = bountyColonyId(state, bounty.poster);
  ctx.emit({
    kind: 'bountyRefunded',
    severity: 'warn',
    colonyIds: [posterId],
    data: {
      bountyId: bounty.id,
      posterId,
      resource: bounty.reward.resource,
      amount: bounty.reward.amount,
      reason,
    },
  });
}

/** Sum of in-window hits. A hit at `tick - window` still counts; older hits do not. */
function damageTotals(hits: readonly NestDamageHit[], nestId: string, tick: number, window: number): Map<number, number> {
  const totals = new Map<number, number>();
  for (const hit of hits) {
    if (hit.nestId !== nestId || tick - hit.tick > window) continue;
    totals.set(hit.colony, (totals.get(hit.colony) ?? 0) + hit.amount);
  }
  return totals;
}

/** Greatest damage. Ties: the lower colony index (GP-118). */
function topDamageColony(totals: ReadonlyMap<number, number>): number | null {
  let best: number | null = null;
  let bestAmount = 0;
  for (const [colony, amount] of totals) {
    if (amount <= 0) continue;
    if (best === null || amount > bestAmount || (amount === bestAmount && colony < best)) {
      best = colony;
      bestAmount = amount;
    }
  }
  return best;
}
