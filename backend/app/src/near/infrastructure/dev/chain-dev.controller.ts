import { Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { APP_ENV, type AppEnv } from '../../../core/tokens.js';
import { ChainReadPort } from '../../application/ports/chain-read.port.js';
import { requireMockChainRead } from './mock-chain-read.js';

/**
 * Dev-only chain routes (the dev console maps `chain.ping` onto `POST /v1/dev/chain/ping`; read routes live in `chain-explorer.controller.ts`).
 * 404 in production and when ChainRead is not the mock adapter.
 */
@Controller('dev/chain')
export class ChainDevController {
  constructor(@Inject(APP_ENV) private readonly env: AppEnv, private readonly chainRead: ChainReadPort) {}

  private mock() {
    return requireMockChainRead(this.env, this.chainRead);
  }

  @Post('ping')
  @HttpCode(200)
  ping() {
    return this.mock().ping();
  }
}
