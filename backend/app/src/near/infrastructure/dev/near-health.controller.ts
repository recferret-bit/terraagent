import { Controller, Get } from '@nestjs/common';
import { CoreException } from '../../../core/errors/index.js';
import { FlagsService } from '../../../flags/flags.service.js';
import { ChainReadPort } from '../../application/ports/chain-read.port.js';

/**
 * Public chain health (`GET /v1/near/health`). Not a dev route, so no `DevOnlyGuard`.
 * 404 when wave `W06` is off. Body is exactly `{ ok, adapter }` from `ChainReadPort.health()`.
 */
@Controller('near')
export class NearHealthController {
  constructor(
    private readonly chainRead: ChainReadPort,
    private readonly flags: FlagsService,
  ) {}

  @Get('health')
  async health() {
    if (!this.flags.has('W06')) throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
    const health = await this.chainRead.health();
    return { ok: health.ok, adapter: health.network };
  }
}
