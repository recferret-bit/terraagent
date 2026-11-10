import type { BountyPostArgs } from '@terra/contracts';
import { dataRow } from '../../data';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { hexDistance } from '../../grid/hex';
import { TICKS_PER_SECOND } from '../../kernel/constants';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { defineSystem } from '../../kernel/system';
import { mercenaryAlliedTo } from '../mercenary/blob';
import { rowNum } from '../rows';
import {
  bountyAudience,
  bountyColonyId,
  isDefendBounty,
  isOpenBounty,
  readBounty,
  writeBounty,
  type BountyRecord,
  type DefendBounty,
} from './blob';
import { emitBountyRefund } from './resolve';

/** One design hour. Tick is 200 ms, so `round(durationH * TICKS_PER_HOUR)` is the window length (W22-21). */
const TICKS_PER_HOUR = TICKS_PER_SECOND * 60 * 60;

/** Tier-1 combat units: recon, and the robot.combat stand-ins (demo tank and artillery). Workers do not count. */
const COMBAT_KINDS: ReadonlySet<number> = new Set([ENTITY_KIND.recon, ENTITY_KIND.demoTank, ENTITY_KIND.demoArtillery]);

export function defendAreaRecord(colony: number, id: string, args: BountyPostArgs, tick: number): BountyRecord | 'invalid_args' {
  const target = args.target;
  if (target.kind !== 'defend_area') return 'invalid_args';
  const durationTicks = Math.round(target.durationH * TICKS_PER_HOUR);
  if (durationTicks < 1) return 'invalid_args';
  return {
    id,
    poster: colony,
    target: { kind: 'defend_area', q: target.q, r: target.r, radius: target.radius, durationH: target.durationH },
    claimers: [],
    state: 'open',
    reward: { resource: args.reward.resource, amount: args.reward.amount },
    expiresAt: args.expiresAt,
    startTick: tick,
    endTick: tick + durationTicks,
    presentTicks: 0,
  };
}

/** Slot 11 runs after combat, so a building lost on the closing tick refunds before this resolves the window. */
export function stepDefendAreas(state: PlanetState, ctx: StepContext): void {
  const blob = readBounty(state);
  if (!blob.bounties.some(isRunningDefend)) return;
  let changed = false;
  for (const bounty of blob.bounties) {
    if (!isRunningDefend(bounty)) continue;
    if (creditPresence(state, bounty, ctx)) changed = true;
    if (ctx.tick < bounty.endTick) continue;
    settleDefend(state, ctx, bounty);
    changed = true;
  }
  if (changed) writeBounty(state, blob, ctx.tick);
}

/**
 * A poster building whose anchor tile is inside a still-open defend area.
 * Refunds immediately. Hives are not buildings; this is only called from building destruction.
 */
export function noteDefendBuildingLost(
  state: PlanetState,
  owner: number,
  q: number,
  r: number,
  tick: number,
  ctx: StepContext | undefined,
): void {
  if (!ctx?.flags.has('W22') || owner < 0) return;
  const blob = readBounty(state);
  let changed = false;
  for (const bounty of blob.bounties) {
    if (!isRunningDefend(bounty) || bounty.poster !== owner) continue;
    if (hexDistance(q, r, bounty.target.q, bounty.target.r) > bounty.target.radius) continue;
    bounty.state = 'refunded';
    emitBountyRefund(state, ctx, bounty, 'building_lost');
    changed = true;
  }
  if (changed) writeBounty(state, blob, tick);
}

export const defendAreaSystem = defineSystem({
  id: 'bounty.defend',
  slot: 11,
  wave: 'W22',
  run: stepDefendAreas,
});

function isRunningDefend(bounty: BountyRecord): bounty is DefendBounty {
  return isOpenBounty(bounty) && isDefendBounty(bounty);
}

function creditPresence(state: PlanetState, bounty: DefendBounty, ctx: StepContext): boolean {
  const ticks = presenceTicksInStep(bounty, ctx, claimerPresent(state, bounty));
  if (ticks <= 0) return false;
  bounty.presentTicks += ticks;
  return true;
}

/** Ticks of this step inside `[startTick, endTick)`. One sample covers a coarse `dt` (the pose is only known now). */
function presenceTicksInStep(bounty: DefendBounty, ctx: StepContext, present: boolean): number {
  if (!present || bounty.state !== 'claimed') return 0;
  const from = Math.max(bounty.startTick, ctx.tick - ctx.dt + 1);
  const to = Math.min(bounty.endTick - 1, ctx.tick);
  return to >= from ? to - from + 1 : 0;
}

function claimerPresent(state: PlanetState, bounty: DefendBounty): boolean {
  const claimer = bounty.claimers[0];
  if (claimer === undefined) return false;
  const cols = state.entities.cols;
  for (let row = 0; row < state.entities.count; row++) {
    if (!isLivingCombat(cols.kind[row]!, cols.hp[row]!, cols.state[row]!)) continue;
    const owned = cols.owner[row] === claimer;
    const hired = mercenaryAlliedTo(state, cols.id[row]!, bounty.poster);
    if (!owned && !hired) continue;
    if (hexDistance(cols.q[row]!, cols.r[row]!, bounty.target.q, bounty.target.r) <= bounty.target.radius) return true;
  }
  return false;
}

function isLivingCombat(kind: number, hp: number, unitState: number): boolean {
  if (hp <= 0 || !COMBAT_KINDS.has(kind)) return false;
  return unitState !== ENTITY_STATE.constructing && unitState !== ENTITY_STATE.inert && unitState !== ENTITY_STATE.descending;
}

function settleDefend(state: PlanetState, ctx: StepContext, bounty: DefendBounty): void {
  const duration = bounty.endTick - bounty.startTick;
  const minBp = rowNum(dataRow(ctx.data, 'bounty', 'defend_area'), 'presenceMinBp');
  const claimer = bounty.claimers[0];
  if (claimer !== undefined && bounty.presentTicks * 10000 >= duration * minBp) {
    completeDefend(state, ctx, bounty, claimer);
    return;
  }
  bounty.state = 'refunded';
  emitBountyRefund(state, ctx, bounty, 'failed');
}

function completeDefend(state: PlanetState, ctx: StepContext, bounty: DefendBounty, claimer: number): void {
  bounty.state = 'completed';
  const claimerId = bountyColonyId(state, claimer);
  ctx.emit({
    kind: 'bountyCompleted',
    colonyIds: bountyAudience(claimerId, bountyColonyId(state, bounty.poster)),
    data: { bountyId: bounty.id, claimer: claimerId, kind: 'defend_area' },
  });
}
