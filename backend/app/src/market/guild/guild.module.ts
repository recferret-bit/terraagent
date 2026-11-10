import { Module } from '@nestjs/common';
import { GameModule } from '../../game/game.module.js';
import { NearModule } from '../../near/near.module.js';
import { TradeKeyRepository } from '../trade/trade-key.repository.js';
import { GuildNpcRepository } from './guild-npc.repository.js';
import { GuildProvisionService } from './guild-provision.service.js';
import { GuildTradeKeyBinder } from './guild-trade-key.binder.js';
import { GuildWalletBinder } from './guild-wallet.binder.js';
import { GuildVisitPublisher } from './visit/guild-visit.publisher.js';
import { GuildVisitRepository } from './visit/guild-visit.repository.js';
import { GuildVisitService } from './visit/guild-visit.service.js';

/** W15 Guild provisioning and visit schedule. Does nothing while wave W15 is off. */
@Module({
  imports: [NearModule, GameModule],
  providers: [
    GuildNpcRepository,
    GuildWalletBinder,
    GuildTradeKeyBinder,
    GuildProvisionService,
    TradeKeyRepository,
    GuildVisitRepository,
    GuildVisitPublisher,
    GuildVisitService,
  ],
  exports: [GuildProvisionService, GuildVisitService],
})
export class GuildModule {}
