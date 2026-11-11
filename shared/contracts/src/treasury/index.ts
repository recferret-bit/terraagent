import { z } from 'zod';

/**
 * Planet treasury (F7, W22-01, NEAR-100..102).
 * Project kinds and the module command `system.treasuryEffect` share this schema.
 * Balance numbers live in `shared/sim/src/data/treasury.ts` (D-35), not here.
 */

export const TREASURY_EFFECT_KINDS = ['meteor_shield', 'terraform_boost', 'guild_subsidy'] as const;
export const TreasuryEffectKind = z.enum(TREASURY_EFFECT_KINDS);
export type TreasuryEffectKind = z.infer<typeof TreasuryEffectKind>;

export const TREASURY_PROPOSAL_STATES = ['InProgress', 'Approved', 'Rejected', 'Expired'] as const;
export const TreasuryProposalState = z.enum(TREASURY_PROPOSAL_STATES);
export type TreasuryProposalState = z.infer<typeof TreasuryProposalState>;

export const TreasuryVoteChoice = z.enum(['approve', 'reject', 'remove']);
export type TreasuryVoteChoice = z.infer<typeof TreasuryVoteChoice>;

/** Whole token units as a decimal string (PR-04). */
const WholeUnits = z.string().regex(/^(0|[1-9]\d*)$/);

export const TreasuryEffectParams = z.strictObject({
  /** Basis points: 7500 = hazard rate −75 %, 2500 = Living-op cost −25 %. */
  magnitudeBp: z.number().int().min(0).max(10_000).optional(),
  /** Extra Orbital Guild visits (`guild_subsidy`). */
  visits: z.number().int().positive().max(8).optional(),
});
export type TreasuryEffectParams = z.infer<typeof TreasuryEffectParams>;

export const SystemTreasuryEffectArgsSchema = z.strictObject({
  kind: TreasuryEffectKind,
  params: TreasuryEffectParams.optional(),
  untilTick: z.number().int().nonnegative(),
});
export type SystemTreasuryEffectArgs = z.infer<typeof SystemTreasuryEffectArgsSchema>;

const proposalHead = {
  planetId: z.string().min(1).max(80),
  daoAccountId: z.string().min(2).max(64),
  proposalId: z.number().int().nonnegative(),
  kind: TreasuryEffectKind,
};

export const TreasuryProposalCreatedData = z.strictObject({
  ...proposalHead,
  proposer: z.string().min(1).max(80),
  cost: WholeUnits,
  deadlineMs: z.number().int().nonnegative(),
});
export type TreasuryProposalCreatedData = z.infer<typeof TreasuryProposalCreatedData>;

export const TreasuryVoteCastData = z.strictObject({
  planetId: proposalHead.planetId,
  daoAccountId: proposalHead.daoAccountId,
  proposalId: proposalHead.proposalId,
  voter: z.string().min(1).max(80),
  vote: TreasuryVoteChoice,
  yes: z.number().int().nonnegative(),
  no: z.number().int().nonnegative(),
});
export type TreasuryVoteCastData = z.infer<typeof TreasuryVoteCastData>;

export const TreasuryProposalPassedData = z.strictObject({
  ...proposalHead,
  cost: WholeUnits,
});
export type TreasuryProposalPassedData = z.infer<typeof TreasuryProposalPassedData>;

export const TreasuryProposalFailedData = z.strictObject({
  ...proposalHead,
  reason: z.enum(['rejected', 'expired']),
});
export type TreasuryProposalFailedData = z.infer<typeof TreasuryProposalFailedData>;

export const TreasuryEffectStartedData = z.strictObject({
  planetId: proposalHead.planetId,
  kind: TreasuryEffectKind,
  untilTick: z.number().int().nonnegative(),
  magnitudeBp: z.number().int().min(0).max(10_000).optional(),
  visits: z.number().int().positive().max(8).optional(),
});
export type TreasuryEffectStartedData = z.infer<typeof TreasuryEffectStartedData>;

export const TreasuryEffectEndedData = z.strictObject({
  planetId: proposalHead.planetId,
  kind: TreasuryEffectKind,
  atTick: z.number().int().nonnegative(),
});
export type TreasuryEffectEndedData = z.infer<typeof TreasuryEffectEndedData>;

/** Live council row (PROTOCOL F7 push `treasury.proposal`). */
export const TreasuryProposalPush = z.strictObject({
  ...proposalHead,
  state: TreasuryProposalState,
  yes: z.number().int().nonnegative(),
  no: z.number().int().nonnegative(),
  members: z.number().int().nonnegative(),
  deadlineMs: z.number().int().nonnegative(),
  cost: WholeUnits,
});
export type TreasuryProposalPush = z.infer<typeof TreasuryProposalPush>;

/**
 * Domain codes for the treasury REST surface (W22-01).
 * Both the UPPER_SNAKE `errorCode` and the lowercase REST `error.code` are listed, matching W20.
 */
export const TREASURY_ERROR_CODES = [
  'DAO_NOT_FOUND',
  'NOT_A_MEMBER',
  'ALREADY_VOTED',
  'TREASURY_INSUFFICIENT',
  'PROPOSAL_CLOSED',
  'dao_not_found',
  'not_a_member',
  'already_voted',
  'treasury_insufficient',
  'proposal_closed',
] as const;
export type TreasuryErrorCode = (typeof TREASURY_ERROR_CODES)[number];
