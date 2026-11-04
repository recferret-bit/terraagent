import { z } from 'zod';
import { defineEvent } from './define';

export const BuildingDestroyedDataSchema = z.strictObject({
  colonyId: z.string().optional(),
  colonyIndex: z.number().int().nonnegative().optional(),
  playerId: z.string().optional(),
  entityId: z.number().int(),
  building: z.string().optional(),
  kind: z.number().int().optional(),
  attackerId: z.number().int().optional(),
  q: z.number().int(),
  r: z.number().int(),
});
export type BuildingDestroyedData = z.infer<typeof BuildingDestroyedDataSchema>;

export const event = defineEvent({
  kind: 'buildingDestroyed',
  wave: 'W07',
  severity: 'critical',
  audience: 'player',
  data: BuildingDestroyedDataSchema,
  summary: 'Emitted when a colony building reaches 0 HP, removing it and returning its footprint to Prepared ground (UO-TF-04, W07-02, W07-16).',
});
