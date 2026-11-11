import { Global, Module } from '@nestjs/common';
import { GameModule } from '../game/game.module.js';
import { NearInfrastructureModule } from '../near/infrastructure/near-infrastructure.module.js';
import { ChainPingCommand } from './chain-ping.command.js';
import { WarpCommand } from './warp.command.js';
import { DevCommandRegistry } from './dev-command.registry.js';
import { PlanetWipeCommand } from './planet-wipe.command';
import { PresenceCommands } from './presence.command.js';
import { TimeCommand } from './time.command.js';
import { TuneCommand } from './tune.command.js';
import { DevController } from './dev.controller.js';
import { AiColoniesDevController } from './ai-colonies.controller.js';
import { DevEconomySimController, PublicEconomySimController } from './economy-sim.controller.js';

/** Dev console server side (PRODUCT_WAVES §3, D-25: dev tools, not anti-cheat). Routes 404 and registration is a no-op when NODE_ENV=production. */
@Global()
@Module({
  imports: [NearInfrastructureModule, GameModule],
  controllers: [DevController, AiColoniesDevController, DevEconomySimController, PublicEconomySimController],
  providers: [DevCommandRegistry, ChainPingCommand, WarpCommand, TuneCommand, PlanetWipeCommand, TimeCommand, PresenceCommands],
  exports: [DevCommandRegistry],
})
export class DevModule {}
