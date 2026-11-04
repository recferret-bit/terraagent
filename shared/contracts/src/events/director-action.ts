import { z } from 'zod';
import { ActionId, AiId, ScopedId } from '../ai/ids';
import { DirectorActionStateSchema } from '../ai/outcomes';
import { defineEvent } from './define';

export const DirectorActionDataSchema = z.strictObject({
  colonyId: ScopedId,
  requestId: AiId,
  actionId: ActionId,
  state: DirectorActionStateSchema,
  reason: z.string().max(200).optional(),
});
export type DirectorActionData = z.infer<typeof DirectorActionDataSchema>;

export const event = defineEvent({
  kind: 'directorAction',
  wave: 'W16',
  audience: 'player',
  severity: 'info',
  data: DirectorActionDataSchema,
  summary: 'One director action moved to proposed, applied, rejected or superseded (AI-10).',
});
