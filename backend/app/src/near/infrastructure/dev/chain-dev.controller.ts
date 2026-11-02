import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { DevOnlyGuard } from '../../../core/dev-only.guard.js';
import { ChainReadPort } from '../../application/ports/chain-read.port.js';
import { requireMockChainRead } from './mock-chain-read.js';

/**
 * Dev-only chain routes (the dev console maps `chain.ping` onto `POST /v1/dev/chain/ping`; read routes live in `chain-explorer.controller.ts`).
 * 404 in production and when ChainRead is not the mock adapter.
 */
@Controller('dev/chain')
@UseGuards(DevOnlyGuard)
export class ChainDevController {
  constructor(private readonly chainRead: ChainReadPort) {}

  private mock() {
    return requireMockChainRead(this.chainRead);
  }

  @Post('ping')
  @HttpCode(200)
  ping() {
    return this.mock().ping();
  }
}
