import { z } from 'zod';
import { ColonyId, PlayerId } from '../ids';
import { TileCoord } from '../ws/sim';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'system.spawnColony',
  wave: 'W01',
  origin: 'module',
  args: z.strictObject({
    colonyId: ColonyId,
    playerId: PlayerId.optional(),
    name: z.string().min(1).max(32),
    color: z.number().int().nonnegative().optional(),
    slotIndex: z.number().int().nonnegative().optional(),
    q: TileCoord.optional(),
    r: TileCoord.optional(),
  }),
  summary: 'Spawns a colony drop pod at a free spawn slot with starting pod cargo (W01-09).',
});
