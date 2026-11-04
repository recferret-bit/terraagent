import { z } from 'zod';
import { ScopedId } from '../ai/ids';
import { DirectorPresetSchema, DirectorRiskSchema } from '../ai/policy';
import { defineEvent } from './define';

export const DirectorStatusDataSchema = z.strictObject({
  colonyId: ScopedId,
  risk: DirectorRiskSchema,
  preset: DirectorPresetSchema,
  paused: z.boolean(),
  intentRevision: z.number().int().nonnegative(),
  requestsRemaining: z.number().int().nonnegative(),
  nextCallAtMs: z.number().int().nonnegative().optional(),
});
export type DirectorStatusData = z.infer<typeof DirectorStatusDataSchema>;

export const event = defineEvent({
  kind: 'directorStatus',
  wave: 'W16',
  audience: 'player',
  severity: 'info',
  data: DirectorStatusDataSchema,
  summary: 'Effective director risk, pause and remaining daily requests for one colony.',
});
