import { z } from 'zod';
import { GoalKindSchema } from '../commands/queue-goal';
import { WaveId } from '../flags';
import { AI_BRIEF_MAX_BYTES, AI_MAX_DECISIONS, AI_MAX_EVENTS, AI_MAX_SKILLS, AI_SUMMARY_MAX_CHARS } from './limits';
import { DirectorOutcomeSchema } from './outcomes';
import { DirectorPolicyV1Schema } from './policy';
import { DirectorSkillRefSchema } from './skills';
import { DirectorTriggerSchema } from './triggers';

export const SectorFreshnessSchema = z.enum(['fresh', 'stale', 'unknown', 'unloaded', 'unavailable']);
export type SectorFreshness = z.infer<typeof SectorFreshnessSchema>;

export const SectorRefSchema = z.strictObject({
  sectorId: z.string().min(1).max(64),
  relation: z.enum(['home', 'occupied', 'neighbor', 'goal']),
  freshness: SectorFreshnessSchema,
  observedAtSimS: z.number().nonnegative().optional(),
});

export const ResourceSnapSchema = z.strictObject({
  id: z.string().min(1).max(32),
  stock: z.number().nonnegative(),
  reserved: z.number().nonnegative(),
  unearmarked: z.number().nonnegative(),
  netPerMin: z.number(),
});

export const BriefGoalSchema = z.strictObject({
  id: z.string().min(1).max(64),
  goal: GoalKindSchema,
  status: z.enum(['queued', 'active', 'done', 'cancelled']),
  locked: z.boolean(),
  source: z.enum(['player', 'director', 'rule']),
});

export const ManualOrderSchema = z.strictObject({
  id: z.string().min(1).max(64),
  kind: z.string().min(1).max(32),
});

const ThreatSchema = z.strictObject({
  id: z.string().min(1).max(64),
  kind: z.string().min(1).max(32),
  confidence: z.number().min(0).max(1),
});

const EventSummarySchema = z.strictObject({
  trigger: DirectorTriggerSchema,
  atSimS: z.number().nonnegative(),
  summary: z.string().max(AI_SUMMARY_MAX_CHARS),
});

const DecisionSummarySchema = z.strictObject({
  outcome: DirectorOutcomeSchema,
  atSimS: z.number().nonnegative(),
  summary: z.string().max(AI_SUMMARY_MAX_CHARS),
});

/**
 * Bounded colony brief (AI §5). Hidden deposits are not a field; an extra key fails.
 * Serialised size is checked by `parseAiJson` against `AI_BRIEF_MAX_BYTES` before the model is called.
 */
export const ColonyBriefV2Schema = z.strictObject({
  version: z.literal(2),
  worldId: z.string().min(1).max(64),
  colonyId: z.string().min(1).max(64),
  planetId: z.string().min(1).max(64),
  colonyIndex: z.number().int().nonnegative(),
  atlasVersion: z.string().min(1).max(64),
  configVersion: z.string().min(1).max(64),
  epoch: z.number().int().nonnegative(),
  tick: z.number().int().nonnegative(),
  simTimeS: z.number().nonnegative(),
  observedAtSimS: z.number().nonnegative(),
  intentRevision: z.number().int().nonnegative(),
  goalRevision: z.number().int().nonnegative(),
  permissionRevision: z.number().int().nonnegative(),
  enabledWaves: z.array(WaveId).max(32),
  unlockStage: z.number().int().min(0).max(20),
  hqTier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  resources: z.array(ResourceSnapSchema).max(32),
  power: z.strictObject({
    netPerS: z.number(),
    solar: z.enum(['day', 'night', 'dusk', 'dawn']),
    collapsed: z.boolean(),
  }),
  goals: z.array(BriefGoalSchema).max(16),
  manualOrders: z.array(ManualOrderSchema).max(32),
  policy: DirectorPolicyV1Schema,
  threats: z.array(ThreatSchema).max(16),
  sectors: z.array(SectorRefSchema).max(64),
  skills: z.array(DirectorSkillRefSchema).max(AI_MAX_SKILLS),
  recentEvents: z.array(EventSummarySchema).max(AI_MAX_EVENTS),
  recentDecisions: z.array(DecisionSummarySchema).max(AI_MAX_DECISIONS),
  capabilities: z.strictObject({
    w11: z.boolean(),
    w27: z.boolean(),
    away: z.boolean(),
    guild: z.boolean(),
  }),
});
export type ColonyBriefV2 = z.infer<typeof ColonyBriefV2Schema>;

export { AI_BRIEF_MAX_BYTES };
