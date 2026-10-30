import { z } from 'zod';
import { defineEvent } from './define';

/** Host clock setting, not a sim rule: the game host broadcasts it to every socket of the planet when the dev time warp changes. */
export const event = defineEvent({
  kind: 'dev.warp',
  wave: 'W00',
  severity: 'info',
  audience: 'player',
  data: z.strictObject({ k: z.number().int().min(1).max(100) }),
  summary: 'Dev time warp changed: the planet now steps `k` engine steps per tick slot (effective value after the thread budget cap).',
});
