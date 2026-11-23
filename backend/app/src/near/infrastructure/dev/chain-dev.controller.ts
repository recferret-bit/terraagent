import { Body, Controller, HttpCode, Inject, Optional, Post, Req, UseGuards } from '@nestjs/common';
import type { PrismaClient } from '@terra/db';
import type { IncomingMessage } from 'node:http';
import { AuthTokenService } from '../../../core/auth/index.js';
import { DevOnlyGuard } from '../../../core/dev-only.guard.js';
import { CoreException } from '../../../core/errors/index.js';
import { APP_ENV, type AppEnv } from '../../../core/tokens.js';
import { PRISMA } from '../../../db/db.module.js';
import { ChainReadPort } from '../../application/ports/chain-read.port.js';
import { NearException } from '../../domain/errors.js';
import { resolveOptionalBearerPlayerId } from '../../identity/colony-ownership.guard.js';
import { assertLocalhostRequest } from '../../identity/local-mock-guard.js';
import { creditLocalMockFaucet, type LocalMockFaucetResult } from './local-mock-wallet-seed.js';
import { playerLinkedWallet } from '../../staking/perks/stake-clock.reader.js';
import { WalletControlGuard } from '../../staking/services/wallet-control.guard.js';
import { nearAdapterFor } from '../adapter-selection.js';
import { requireMockChainRead } from './mock-chain-read.js';

/**
 * Dev-only chain routes (the dev console maps `chain.ping` onto `POST /v1/dev/chain/ping`, and `/me.html#staking` in
 * local mode calls `POST /v1/dev/chain/faucet`). 404 in production and when ChainRead / Staking is not the mock adapter.
 */
@Controller('dev/chain')
@UseGuards(DevOnlyGuard)
export class ChainDevController {
  private readonly walletGuard: WalletControlGuard;

  constructor(
    private readonly chainRead: ChainReadPort,
    @Optional() @Inject(AuthTokenService) private readonly tokens?: AuthTokenService,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
  ) {
    this.walletGuard = new WalletControlGuard(tokens, env, prisma);
  }

  private mock() {
    return requireMockChainRead(this.chainRead);
  }

  @Post('ping')
  @HttpCode(200)
  ping() {
    return this.mock().ping();
  }

  @Post('faucet')
  @HttpCode(200)
  async faucet(@Body() raw: unknown, @Req() req?: IncomingMessage): Promise<LocalMockFaucetResult> {
    assertLocalhostRequest(req);
    const envMap = (this.env ?? process.env) as Record<string, string | undefined>;
    if (nearAdapterFor('Staking', envMap) !== 'mock' || nearAdapterFor('Intents', envMap) !== 'mock' || !this.prisma || !req) {
      throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
    }
    const bodyAcct = typeof raw === 'object' && raw !== null && typeof (raw as { accountId?: unknown }).accountId === 'string'
      ? (raw as { accountId: string }).accountId.trim()
      : '';
    let accountId = bodyAcct;
    if (!accountId) {
      const playerId = resolveOptionalBearerPlayerId(req, this.tokens, this.env);
      const linked = playerId ? await playerLinkedWallet(this.prisma, playerId) : null;
      accountId = linked?.accountId ?? '';
    }
    if (!accountId) {
      throw new NearException('WALLET_REQUIRED', { status: 400, message: 'Link or sign in with a local mock wallet first.' });
    }
    await this.walletGuard.assert(req, accountId, { requireSession: true });
    const funded = await creditLocalMockFaucet(this.prisma, accountId, envMap);
    if (!funded) throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
    return funded;
  }
}
