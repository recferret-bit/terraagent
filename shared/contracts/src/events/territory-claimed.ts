import { z } from 'zod';
import { defineEvent } from './define';

export const event = defineEvent({
  kind: 'territoryClaimed',
  wave: 'W05',
  severity: 'info',
  audience: 'player',
  data: z.strictObject({
    colonyId: z.string(),
    playerId: z.string().optional(),
    sectorId: z.number().int().nonnegative().optional(),
    beaconEntityId: z.number().int().nonnegative().optional(),
    tiles: z.number().int().nonnegative(),
  }),
  summary: 'Emitted when a Territory Beacon or Command Hub claims tiles for a colony (W05-01).',
});
