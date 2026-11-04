import { z } from 'zod';
import { PlayerId } from '../ids';
import { HomeColonyId } from '../rest/home';
import { TileCoord } from '../ws/sim';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'system.spawnColony',
  wave: 'W01',
  origin: 'module',
  args: z.strictObject({
    colonyId: HomeColonyId,
    colonyIndex: z.number().int().nonnegative().optional(),
    playerId: PlayerId.optional(),
    handle: z.string().min(1).max(64).optional(),
    name: z.string().min(1).max(64),
    color: z.number().int().nonnegative().optional(),
    slotIndex: z.number().int().nonnegative().optional(),
    q: TileCoord.optional(),
    r: TileCoord.optional(),
    unlockStage: z.number().int().min(0).max(10).optional(),
  }),
  summary: 'Spawns a colony drop pod at a free spawn slot with starting pod cargo (W01-09).',
});
