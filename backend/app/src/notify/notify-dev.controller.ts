import { Body, Controller, Get, HttpCode, Inject, Post, Query, UseGuards } from '@nestjs/common';
import type { PrismaClient } from '@terra/db';
import { DevOnlyGuard } from '../core/dev-only.guard.js';
import { ZodPipe } from '../core/errors/zod.pipe.js';
import { PRISMA } from '../db/db.module.js';
import { AlertRouter } from './alert-router.js';
import { listMockNotify } from './notify-list.js';
import { NotifyTestBody, routeDevAttack, type NotifyTestInput } from './notify-test.js';

/**
 * Dev-only: recent mock notifier rows, `GET /v1/dev/notify?colonyId=&limit=`,
 * and `POST /v1/dev/notify/test` which routes one `under_attack`.
 * 404 in production. The chain outbox viewer stays `/v1/dev/chain/outbox`.
 */
@Controller('dev/notify')
@UseGuards(DevOnlyGuard)
export class NotifyDevController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly alerts: AlertRouter,
  ) {}

  @Get()
  list(@Query('colonyId') colonyId?: string, @Query('limit') limit?: string) {
    return listMockNotify(this.prisma, { colonyId, limit });
  }

  /** One `under_attack` for a colony. A playing socket still skips the row (CT-38). */
  @Post('test')
  @HttpCode(200)
  test(@Body(new ZodPipe(NotifyTestBody)) body: NotifyTestInput) {
    return routeDevAttack(this.alerts, body);
  }
}
