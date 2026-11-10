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
import { GuildMakerService } from './maker/guild-maker.service.js';
import { GuildOffersService } from './offers/guild-offers.service.js';
import { GUILD_OFFER_SOURCE, GuildVisitPublisher } from './visit/guild-visit.publisher.js';
import { GuildVisitRepository } from './visit/guild-visit.repository.js';
import { GuildVisitService } from './visit/guild-visit.service.js';

/** W15 Guild provisioning, funding book, visit schedule, and the docked market maker. Does nothing while wave W15 is off. */
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
    GuildMakerService,
    GuildOffersService,
    { provide: GUILD_OFFER_SOURCE, useExisting: GuildOffersService },
  ],
  exports: [GuildProvisionService, GuildFundingService, GuildKillSwitch, GuildVisitService, GuildMakerService, GuildOffersService],
})
export class GuildModule {}
