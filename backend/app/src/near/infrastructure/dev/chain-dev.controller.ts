import { Controller, Get, HttpCode, Inject, Post, Query } from '@nestjs/common';
import { CoreException } from '../../../core/errors/index.js';
import { APP_ENV, type AppEnv } from '../../../core/tokens.js';
import { ChainReadPort } from '../../application/ports/chain-read.port.js';
import { MockChainReadAdapter } from '../adapters/chain-read/mock-chain-read.adapter.js';

/**
 * Dev-only chain routes (the dev console maps `chain.ping` onto `POST /v1/dev/chain/ping`; the mock explorer page reads `receipts`).
 * 404 in production and when ChainRead is not the mock adapter.
 */
@Controller('dev/chain')
export class ChainDevController {
  constructor(@Inject(APP_ENV) private readonly env: AppEnv, private readonly chainRead: ChainReadPort) {}

  private mock(): MockChainReadAdapter {
    if (this.env.NODE_ENV === 'production' || !(this.chainRead instanceof MockChainReadAdapter)) {
      throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
    }
    return this.chainRead;
  }

  @Post('ping')
  @HttpCode(200)
  ping() {
    return this.mock().ping();
  }

  @Get('receipts')
  receipts(@Query('limit') limit?: string) {
    return this.mock().latestReceipts(limit === undefined ? 50 : Number(limit));
  }
}
