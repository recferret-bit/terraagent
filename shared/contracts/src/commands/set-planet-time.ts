import { z } from 'zod';
import { defineCommand } from './define';

export const PlanetTimeArgsSchema = z.strictObject({
  timeOfDay: z.number().min(0).max(24).optional(),
  realHoursPerDay: z.number().min(0.005).max(168).optional(),
  timeScale: z.number().min(0).max(1000).optional(),
});

export type PlanetTimeArgs = z.infer<typeof PlanetTimeArgsSchema>;

export const command = defineCommand({
  kind: 'setPlanetTime',
  wave: 'W00',
  origin: 'client',
  args: PlanetTimeArgsSchema,
  summary:
    'Configures the authoritative planetary solar time of day (0..24h), day length in real hours, and time scale multiplier.',
});
