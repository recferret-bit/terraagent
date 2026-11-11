import { Body, Controller, Delete, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { DirectorKeyStatusPayload } from '@terra/contracts';
import type { IncomingMessage } from 'node:http';
import { DirectorKeyService } from './director-key.service.js';

/** `POST` and `DELETE /v1/near/director-key` (W15-18, BE-70). Revoke is DELETE, not a second POST. */
@Controller('near')
export class DirectorKeyController {
  constructor(@Inject(DirectorKeyService) private readonly keys: DirectorKeyService) {}

  @Post('director-key')
  @HttpCode(200)
  add(@Req() req: IncomingMessage, @Body() raw: unknown): Promise<DirectorKeyStatusPayload> {
    return this.keys.add(req, raw);
  }

  @Delete('director-key')
  @HttpCode(200)
  remove(@Req() req: IncomingMessage, @Body() raw: unknown): Promise<DirectorKeyStatusPayload> {
    return this.keys.remove(req, raw);
  }
}
