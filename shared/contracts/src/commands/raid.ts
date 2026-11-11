import type { z } from 'zod';
import { RaidTaskPayloadSchema } from '../diplomacy';
import { defineCommand } from './define';

export const RaidArgsSchema = RaidTaskPayloadSchema;
export type RaidArgs = z.infer<typeof RaidArgsSchema>;

export const command = defineCommand({
  kind: 'raid',
  wave: 'W18',
  origin: 'client',
  args: RaidArgsSchema,
  summary: 'Dispatches an army group to raid a target colony (`UO-W-08`, `UO-T-05`, W18-01..02).',
});
