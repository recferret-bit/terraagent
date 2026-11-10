import { defineCommandHandler, type SimCommand } from '../../kernel/commands';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { commandColony, parseArgs } from '../command';
import { bountyAudience, bountyColonyId, readBounty, writeBounty, type BountyRecord } from './blob';

/** Module sources only. Clients are already refused (`origin: 'module'`). */
const MODULE_SOURCES: ReadonlySet<string> = new Set(['system', 'near', 'admin', 'dev']);

export const bountyPostHandler = defineCommandHandler({
  kind: 'bounty.post',
  wave: 'W22',
  handle: postBounty,
});

export const bountyClaimHandler = defineCommandHandler({
  kind: 'bounty.claim',
  wave: 'W22',
  handle: claimBounty,
});

export const bountyPaidHandler = defineCommandHandler({
  kind: 'bounty.paid',
  wave: 'W22',
  handle: markBountyPaid,
});

function postBounty(state: PlanetState, cmd: SimCommand, ctx: StepContext): string | void {
  const colony = commandColony(cmd);
  if (colony === 'not_own_colony') return colony;
  const args = parseArgs('bounty.post', cmd.args);
  if (!args || args.target.kind !== 'clear_nest') return 'invalid_args';
  const id = `bt:${colony}:${ctx.tick}`;
  const blob = readBounty(state);
  if (blob.bounties.some((bounty) => bounty.id === id)) return 'already_posted';
  const posterId = bountyColonyId(state, colony);
  blob.bounties.push({
    id,
    poster: colony,
    target: { kind: 'clear_nest', nestId: args.target.nestId },
    claimers: [],
    state: 'open',
    reward: { resource: args.reward.resource, amount: args.reward.amount },
    expiresAt: args.expiresAt,
  });
  writeBounty(state, blob, ctx.tick);
  ctx.emit({
    kind: 'bountyPosted',
    colonyIds: [posterId],
    data: { bountyId: id, posterId, target: args.target, reward: args.reward, expiresAt: args.expiresAt },
  });
}

function claimBounty(state: PlanetState, cmd: SimCommand, ctx: StepContext): string | void {
  const colony = commandColony(cmd);
  if (colony === 'not_own_colony') return colony;
  const args = parseArgs('bounty.claim', cmd.args);
  if (!args) return 'invalid_args';
  const blob = readBounty(state);
  const bounty = blob.bounties.find((row) => row.id === args.bountyId);
  if (!bounty || !isOpen(bounty)) return 'unknown_entity';
  if (bounty.claimers.includes(colony)) return;
  bounty.claimers.push(colony);
  bounty.state = 'claimed';
  writeBounty(state, blob, ctx.tick);
  const claimer = bountyColonyId(state, colony);
  ctx.emit({
    kind: 'bountyClaimed',
    colonyIds: bountyAudience(claimer, bountyColonyId(state, bounty.poster)),
    data: { bountyId: bounty.id, claimer, kind: 'clear_nest' },
  });
}

/** Marks `completed` → `paid`. The amount is accepted and not applied: escrow pays outside the sim (W22-23). */
function markBountyPaid(state: PlanetState, cmd: SimCommand, ctx: StepContext): string | void {
  const args = parseArgs('bounty.paid', cmd.args);
  if (!args) return 'invalid_args';
  if (!MODULE_SOURCES.has(cmd.source)) return 'not_authorized';
  const blob = readBounty(state);
  const bounty = blob.bounties.find((row) => row.id === args.bountyId);
  if (!bounty) return 'unknown_entity';
  if (bounty.state !== 'completed') return;
  bounty.state = 'paid';
  writeBounty(state, blob, ctx.tick);
}

function isOpen(bounty: BountyRecord): boolean {
  return bounty.state === 'open' || bounty.state === 'claimed';
}
