import { defineCommand } from './define';
import { PlanetTimeArgsSchema } from './set-planet-time';

export const command = defineCommand({
  kind: 'dev.time',
  wave: 'W00',
  origin: 'client',
  dev: true,
  args: PlanetTimeArgsSchema,
  summary:
    'Dev command to configure the planet time of day (0..24h), real hours per day, and time scale without requiring a seated colony.',
});
