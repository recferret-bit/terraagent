import { z } from 'zod';
import { defineEvent } from './define';

export const RaidStartedDataSchema = z.strictObject({
  colonyId: z.string().optional(),
  colonyIndex: z.number().int().nonnegative().optional(),
  playerId: z.string().optional(),
  hiveId: z.number().int().optional(),
  species: z.string().optional(),
  waveIndex: z.number().int().positive().optional(),
  budget: z.number().int().nonnegative().optional(),
  count: z.number().int().nonnegative().optional(),
  raidId: z.string().min(1).max(64).optional(),
  attackerColony: z.number().int().nonnegative().optional(),
  attackerColonyId: z.string().min(1).max(64).optional(),
  targetColony: z.number().int().nonnegative().optional(),
  targetColonyId: z.string().min(1).max(64).optional(),
  unitIds: z.array(z.number().int().positive()).optional(),
  q: z.number().int(),
  r: z.number().int(),
});
export type RaidStartedData = z.infer<typeof RaidStartedDataSchema>;

export const event = defineEvent({
  kind: 'raidStarted',
  wave: 'W07',
  severity: 'warn',
  audience: 'player',
  data: RaidStartedDataSchema,
  summary: 'Emitted when a hive dispatches an attacking fauna cohort toward a colony (UO-T-04, W07-15, W07-16).',
});
