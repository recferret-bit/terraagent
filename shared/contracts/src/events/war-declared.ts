import { z } from 'zod';
import { DiplomacyBondTokenSchema } from '../diplomacy';
import { defineEvent } from './define';

export const WarDeclaredDataSchema = z.strictObject({
  warId: z.string().min(1).max(64),
  attackerColony: z.number().int().nonnegative(),
  defenderColony: z.number().int().nonnegative(),
  attackerColonyId: z.string().min(1).max(64).optional(),
  defenderColonyId: z.string().min(1).max(64).optional(),
  bondToken: DiplomacyBondTokenSchema,
  bondAmount: z.number().positive(),
  declaredAtTick: z.number().int().nonnegative(),
  expiresAtTick: z.number().int().nonnegative(),
});
export type WarDeclaredData = z.infer<typeof WarDeclaredDataSchema>;

export const event = defineEvent({
  kind: 'warDeclared',
  wave: 'W22',
  severity: 'warn',
  audience: 'player',
  data: WarDeclaredDataSchema,
  summary: 'Emitted when an attacker colony locks a 6-hour War Bond in escrow against a target colony.',
});
