import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import type { PrismaClient } from '@terra/db';
import { DevOnlyGuard } from '../core/dev-only.guard.js';
import { PRISMA } from '../db/db.module.js';
import { listMockNotify } from './notify-list.js';

/**
 * Dev-only: recent mock notifier rows, `GET /v1/dev/notify?colonyId=&limit=`.
 * 404 in production. The chain outbox viewer stays `/v1/dev/chain/outbox`.
 */
@Controller('dev/notify')
@UseGuards(DevOnlyGuard)
export class NotifyDevController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Get()
  list(@Query('colonyId') colonyId?: string, @Query('limit') limit?: string) {
    return listMockNotify(this.prisma, { colonyId, limit });
  }
}
