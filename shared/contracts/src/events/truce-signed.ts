import { z } from 'zod';
import { DiplomacyBondTokenSchema, TruceDurationHoursSchema } from '../diplomacy';
import { defineEvent } from './define';

export const TruceSignedDataSchema = z.strictObject({
  truceId: z.string().min(1).max(64).optional(),
  offerId: z.string().min(1).max(64).optional(),
  colonyA: z.union([z.number().int().nonnegative(), z.string().min(1).max(64)]).optional(),
  colonyB: z.union([z.number().int().nonnegative(), z.string().min(1).max(64)]).optional(),
  colonyAId: z.string().min(1).max(64).optional(),
  colonyBId: z.string().min(1).max(64).optional(),
  colonyAIndex: z.number().int().nonnegative().optional(),
  colonyBIndex: z.number().int().nonnegative().optional(),
  colonyId: z.string().optional(),
  colonyIndex: z.number().int().nonnegative().optional(),
  playerId: z.string().optional(),
  hours: TruceDurationHoursSchema.optional(),
  durationHours: TruceDurationHoursSchema.optional(),
  startedAtTick: z.number().int().nonnegative().optional(),
  signedAtTick: z.number().int().nonnegative().optional(),
  expiresAtTick: z.number().int().nonnegative().optional(),
  bondToken: DiplomacyBondTokenSchema.optional(),
  bondAmount: z.number().nonnegative().optional(),
});
export type TruceSignedData = z.infer<typeof TruceSignedDataSchema>;

export const event = defineEvent({
  kind: 'truceSigned',
  wave: 'W18',
  severity: 'info',
  audience: 'player',
  data: TruceSignedDataSchema,
  summary: 'Emitted when a truce offer is accepted and a bilateral truce becomes active (`UO-DIP-02..03`, W18-01, W18-12).',
});
