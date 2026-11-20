import { Controller, Get, Inject, Optional, Query } from '@nestjs/common';
import type { AiBudgetView } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { CoreException } from '../../core/errors/index.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { FlagsService } from '../../flags/flags.service.js';
import { ManagedAiGate } from './managed-ai-gate.js';

export interface AiAccessResponse {
  readonly colonyId: string;
  readonly aiBudget: AiBudgetView;
}

/**
 * W28-06 `GET /v1/near/staking/ai-access?colonyId=…`: the Director panel's AI access card for one colony (trial turns
 * left, budget used / cap, slots used / max, mode `trial | tee | script | byok`). Read-only; 404 unless `W28` is on.
 * W28-11 renders it. Folding it into `director.status` needs a `shared/contracts` change (see the issue report).
 */
@Controller('near')
export class AiAccessController {
  private readonly gate: ManagedAiGate;

  constructor(
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
    @Optional() @Inject(APP_ENV) env?: AppEnv,
  ) {
    this.gate = new ManagedAiGate(prisma, env);
  }

  @Get('staking/ai-access')
  async aiAccess(
    @Query('colonyId') colonyIdRaw?: string,
    @Query('planetId') planetIdRaw?: string,
    @Query('colonyIndex') colonyIndexRaw?: string,
  ): Promise<AiAccessResponse> {
    if (!this.flags.has('W28')) throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
    const simId = colonyIdRaw?.trim();
    if (!simId) throw new CoreException('INVALID_REQUEST', { status: 400, message: 'colonyId is required' });
    const colonyId = await this.rowId(simId, planetIdRaw?.trim(), colonyIndexRaw);
    const byok = await this.hasByokKey(colonyId);
    return { colonyId: simId, aiBudget: await this.gate.view({ id: colonyId }, { byok }) };
  }

  /**
   * The `core.colony` row id. The sim id equals it on real planets; dev scenarios seat a `co_…` row for sim colony
   * `col_N`, so a missing id falls back to `(planetId, colonyIndex)` when the client names them.
   */
  private async rowId(simId: string, planetId: string | undefined, colonyIndexRaw: string | undefined): Promise<string> {
    const db = this.prisma;
    const index = Number(colonyIndexRaw);
    if (!db || !planetId || !Number.isInteger(index) || index < 0 || typeof db.colony?.findFirst !== 'function') return simId;
    if (await db.colony.findUnique({ where: { id: simId }, select: { id: true } })) return simId;
    const row = await db.colony.findFirst({ where: { planetId, colonyIndex: index }, select: { id: true } });
    return row?.id ?? simId;
  }

  /** The colony owner saved a `/me.html` NEAR.AI key: their Director runs on it for `$0` protocol cost. */
  private async hasByokKey(colonyId: string): Promise<boolean> {
    const db = this.prisma;
    if (!db || typeof db.colony?.findUnique !== 'function') return false;
    const colony = await db.colony.findUnique({ where: { id: colonyId }, select: { playerId: true } });
    if (!colony) return false;
    const player = await db.player.findUnique({ where: { id: colony.playerId }, select: { nearAiApiKey: true } });
    return Boolean(player?.nearAiApiKey?.trim());
  }
}
