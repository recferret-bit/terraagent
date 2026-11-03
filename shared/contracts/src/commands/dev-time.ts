import { z } from 'zod';
import { defineCommand } from './define';
import { PlanetTimeArgsSchema } from './set-planet-time';

export const command = defineCommand({
  kind: 'dev.time',
  wave: 'W00',
  origin: 'client',
  dev: true,
  args: z.union([
    PlanetTimeArgsSchema,
    z.strictObject({
      target: z.string().min(1).max(16),
    }),
  ]),
  summary:
    'Dev command to configure the planet time of day (0..24h or `day`/`night`/`hh:mm`), real hours per day, and time scale without requiring a seated colony.',
});
