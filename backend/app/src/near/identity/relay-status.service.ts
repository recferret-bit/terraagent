import { Inject, Injectable, Optional } from '@nestjs/common';
import { storageDepositOpId, type RelayRetryResponse, type RelayStatusResponse } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import type { IncomingMessage } from 'node:http';
import { z } from 'zod';
import { AuthTokenService, extractBearerPlayer } from '../../core/auth/index.js';
import { CoreException } from '../../core/errors/index.js';
import { TokenBucketLimiter } from '../../core/token-bucket.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { FlagsService } from '../../flags/flags.service.js';
import { ChainOutboxRepository } from '../application/outbox/chain-outbox.repository.js';
import { RelayerPort } from '../application/ports/relayer.port.js';
import { NearException } from '../domain/errors.js';
import type { ChainReceipt } from '../domain/types.js';
import { resolveActiveNearNetwork, resolveNearNetworkConfig } from '../infrastructure/network/near-network.config.js';
import { validateAndDecodeRelayDelegate } from '../infrastructure/rpc/near-rpc-guardrails.js';
import { reduceRelayState } from './relay-state.js';
import { enforceWalletRelayQuota } from './wallet-relay-quota.js';

/** Named-account row. It has no `storage_deposit` (W06-12). */
const PLAYER_SLOT = 'player';
const ALLOWED_RELAY_METHODS = new Set([
  'mt_transfer',
  'mt_transfer_call',
  'storage_deposit',
  'propose',
  'vote',
  'claim_escrow',
  'claim_expired_refund',
]);

const SubmitRelayBodySchema = z.strictObject({
  opId: z.string().min(1).max(128).optional(),
  signerId: z.string().min(2).max(64),
  receiverId: z.string().min(2).max(64),
  signedDelegate: z.string().min(8).max(32_768),
});

/** Player-scoped deposit status & browser NEP-366 SignedDelegate relay. Wave off is 404 before the bearer is read. */
@Injectable()
export class RelayStatusService {
  private readonly relayLimiter = new TokenBucketLimiter({ perSecond: 2, burst: 8, maxKeys: 5000 });

  constructor(
    private readonly flags: FlagsService,
    private readonly tokens: AuthTokenService,
    private readonly outbox: ChainOutboxRepository,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Optional() @Inject(RelayerPort) private readonly relayerPort?: RelayerPort,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
  ) {}

  async status(req: IncomingMessage): Promise<RelayStatusResponse> {
    return reduceRelayState(await this.outbox.findStatuses(await this.opIds(this.playerId(req))));
  }

  async retry(req: IncomingMessage): Promise<RelayRetryResponse> {
    await this.outbox.requeueFailed(await this.opIds(this.playerId(req)));
    return { state: 'pending' };
  }

  async submitMetaTx(req: IncomingMessage, raw: unknown): Promise<ChainReceipt> {
    const pid = this.playerId(req);
    if (!this.relayLimiter.take(pid)) {
      throw new CoreException('RATE_LIMITED', {
        status: 429,
        message: 'Too many gasless relay submissions; retry shortly.',
        details: { retryAfterMs: this.relayLimiter.retryAfterMs(pid) },
      });
    }
    if (!this.relayerPort) {
      throw new NearException('NEAR_UNAVAILABLE', { status: 503, message: 'Relayer port not configured' });
    }
    const body = SubmitRelayBodySchema.parse(raw ?? {});
    await this.assertSignerOwnedByPlayer(pid, body.signerId);

    const envMap = (this.env ?? process.env) as Record<string, string | undefined>;
    await enforceWalletRelayQuota({
      prisma: this.prisma,
      env: envMap,
      w28: this.flags.has('W28'),
      playerId: pid,
      signerId: body.signerId,
    });
    const cfg = resolveNearNetworkConfig(envMap, resolveActiveNearNetwork('Relayer', envMap));
    const { decoded } = validateAndDecodeRelayDelegate({
      signedDelegateBase64: body.signedDelegate,
      expectedSenderId: body.signerId,
      expectedReceiverId: body.receiverId,
      allowedRoot: [
        cfg.rootAccount,
        'terraagent.mock',
        cfg.contracts.res,
        cfg.contracts.deed,
        cfg.contracts.bounty,
        cfg.contracts.staking,
        cfg.contracts.dao,
        cfg.contracts.pilots,
      ],
      maxDepositNear: cfg.maxRelayDepositNear,
    });
    for (const act of decoded.delegateAction.actions) {
      const methodName = (act as { functionCall?: { methodName?: string } }).functionCall?.methodName ?? '';
      if (!ALLOWED_RELAY_METHODS.has(methodName)) {
        throw new NearException('NEAR_RELAY_RECEIVER_NOT_ALLOWED', {
          status: 403,
          message: `Method "${methodName}" is not eligible for gasless NEP-366 sponsorship`,
        });
      }
    }
    const opId = body.opId?.trim() || `relay:${pid}:${Date.now().toString(36)}`;
    return this.relayerPort.submitMetaTx({
      opId,
      signerId: body.signerId,
      receiverId: body.receiverId,
      signedDelegate: body.signedDelegate,
    });
  }

  private async assertSignerOwnedByPlayer(playerId: string, signerId: string): Promise<void> {
    if (signerId.toLowerCase() === playerId.toLowerCase()) return;
    const owned = await this.prisma.nearColonyAccount.findFirst({
      where: {
        accountId: signerId,
        OR: [{ playerId }, { claimedByAccountId: playerId }],
      },
      select: { accountId: true },
    });
    if (!owned) {
      throw new NearException('NEAR_NOT_OWNER', {
        status: 403,
        message: 'Caller is not authorized to relay transactions for this NEAR signer',
      });
    }
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
