import { z } from 'zod';
import { defineEvent } from './define';

export const event = defineEvent({
  kind: 'lightningStrike',
  wave: 'W05',
  severity: 'warn',
  audience: 'player',
  data: z.strictObject({
    planetId: z.string().optional(),
    colonyId: z.string().optional(),
    q: z.number().int(),
    r: z.number().int(),
    absorbed: z.boolean().optional(),
    entityId: z.number().int().nonnegative().optional(),
    damage: z.number().nonnegative().optional(),
    tiles: z.array(z.strictObject({ q: z.number().int(), r: z.number().int() })).optional(),
    damagedEntityIds: z.array(z.number().int().nonnegative()).optional(),
    overloadedEntityIds: z.array(z.number().int().nonnegative()).optional(),
    offlineDurationTicks: z.number().int().nonnegative().optional(),
  }),
  summary: 'Emitted when a lightning bolt strikes a tile or 4-hex cluster, damaging buildings and overloading electricity (W05-01).',
});
