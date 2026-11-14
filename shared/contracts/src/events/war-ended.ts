import { z } from 'zod';
import { DiplomacyBondTokenSchema, WarEndReasonSchema } from '../diplomacy';
import { defineEvent } from './define';

export const WarEndedDataSchema = z.strictObject({
  warId: z.string().min(1).max(64),
  attackerColony: z.number().int().nonnegative(),
  defenderColony: z.number().int().nonnegative(),
  attackerColonyId: z.string().min(1).max(64).optional(),
  defenderColonyId: z.string().min(1).max(64).optional(),
  attackerColonyIndex: z.number().int().nonnegative().optional(),
  defenderColonyIndex: z.number().int().nonnegative().optional(),
  bondToken: DiplomacyBondTokenSchema,
  bondAmount: z.number().positive(),
  reason: WarEndReasonSchema,
  cancelledBy: z.union([z.number().int().nonnegative(), z.string().min(1).max(64)]).optional(),
  structuresDestroyed: z.number().int().nonnegative().optional(),
  resourcesSiphoned: z.number().nonnegative().optional(),
  slashedToDefender: z.union([z.boolean(), z.number().nonnegative()]).optional(),
  slashedToProtocol: z.number().nonnegative().optional(),
  endedAtTick: z.number().int().nonnegative().optional(),
});
export type WarEndedData = z.infer<typeof WarEndedDataSchema>;

export const event = defineEvent({
  kind: 'warEnded',
  wave: 'W22',
  severity: 'info',
  audience: 'player',
  data: WarEndedDataSchema,
  summary:
    'Emitted when a 6-hour War Bond resolves: 100% refunded on objective completion, or slashed 90% to defender + 10% to TerraAgent Protocol on early cancel or expiry.',
});
