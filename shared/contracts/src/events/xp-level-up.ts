import { z } from 'zod';
import { defineEvent } from './define';

/** Server-emitted notice when a player crosses a level threshold (W12-05, W12-27). */
export const event = defineEvent({
  kind: 'xp.levelUp',
  wave: 'W12',
  severity: 'info',
  audience: 'player',
  data: z.strictObject({
    playerId: z.string().min(1),
    previousLevel: z.number().int().min(0).max(30),
    level: z.number().int().min(1).max(30),
    xp: z.number().int().nonnegative(),
    title: z.string().min(1),
  }),
  summary: 'The pilot reached a higher level.',
});
