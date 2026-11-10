import { Module } from '@nestjs/common';
import { NearModule } from '../../near/near.module.js';
import { TradeKeyRepository } from '../trade/trade-key.repository.js';
import { GuildFundingRepository } from './funding/funding.repository.js';
import { GuildFundingService } from './funding/guild-funding.service.js';
import { GuildKillSwitch } from './funding/guild-kill.js';
import { GuildNpcRepository } from './guild-npc.repository.js';
import { GuildProvisionService } from './guild-provision.service.js';
import { GuildTradeKeyBinder } from './guild-trade-key.binder.js';
import { GuildWalletBinder } from './guild-wallet.binder.js';

/** W15 Guild provisioning. Imported by the market module; does nothing while wave W15 is off. */
@Module({
  imports: [NearModule],
  providers: [
    GuildNpcRepository,
    GuildWalletBinder,
    GuildTradeKeyBinder,
    GuildProvisionService,
    TradeKeyRepository,
    GuildFundingRepository,
    GuildFundingService,
    GuildKillSwitch,
  ],
  exports: [GuildProvisionService, GuildFundingService, GuildKillSwitch],
})
export class GuildModule {}
