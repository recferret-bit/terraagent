import { Injectable, type OnModuleInit } from '@nestjs/common';
import { defineDevCommand, DevCommandRegistry } from '../../dev/dev-command.registry.js';
import { FaucetArgs, MarketFaucetService } from './market-faucet.service.js';

/** Dev console command `faucet` (`near|usdc <amount>` + colonyId/playerId): same call as `POST /v1/dev/market/faucet`. */
@Injectable()
export class MarketFaucetCommand implements OnModuleInit {
  constructor(private readonly registry: DevCommandRegistry, private readonly faucet: MarketFaucetService) {}

  onModuleInit(): void {
    this.registry.register(defineDevCommand({
      name: 'faucet',
      help: 'Credit mock USDC/NEAR to a colony account in the mock verifier ledger: {token:"usdc"|"near", amount:"20", colonyId|playerId}',
      args: FaucetArgs,
      run: (args) => this.faucet.credit(args),
    }));
  }
}
