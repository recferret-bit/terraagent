import { z } from 'zod';
import { defineEvent } from './define';

export const WEAPON_TYPES = ['bullet', 'shell', 'rocket', 'laser'] as const;
export const WeaponTypeSchema = z.enum(WEAPON_TYPES);
export type WeaponType = z.infer<typeof WeaponTypeSchema>;

export const ProjectileFiredDataSchema = z.strictObject({
  colonyId: z.string().optional(),
  colonyIndex: z.number().int().nonnegative().optional(),
  attackerId: z.number().int(),
  targetId: z.number().int().optional(),
  weaponId: z.string(),
  weaponType: WeaponTypeSchema.optional(),
  arc: z.enum(['direct', 'indirect']).optional(),
  fromX: z.number(),
  fromY: z.number(),
  aimX: z.number(),
  aimY: z.number(),
  q: z.number().int().optional(),
  r: z.number().int().optional(),
  aimQ: z.number().int().optional(),
  aimR: z.number().int().optional(),
  speed: z.number().nonnegative().optional(),
  flightTicks: z.number().int().nonnegative().optional(),
  impactTick: z.number().int().nonnegative().optional(),
  aoe: z.number().nonnegative().optional(),
  damage: z.number().nonnegative().optional(),
});
export type ProjectileFiredData = z.infer<typeof ProjectileFiredDataSchema>;

export const event = defineEvent({
  kind: 'projectileFired',
  wave: 'W07',
  severity: 'info',
  audience: 'player',
  data: ProjectileFiredDataSchema,
  summary: 'Emitted when a unit, turret, HQ, or fauna fires a projectile or instant beam (UO-C-01, UO-C-03, W07-03).',
});
