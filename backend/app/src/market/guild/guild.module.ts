import { Module } from '@nestjs/common';
import { GameModule } from '../../game/game.module.js';
import { NearModule } from '../../near/near.module.js';
import { TradeKeyRepository } from '../trade/trade-key.repository.js';
import { GuildFundingRepository } from './funding/funding.repository.js';
import { GuildFundingService } from './funding/guild-funding.service.js';
import { GuildKillSwitch } from './funding/guild-kill.js';
import { GuildNpcRepository } from './guild-npc.repository.js';
import { GuildProvisionService } from './guild-provision.service.js';
import { GuildTradeKeyBinder } from './guild-trade-key.binder.js';
import { GuildWalletBinder } from './guild-wallet.binder.js';
import { GuildVisitPublisher } from './visit/guild-visit.publisher.js';
import { GuildVisitRepository } from './visit/guild-visit.repository.js';
import { GuildVisitService } from './visit/guild-visit.service.js';

/** W15 Guild provisioning, funding book, and visit schedule. Does nothing while wave W15 is off. */
@Module({
  imports: [NearModule, GameModule],
  providers: [
    GuildNpcRepository,
    GuildWalletBinder,
    GuildTradeKeyBinder,
    GuildProvisionService,
    TradeKeyRepository,
    GuildFundingRepository,
    GuildFundingService,
    GuildKillSwitch,
    GuildVisitRepository,
    GuildVisitPublisher,
    GuildVisitService,
  ],
  exports: [GuildProvisionService, GuildFundingService, GuildKillSwitch, GuildVisitService],
})
export class GuildModule {}
