import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { APP_ENV, type AppEnv } from '../core/tokens.js';
import { ChainReadPort } from '../near/application/ports/chain-read.port.js';
import { requireMockChainRead } from '../near/infrastructure/dev/mock-chain-read.js';
import { defineDevCommand, DevCommandRegistry } from './dev-command.registry.js';

/** `chain.ping`: writes a receipt through the mock chain (same call as `POST /v1/dev/chain/ping`). */
@Injectable()
export class ChainPingCommand implements OnModuleInit {
  constructor(
    private readonly registry: DevCommandRegistry,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly chainRead: ChainReadPort,
  ) {}

  onModuleInit(): void {
    this.registry.register(defineDevCommand({
      name: 'chain.ping',
      help: 'Write a ping receipt through the mock chain and return it (mock: hash)',
      args: z.object({}).strict(),
      run: () => requireMockChainRead(this.env, this.chainRead).ping(),
    }));
  }
}
