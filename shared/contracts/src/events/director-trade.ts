import { z } from 'zod';
import { OrderSide } from '../market/orders';
import { ResourceKey } from '../ws/sim';
import { defineEvent } from './define';

export const DirectorTradeDataSchema = z.strictObject({
  colonyId: z.string().min(1).max(64),
  colonyIndex: z.number().int().nonnegative().optional(),
  resource: ResourceKey,
  side: OrderSide,
  amount: z.number().int().positive(),
  /** Display counterparty, e.g. "Guild" or an NPC id. */
  counterparty: z.string().min(1).max(64),
  npcId: z.string().min(1).max(64).optional(),
  tradeId: z.string().min(1).max(160).optional(),
  /** Principal spent and allowance for `resource` after this fill, whole units. */
  spent: z.number().nonnegative(),
  allowance: z.number().nonnegative(),
});
export type DirectorTradeData = z.infer<typeof DirectorTradeDataSchema>;

export const event = defineEvent({
  kind: 'directorTrade',
  wave: 'W15',
  severity: 'info',
  audience: 'player',
  data: DirectorTradeDataSchema,
  summary: 'The director filled an autoTrade while the player was away (F4). Digest text is built from this event.',
});
