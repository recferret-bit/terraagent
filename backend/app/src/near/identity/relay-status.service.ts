import { Inject, Injectable } from '@nestjs/common';
import { storageDepositOpId, type RelayRetryResponse, type RelayStatusResponse } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import type { IncomingMessage } from 'node:http';
import { AuthTokenService, extractBearerPlayer } from '../../core/auth/index.js';
import { CoreException } from '../../core/errors/index.js';
import { PRISMA } from '../../db/db.module.js';
import { FlagsService } from '../../flags/flags.service.js';
import { ChainOutboxRepository } from '../application/outbox/chain-outbox.repository.js';
import { reduceRelayState } from './relay-state.js';

/** Named-account row. It has no `storage_deposit` (W06-12). */
const PLAYER_SLOT = 'player';

/** Player-scoped deposit status. Wave off is 404 before the bearer is read. */
@Injectable()
export class RelayStatusService {
  constructor(
    private readonly flags: FlagsService,
    private readonly tokens: AuthTokenService,
    private readonly outbox: ChainOutboxRepository,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
  ) {}

  async status(req: IncomingMessage): Promise<RelayStatusResponse> {
    return reduceRelayState(await this.outbox.findStatuses(await this.opIds(this.playerId(req))));
  }

  async retry(req: IncomingMessage): Promise<RelayRetryResponse> {
    await this.outbox.requeueFailed(await this.opIds(this.playerId(req)));
    return { state: 'pending' };
  }

  /** 404 when W06 is off, then the logged-in player. A missing bearer is 401. */
  private playerId(req: IncomingMessage): string {
    if (!this.flags.has('W06')) throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
    return extractBearerPlayer(req, this.tokens).id;
  }

  private async opIds(playerId: string): Promise<string[]> {
    const accounts = await this.prisma.nearColonyAccount.findMany({
      where: { playerId, slot: { not: PLAYER_SLOT } },
      select: { accountId: true },
    });
    return accounts.map((row) => storageDepositOpId(row.accountId));
  }
}
