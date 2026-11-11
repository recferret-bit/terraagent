import { z } from 'zod';
import { GuildOfferAction } from '../guild/offers';
import { MarketPrice } from '../market/orders';
import { ResourceKey } from '../ws/sim';
import { defineEvent } from './define';

export const GuildTradeSettledDataSchema = z.strictObject({
  tradeId: z.string().min(1).max(160),
  colonyId: z.string().min(1).max(64),
  colonyIndex: z.number().int().nonnegative().optional(),
  npcId: z.string().min(1).max(64),
  npcAccountId: z.string().min(2).max(64),
  shipId: z.string().min(1).max(64),
  action: GuildOfferAction,
  resource: ResourceKey,
  amount: z.number().int().positive(),
  price: MarketPrice,
});
export type GuildTradeSettledData = z.infer<typeof GuildTradeSettledDataSchema>;

export const event = defineEvent({
  kind: 'guildTradeSettled',
  wave: 'W15',
  severity: 'info',
  audience: 'player',
  data: GuildTradeSettledDataSchema,
  summary: 'A Guild offer settled with the NPC account as counterparty (W15-11). Feeds Guild Contact progress.',
});
