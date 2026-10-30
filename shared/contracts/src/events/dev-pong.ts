import { z } from 'zod';
import { defineEvent } from './define';

export const event = defineEvent({
  kind: 'dev.pong',
  wave: 'W00',
  severity: 'info',
  audience: 'player',
  data: z.strictObject({ note: z.string().max(64).optional() }),
  summary: 'Emitted by the sim when a dev.ping command is applied.',
});
