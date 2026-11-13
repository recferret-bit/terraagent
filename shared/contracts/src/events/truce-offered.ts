import { z } from 'zod';
import {
  ColonyTargetIdSchema,
  DiplomacyBondTokenSchema,
  TruceDurationHoursSchema,
} from '../diplomacy';
import { defineEvent } from './define';

export const TruceOfferedDataSchema = z.strictObject({
  offerId: z.string().min(1).max(64),
  fromColony: z.number().int().nonnegative().optional(),
  toColony: z.number().int().nonnegative().optional(),
  fromColonyId: ColonyTargetIdSchema.optional(),
  toColonyId: ColonyTargetIdSchema.optional(),
  fromColonyIndex: z.number().int().nonnegative().optional(),
  toColonyIndex: z.number().int().nonnegative().optional(),
  colonyId: z.string().optional(),
  colonyIndex: z.number().int().nonnegative().optional(),
  playerId: z.string().optional(),
  hours: TruceDurationHoursSchema,
  durationHours: TruceDurationHoursSchema.optional(),
  offeredAtTick: z.number().int().nonnegative().optional(),
  expiresAtTick: z.number().int().nonnegative().optional(),
  bondToken: DiplomacyBondTokenSchema.optional(),
  bondAmount: z.number().nonnegative().optional(),
});
export type TruceOfferedData = z.infer<typeof TruceOfferedDataSchema>;

export const event = defineEvent({
  kind: 'truceOffered',
  wave: 'W18',
  severity: 'info',
  audience: 'player',
  data: TruceOfferedDataSchema,
  summary: 'Emitted when a colony proposes a fixed-term bilateral truce to a contacted neighbor (`UO-DIP-01..02`, W18-01, W18-11..12).',
});
