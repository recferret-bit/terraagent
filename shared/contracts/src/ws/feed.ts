import { z } from 'zod';

export const SimInputSourceSchema = z.enum([
  'player',
  'bot',
  'ai',
  'director',
  'near',
  'admin',
  'system',
  'dev',
  'module',
]);
export type SimInputSource = z.infer<typeof SimInputSourceSchema>;

/** A real-time simulation input item (player, bot, agent, dev, NEAR, or system) visible over WS and saved in DB. */
export const SimInputFeedItemV1Schema = z.strictObject({
  id: z.string().min(1).max(120).optional(),
  planetId: z.string().min(1).max(80),
  sectorId: z.string().min(1).max(64).default('sec_0_0'),
  colonyId: z.string().min(1).max(120).nullable().optional(),
  colonyIndex: z.number().int().min(0).max(255).nullable(),
  actorId: z.string().min(1).max(120).nullable().optional(),
  isBot: z.boolean().default(false),
  source: SimInputSourceSchema,
  commandId: z.string().min(1).max(120),
  kind: z.string().min(1).max(80),
  args: z.unknown(),
  status: z.enum(['queued', 'applied', 'rejected']).default('applied'),
  rejectCode: z.string().max(80).nullable().optional(),
  rejectDetail: z.string().max(400).nullable().optional(),
  atTick: z.number().int().min(0),
  createdAtMs: z.number().int().nonnegative(),
});
export type SimInputFeedItemV1 = z.infer<typeof SimInputFeedItemV1Schema>;

/** A real-time AI / governor / autopilot / player decision record visible over WS and saved in DB. */
export const AgentDecisionFeedItemV1Schema = z.strictObject({
  id: z.string().min(1).max(120).optional(),
  planetId: z.string().min(1).max(80),
  sectorId: z.string().min(1).max(64).default('sec_0_0'),
  colonyId: z.string().min(1).max(120).nullable().optional(),
  colonyIndex: z.number().int().min(0).max(255).nullable(),
  actorId: z.string().min(1).max(120).nullable().optional(),
  isBot: z.boolean().default(false),
  actorSource: z.string().min(1).max(64),
  decisionKind: z.string().min(1).max(64),
  summary: z.string().min(1).max(400),
  rationale: z.string().max(1000).nullable().optional(),
  commandId: z.string().max(120).nullable().optional(),
  commandKind: z.string().max(80).nullable().optional(),
  payload: z.unknown().optional(),
  outcome: z.enum(['emitted', 'applied', 'rejected', 'skipped']).default('emitted'),
  atTick: z.number().int().min(0),
  createdAtMs: z.number().int().nonnegative(),
});
export type AgentDecisionFeedItemV1 = z.infer<typeof AgentDecisionFeedItemV1Schema>;
