import { Global, Module } from '@nestjs/common';
import { GameModule } from '../game/game.module.js';
import { NearInfrastructureModule } from '../near/infrastructure/near-infrastructure.module.js';
import { ChainPingCommand } from './chain-ping.command.js';
import { WarpCommand } from './warp.command.js';
import { DevCommandRegistry } from './dev-command.registry.js';
import { DevController } from './dev.controller.js';

/** Dev console server side (PRODUCT_WAVES §3, D-25: dev tools, not anti-cheat). Routes 404 and registration is a no-op when NODE_ENV=production. */
@Global()
@Module({
  imports: [NearInfrastructureModule, GameModule],
  controllers: [DevController],
  providers: [DevCommandRegistry, ChainPingCommand, WarpCommand],
  exports: [DevCommandRegistry],
})
export class DevModule {}
