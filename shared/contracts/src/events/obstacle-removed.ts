import { z } from 'zod';
import { ResourceKey } from '../ws/sim';
import { defineEvent } from './define';

export const event = defineEvent({
  kind: 'obstacleRemoved',
  wave: 'W01',
  severity: 'info',
  audience: 'player',
  data: z.strictObject({
    colonyId: z.string(),
    playerId: z.string().optional(),
    op: z.enum(['clear', 'break']),
    count: z.number().int().positive(),
    q: z.number().int().optional(),
    r: z.number().int().optional(),
    achievement: z.string().optional(),
    /** Yield that did not fit under the colony's storage caps and was lost (absent when everything was credited). */
    overflow: z.partialRecord(ResourceKey, z.number().int().positive()).optional(),
  }),
  summary: 'Emitted when a Forest or Rock obstacle is removed via Clear or Break (Stone Mason progression, W01-13, W01-31); `overflow` is the capped-away yield.',
});
