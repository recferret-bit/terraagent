import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { isLiveClearNest, readBounty, writeBounty, type BountyRecord } from './blob';
import { clearNestWindowTicks, resolveClearNests } from './resolve';

/**
 * One hive hit from `applyDamage` (the HP formula stays there).
 * Hits are kept only while a clear_nest bounty on that nest is open or claimed,
 * so a hive fight with no bounty does not grow `blobs.bounty` (GP-119).
 */
export function noteClearNestHit(
  state: PlanetState,
  nestId: number,
  applied: number,
  destroyed: boolean,
  tick: number,
  attackerOwner: number,
  ctx: StepContext | undefined,
): void {
  if (!ctx?.flags.has('W22')) return;
  const id = String(nestId);
  if (!nestIsTracked(state, id)) return;
  if (attackerOwner >= 0 && applied > 0) recordNestHit(state, id, attackerOwner, applied, tick, ctx);
  if (destroyed) resolveClearNests(state, id, tick, ctx);
}

function nestIsTracked(state: PlanetState, nestId: string): boolean {
  return readBounty(state).bounties.some((bounty) => isLiveClearNest(bounty, nestId));
}

function liveNestIds(bounties: readonly BountyRecord[]): Set<string> {
  const ids = new Set<string>();
  for (const bounty of bounties) {
    if (bounty.target.kind !== 'clear_nest') continue;
    if (isLiveClearNest(bounty, bounty.target.nestId)) ids.add(bounty.target.nestId);
  }
  return ids;
}

function recordNestHit(state: PlanetState, nestId: string, colony: number, amount: number, tick: number, ctx: StepContext): void {
  const window = clearNestWindowTicks(ctx);
  const blob = readBounty(state);
  const live = liveNestIds(blob.bounties);
  blob.damage = blob.damage.filter((hit) => tick - hit.tick <= window && live.has(hit.nestId));
  blob.damage.push({ nestId, colony, amount, tick });
  writeBounty(state, blob, tick);
}
