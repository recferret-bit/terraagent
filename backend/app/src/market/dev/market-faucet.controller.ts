import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { DevOnlyGuard } from '../../core/dev-only.guard.js';
import { MarketFaucetService } from './market-faucet.service.js';

/** `POST /v1/dev/market/faucet`: mock faucet (dev only, W13 only). 404 in production. */
@Controller('dev/market')
@UseGuards(DevOnlyGuard)
export class MarketFaucetController {
  constructor(private readonly faucet: MarketFaucetService) {}

  @Post('faucet')
  @HttpCode(200)
  credit(@Body() body: unknown) {
    return this.faucet.credit(body);
  }
}
