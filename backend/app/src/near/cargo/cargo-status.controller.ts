import { Controller, Get, Inject, Query, Req } from '@nestjs/common';
import type { NearCargoResponse } from '@terra/contracts';
import type { IncomingMessage } from 'node:http';
import { CargoStatusService } from './cargo-status.service.js';

/**
 * `GET /v1/near/cargo` (W10-14): per-colony orbital NEP-245 balances, pending exports/imports,
 * and today's minted vs daily cap (20,000). 404 when wave W10 is off.
 */
@Controller('near')
export class CargoStatusController {
  constructor(@Inject(CargoStatusService) private readonly cargoStatus: CargoStatusService) {}

  @Get('cargo')
  status(
    @Req() req: IncomingMessage,
    @Query('colonyId') colonyId?: string,
    @Query('accountId') accountId?: string,
  ): Promise<NearCargoResponse> {
    return this.cargoStatus.getHttpCargoStatus(req, { colonyId, accountId });
  }
}
