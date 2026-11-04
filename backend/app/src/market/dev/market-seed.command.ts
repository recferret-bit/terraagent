import { Injectable, type OnModuleInit } from '@nestjs/common';
import { defineDevCommand, DevCommandRegistry } from '../../dev/dev-command.registry.js';
import { ClearArgs, MarketSeedService, SeedArgs } from './market-seed.service.js';

/** Dev console commands `market.seed` and `market.clear` (`POST /v1/dev/commands/market.seed|market.clear`). */
@Injectable()
export class MarketSeedCommand implements OnModuleInit {
  constructor(private readonly registry: DevCommandRegistry, private readonly seeds: MarketSeedService) {}

  onModuleInit(): void {
    this.registry.register(defineDevCommand({
      name: 'market.seed',
      help: 'Seed a fixture bot colony with 5 bids and 5 asks on a pair (dev, solo testing): {planetId, pair:"bio.water/metals.t1"}',
      args: SeedArgs,
      run: (args) => this.seeds.seed(args),
    }));
    this.registry.register(defineDevCommand({
      name: 'market.clear',
      help: 'Cancel every open fixture-bot order on a planet: {planetId}',
      args: ClearArgs,
      run: (args) => this.seeds.clear(args),
    }));
  }
}
