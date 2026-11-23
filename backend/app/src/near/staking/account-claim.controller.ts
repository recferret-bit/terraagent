import { Body, Controller, Delete, HttpCode, Inject, Optional, Post, Query, Req } from '@nestjs/common';
import { ClaimAccountRequestSchema, type ClaimAccountRequest } from '@terra/contracts';
import type { IncomingMessage } from 'node:http';
import { AuthTokenService, extractBearerPlayer } from '../../core/auth/index.js';
import { CoreException, ZodPipe } from '../../core/errors/index.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { FlagsService } from '../../flags/flags.service.js';
import { devBearerPlayer } from '../../ws/session-verifier.js';
import { AccountClaimService, type ClaimAccountResponse } from './account-claim.service.js';

const BEARER_RE = /^Bearer\s+(\S+)$/i;

function resolveOptionalPlayerId(
  req: IncomingMessage | undefined,
  tokens?: AuthTokenService,
  allowDevBearer = true,
): string | undefined {
  if (!req?.headers?.authorization) return undefined;
  const raw = req.headers.authorization;
  const header = Array.isArray(raw) ? raw[0] : raw;
  const token = typeof header === 'string' ? BEARER_RE.exec(header.trim())?.[1] : undefined;
  if (token && allowDevBearer) {
    const dev = devBearerPlayer(token);
    if (dev) return dev.id;
  }
  if (!tokens) return undefined;
  try {
    return extractBearerPlayer(req, tokens)?.id;
  } catch {
    return undefined;
  }
}

@Controller('near')
export class AccountClaimController {
  private readonly pipe = new ZodPipe(ClaimAccountRequestSchema);

  constructor(
    @Inject(AccountClaimService) private readonly claimService: AccountClaimService,
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Optional() @Inject(AuthTokenService) private readonly tokens?: AuthTokenService,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
  ) {}

  private allowDevBearer(): boolean {
    return (this.env?.NODE_ENV ?? process.env.NODE_ENV) !== 'production';
  }

  @Post('claim-account')
  @HttpCode(200)
  claimAccount(@Body() raw: unknown, @Req() req?: IncomingMessage): Promise<ClaimAccountResponse> {
    return this.handleClaim(raw, req);
  }

  @Post('claim')
  @HttpCode(200)
  claimAlias(@Body() raw: unknown, @Req() req?: IncomingMessage): Promise<ClaimAccountResponse> {
    return this.handleClaim(raw, req);
  }

  @Delete('claim-account/session-key')
  @HttpCode(200)
  revokeSessionKey(@Query('colonyId') colonyId?: string, @Req() req?: IncomingMessage) {
    if (!this.flags.has('W20')) {
      throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
    }
    return this.claimService.revokeTradingSessionKey({
      colonyId,
      playerId: resolveOptionalPlayerId(req, this.tokens, this.allowDevBearer()),
    });
  }

  @Post('claim-account/session-key')
  @HttpCode(200)
  reauthorizeSessionKey(@Body() body?: { colonyId?: string }, @Req() req?: IncomingMessage) {
    if (!this.flags.has('W20')) {
      throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
    }
    return this.claimService.reauthorizeTradingSessionKey({
      colonyId: body?.colonyId,
      playerId: resolveOptionalPlayerId(req, this.tokens, this.allowDevBearer()),
    });
  }

  private handleClaim(raw: unknown, req?: IncomingMessage): Promise<ClaimAccountResponse> {
    if (!this.flags.has('W20')) {
      throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
    }
    const body: ClaimAccountRequest = this.pipe.transform(raw ?? {});
    if (body.colonyId !== undefined && body.colonyId.trim().length === 0) {
      this.pipe.transform({ colonyId: '' });
    }
    return this.claimService.claimColonyAccount({
      colonyId: body.colonyId ?? 'col_0',
      walletAccountId: body.walletAccountId,
      newPublicKey: body.newPublicKey,
      signature: body.walletSignature,
      opId: body.opId,
      playerId: resolveOptionalPlayerId(req, this.tokens, this.allowDevBearer()),
    });
  }
}
