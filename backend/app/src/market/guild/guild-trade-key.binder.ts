import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@terra/db';
import { PRISMA } from '../../db/db.module.js';
import { TradeKeyRepository } from '../trade/trade-key.repository.js';
import { newKey } from '../trade/trade-keys.js';
import { ownerIdOf, SERVICE_PLANET, slotOf, tradePairs, type GuildPolicy, type RosterNpc } from './guild-plan.js';

/** One W13 bot API key per NPC. The secret is hashed by the trade-key repository and is not kept. */
@Injectable()
export class GuildTradeKeyBinder {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly keys: TradeKeyRepository,
  ) {}

  async ensure(npc: RosterNpc, policy: GuildPolicy): Promise<string> {
    const ownerId = ownerIdOf(npc.id);
    const existing = await this.prisma.tradeApiKey.findFirst({
      where: { ownerId, revokedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) return existing.keyId;
    const created = await this.keys.create({
      key: newKey(),
      ownerId,
      label: 'guild-npc',
      planetId: SERVICE_PLANET,
      colonyId: npc.id,
      colonyIndex: slotOf(npc.accountId),
      accountId: npc.accountId,
      scopes: ['read', 'trade'],
      allowance: {
        maxOpenOrders: 10,
        maxOrderNotional: policy.perOrderExposureAtomic,
        dailyBudget: policy.dailySpendAtomic,
        allowedPairs: tradePairs(npc.pairs),
        priceBandBp: policy.params.clampLowBp,
        killSwitch: policy.killSwitch !== 0,
      },
    });
    return created.keyId;
  }
}
