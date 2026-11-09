import { z } from 'zod';
import { defineEvent } from './define';

export const RaidRepelledDataSchema = z.strictObject({
  colonyId: z.string().optional(),
  colonyIndex: z.number().int().nonnegative().optional(),
  playerId: z.string().optional(),
  hiveId: z.number().int().optional(),
  species: z.string().optional(),
  unbreached: z.boolean(),
  count: z.number().int().nonnegative().optional(),
  q: z.number().int().optional(),
  r: z.number().int().optional(),
});
export type RaidRepelledData = z.infer<typeof RaidRepelledDataSchema>;

export const event = defineEvent({
  kind: 'raidRepelled',
  wave: 'W07',
  severity: 'info',
  audience: 'player',
  data: RaidRepelledDataSchema,
  summary: 'Emitted when an attacking fauna cohort is defeated or withdraws; unbreached is true if no colony building was destroyed (W07-16, W07-27).',
});
