import { z } from 'zod';
import { WaveId } from '../flags';
import { QuoteToken, AtomicAmount } from '../market/tokens';
import { ResourceKey } from '../ws/sim';

/** Content hash, `sha256:<hex>` (the §6 example shows the `sha256:...` placeholder, so any non-space tail parses). */
export const ContentHash = z.string().regex(/^sha256:\S+$/, 'expected sha256:<hex>');
export type ContentHash = z.infer<typeof ContentHash>;

export const EconomyProfileRef = z.strictObject({
  id: z.string().min(1),
  version: z.number().int().positive(),
  hash: ContentHash,
});
export type EconomyProfileRef = z.infer<typeof EconomyProfileRef>;

/** `DRAFT → VALIDATED → APPROVED` (ECONOMY §5). Content is immutable once validated. */
export const PROFILE_STATUSES = ['DRAFT', 'VALIDATED', 'APPROVED'] as const;
export const ProfileStatus = z.enum(PROFILE_STATUSES);
export type ProfileStatus = z.infer<typeof ProfileStatus>;

export const ProfileVersion = z.strictObject({
  id: z.string().min(1),
  profileId: z.string().min(1),
  version: z.number().int().positive(),
  parentId: z.string().min(1).nullable(),
  status: ProfileStatus,
  schemaVersion: z.number().int().positive(),
  /** Semver-ish range of engines the content was validated against (never silently substituted). */
  engineCompatibility: z.string().min(1),
  contentHash: ContentHash,
  author: z.string().min(1),
  rationale: z.string(),
  createdAt: z.string().optional(),
});
export type ProfileVersion = z.infer<typeof ProfileVersion>;

/** A registered parameter value: int / bool / enum string / atomic decimal string / resource map / int list. */
export const ParamValue = z.union([
  z.number(),
  z.boolean(),
  z.string(),
  z.array(z.number()),
  z.record(z.string(), z.number()),
]);
export type ParamValue = z.infer<typeof ParamValue>;

const Id = z.string().min(1);

export const RecipeOutput = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('resource'), resource: ResourceKey, amount: AtomicAmount }),
  /** A non-tradable colony fact (prestige project): no cash, no production multiplier. */
  z.strictObject({ kind: z.literal('fact'), factId: Id }),
]);
export type RecipeOutput = z.infer<typeof RecipeOutput>;

/** A recipe is data: registered operations only, no formula strings (ECONOMY §5). */
export const RecipeDef = z.strictObject({
  recipeId: Id,
  activityKind: Id,
  durationTicks: z.number().int().nonnegative(),
  /** Registered eligibility rule ids (placement/supply rules are never bypassed). */
  eligibility: z.array(Id),
  /** Resource → atomic amount (whole units for resources). */
  inputs: z.partialRecord(ResourceKey, AtomicAmount),
  output: RecipeOutput,
  enabledWave: WaveId,
});
export type RecipeDef = z.infer<typeof RecipeDef>;

/** Per-resource policy: all ten keys need sources, consumers, a producer and a buyer cohort (ECONOMY §2). */
export const ResourcePolicy = z.strictObject({
  resource: ResourceKey,
  sources: z.array(Id),
  consumers: z.array(Id),
  producerCohorts: z.array(Id),
  buyerCohorts: z.array(Id),
  reserveHorizonTicks: z.number().int().nonnegative(),
  targetBand: z.strictObject({ loBp: z.number().int().min(0).max(10000), hiBp: z.number().int().min(0).max(10000) }),
});
export type ResourcePolicy = z.infer<typeof ResourcePolicy>;

export const MarketPolicy = z.strictObject({
  pairId: Id,
  /** Key into the market token table (decimals, verifier id, mock flag). */
  tokenMetadataRef: QuoteToken,
  platformFeeBp: z.number().int().min(0).max(10000),
  stallFeeBp: z.number().int().min(0).max(10000),
  lotUnits: AtomicAmount,
  tickAtomic: AtomicAmount,
  minNotionalAtomic: AtomicAmount,
  treasuryShareBp: z.number().int().min(0).max(10000),
});
export type MarketPolicy = z.infer<typeof MarketPolicy>;

export const AgentPolicy = z.strictObject({
  actorId: Id,
  targets: z.record(z.string(), z.number()),
  cashLimitAtomic: AtomicAmount,
  spendLimitAtomic: AtomicAmount,
  lossLimitAtomic: AtomicAmount,
  inventoryLimits: z.partialRecord(ResourceKey, AtomicAmount),
  referenceWindowTicks: z.number().int().positive(),
});
export type AgentPolicy = z.infer<typeof AgentPolicy>;

/** Placeholder sections W13-50 fills (region/logistics schemas); untyped until then. */
export const ProfileSection = z.record(z.string(), z.unknown());

export const ProfileContent = z.strictObject({
  parameters: z.record(z.string(), ParamValue).default({}),
  recipes: z.array(RecipeDef).default([]),
  resourcePolicies: z.array(ResourcePolicy).default([]),
  marketPolicies: z.array(MarketPolicy).default([]),
  agentPolicies: z.array(AgentPolicy).default([]),
  regions: ProfileSection.default({}),
  logistics: ProfileSection.default({}),
});
export type ProfileContent = z.infer<typeof ProfileContent>;

export const PATCH_SCHEMA_VERSION = 1;

export const ProfilePatchOp = z.strictObject({
  op: z.enum(['set', 'unset']),
  path: z.string().min(1),
  value: ParamValue.optional(),
});
export type ProfilePatchOp = z.infer<typeof ProfilePatchOp>;

export const ProfilePatch = z.strictObject({
  schemaVersion: z.literal(PATCH_SCHEMA_VERSION),
  requestId: z.string().min(1),
  /** Optimistic guard: the profile version the patch was written against. */
  expectedVersion: z.number().int().positive(),
  ops: z.array(ProfilePatchOp),
});
export type ProfilePatch = z.infer<typeof ProfilePatch>;
