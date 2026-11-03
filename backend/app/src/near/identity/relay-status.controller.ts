import { Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import type { RelayRetryResponse, RelayStatusResponse } from '@terra/contracts';
import type { IncomingMessage } from 'node:http';
import { RelayStatusService } from './relay-status.service.js';

/**
 * `GET /v1/near/relay` and `POST /v1/near/relay/retry`. Not a dev route.
 * 404 when wave W06 is off, same as social login. The bearer is the logged-in player.
 */
@Controller('near')
export class RelayStatusController {
  constructor(private readonly relay: RelayStatusService) {}

  @Get('relay')
  status(@Req() req: IncomingMessage): Promise<RelayStatusResponse> {
    return this.relay.status(req);
  }

  @Post('relay/retry')
  @HttpCode(200)
  retry(@Req() req: IncomingMessage): Promise<RelayRetryResponse> {
    return this.relay.retry(req);
  }
}
