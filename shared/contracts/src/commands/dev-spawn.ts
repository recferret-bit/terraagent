import { z } from 'zod';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'dev.spawn',
  wave: 'W00',
  origin: 'client',
  dev: true,
  args: z.strictObject({ q: z.number().int().min(-32768).max(32767), r: z.number().int().min(-32768).max(32767) }),
  summary: 'Inserts the W00 test entity (kind 1) at tile (q, r); x/y are the tile centre in axial float coordinates.',
});
