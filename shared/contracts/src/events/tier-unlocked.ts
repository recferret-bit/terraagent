import { z } from 'zod';
import { ResourceFamily } from '../ws/sim';
import { defineEvent } from './define';

export const event = defineEvent({
  kind: 'tierUnlocked',
  wave: 'W05',
  severity: 'info',
  audience: 'player',
  data: z.strictObject({
    colonyId: z.string(),
    playerId: z.string().optional(),
    family: ResourceFamily,
    tier: z.union([z.literal(2), z.literal(3)]),
    extractorEntityId: z.number().int().nonnegative().optional(),
    q: z.number().int().optional(),
    r: z.number().int().optional(),
  }),
  summary: 'Emitted when an extractor unlocks T2 or T3 resource output via the Terraform % and local ring gate (D-34, W05-01, W05-34).',
});
