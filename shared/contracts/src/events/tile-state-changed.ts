import { z } from 'zod';
import { TerraformOp } from '../ws/sim';
import { defineEvent } from './define';

export const event = defineEvent({
  kind: 'tileStateChanged',
  wave: 'W05',
  severity: 'info',
  audience: 'player',
  data: z.strictObject({
    colonyId: z.string(),
    playerId: z.string().optional(),
    q: z.number().int(),
    r: z.number().int(),
    terrain: z.string().optional(),
    prep: z.string().optional(),
    prevTerrain: z.string().optional(),
    prevPrep: z.string().optional(),
    op: TerraformOp.optional(),
  }),
  summary: 'Emitted when a tile changes terrain class or prep state (e.g. Level, Fill, Reclaim, Irrigate, Seed, or building footprint revert; W05-01).',
});
