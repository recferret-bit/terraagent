import { z } from 'zod';
import { HomeColonyId } from '../rest/home';
import { defineCommand } from './define';

/** Presence enters the sim only as this command (CT-12, SIM-D-06). The game module posts it. */
export const SystemPresenceArgsSchema = z.strictObject({
  colonyId: HomeColonyId,
  away: z.boolean(),
});
export type SystemPresenceArgs = z.infer<typeof SystemPresenceArgsSchema>;

export const command = defineCommand({
  kind: 'system.presence',
  wave: 'W09',
  origin: 'module',
  args: SystemPresenceArgsSchema,
  summary: 'Marks a colony away or back. The sim does not read sockets.',
});
