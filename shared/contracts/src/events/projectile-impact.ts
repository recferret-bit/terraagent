import { z } from 'zod';
import { defineEvent } from './define';
import { WeaponTypeSchema } from './projectile-fired';

export const ProjectileImpactDataSchema = z.strictObject({
  colonyId: z.string().optional(),
  colonyIndex: z.number().int().nonnegative().optional(),
  attackerId: z.number().int().optional(),
  firedTick: z.number().int().nonnegative().optional(),
  targetId: z.number().int().optional(),
  weaponId: z.string().optional(),
  weaponType: WeaponTypeSchema.optional(),
  aimX: z.number(),
  aimY: z.number(),
  q: z.number().int().optional(),
  r: z.number().int().optional(),
  hit: z.boolean(),
  aoe: z.number().nonnegative().optional(),
  damage: z.number().nonnegative().optional(),
  hitEntityIds: z.array(z.number().int()).optional(),
});
export type ProjectileImpactData = z.infer<typeof ProjectileImpactDataSchema>;

export const event = defineEvent({
  kind: 'projectileImpact',
  wave: 'W07',
  severity: 'info',
  audience: 'player',
  data: ProjectileImpactDataSchema,
  summary: 'Emitted when a projectile or beam resolves at its aim point, applying primary and AoE damage (UO-C-01, UO-C-02, W07-03).',
});
