import { z } from 'zod';
import { defineCommand } from './define';

/** Seeds up to 2 Stage-4 unshielded Rival AI Colonies at back seat slots (`W18`, hackathon multi-agent planet). */
export const SystemSeedRivalAiArgsSchema = z.strictObject({
  count: z.union([z.literal(1), z.literal(2)]).optional(),
  capacity: z.number().int().min(4).max(32).optional(),
});
export type SystemSeedRivalAiArgs = z.infer<typeof SystemSeedRivalAiArgsSchema>;

export const command = defineCommand({
  kind: 'system.seedRivalAi',
  wave: 'W18',
  origin: 'module',
  args: SystemSeedRivalAiArgsSchema,
  summary: 'Seeds established Rival AI Colonies (Trader + Warlord) on a planet and enables the autonomous governor.',
});
