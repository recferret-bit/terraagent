import { z } from 'zod';
import { TileCoord } from '../ws/sim';
import { defineCommand } from './define';

export const GOAL_KINDS = [
  'establish_colony',
  'grow_economy',
  'secure_power',
  'defend_colony',
  'clear_corridor',
  'expand_territory',
  'terraform_zone',
  'tech_up',
  'negotiate_supply',
  'build_army',
  'raid_target',
  'build_rocket',
] as const;

export type GoalKind = (typeof GOAL_KINDS)[number];
export const GoalKindSchema = z.enum(GOAL_KINDS);

export const GoalParamsSchema = z.strictObject({
  resource: z.string().min(1).max(32).optional(),
  targetRatePerMin: z.number().positive().max(100_000).optional(),
  targetNetEnergyPerS: z.number().min(-10_000).max(100_000).optional(),
  target: z.number().min(-10_000).max(100_000).optional(),
  sectorId: z.number().int().nonnegative().optional(),
  q: TileCoord.optional(),
  r: TileCoord.optional(),
  radius: z.number().int().min(1).max(32).optional(),
  op: z.string().min(1).max(32).optional(),
  tier: z.number().int().min(1).max(3).optional(),
  targetColonyId: z.union([z.number().int().nonnegative(), z.string().min(1).max(64)]).optional(),
});

export type GoalParams = z.infer<typeof GoalParamsSchema>;

export const QueueGoalArgsSchema = z.strictObject({
  goal: GoalKindSchema,
  params: GoalParamsSchema.optional(),
  budgetBp: z.number().int().min(0).max(10_000).optional(),
  resource: z.string().min(1).max(32).optional(),
  targetRatePerMin: z.number().positive().max(100_000).optional(),
  targetNetEnergyPerS: z.number().min(-10_000).max(100_000).optional(),
  target: z.number().min(-10_000).max(100_000).optional(),
});

export type QueueGoalArgs = z.infer<typeof QueueGoalArgsSchema>;

export const command = defineCommand({
  kind: 'queueGoal',
  wave: 'W08',
  origin: 'client',
  args: QueueGoalArgsSchema,
  summary: 'Queues an HQ goal onto the colony goal queue (subject to HQ tier limit 2 / 3 / 5, UO-P §4.6).',
});
