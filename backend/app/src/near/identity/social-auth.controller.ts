import { Body, Controller, HttpCode, Inject, Optional, Post, Req, Res, UseGuards } from '@nestjs/common';
import { SocialAuthRequestSchema, type SocialAuthRequest, type SocialAuthResponse } from '@terra/contracts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AuthTokenService, extractBearerPlayer, formatRefreshCookie, resolveCookieDomain } from '../../core/auth/index.js';
import { ZodPipe } from '../../core/errors/zod.pipe.js';
import { IpThrottleGuard } from '../../core/ip-throttle.guard.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { devBearerPlayer } from '../../ws/session-verifier.js';
import { SocialAuthService } from './social-auth.service.js';

interface ReplyLike extends Partial<ServerResponse> {
  header?: (name: string, value: string) => unknown;
}

function setSetCookie(res: ReplyLike, cookie: string): void {
  if (typeof res.setHeader === 'function') {
    res.setHeader('set-cookie', cookie);
  } else if (typeof res.header === 'function') {
    res.header('set-cookie', cookie);
  }
}

const BEARER_RE = /^Bearer\s+(\S+)$/i;

/** No header → a new player. A non-production `dev:` token is the scenario session (not a JWT). */
function optionalBearer(
  req: IncomingMessage,
  tokens: AuthTokenService,
  allowDev: boolean,
): { id: string; handle: string } | undefined {
  if (req.headers.authorization === undefined) return undefined;
  const raw = req.headers.authorization;
  const header = Array.isArray(raw) ? raw[0] : raw;
  const token = typeof header === 'string' ? BEARER_RE.exec(header.trim())?.[1] : undefined;
  if (allowDev && token) {
    const dev = devBearerPlayer(token);
    if (dev) return dev;
  }
  return extractBearerPlayer(req, tokens);
}

/** `POST /v1/auth/social`. A guest bearer upgrades that player; a missing bearer mints one. */
@Controller('auth')
export class SocialAuthController {
  private readonly isProduction: boolean;

  constructor(
    private readonly social: SocialAuthService,
    private readonly tokens: AuthTokenService,
    @Optional() @Inject(APP_ENV) env?: AppEnv,
  ) {
    this.isProduction = env?.NODE_ENV === 'production';
  }

  @Post('social')
  @HttpCode(200)
  @UseGuards(IpThrottleGuard)
  async socialLogin(
    @Body(new ZodPipe(SocialAuthRequestSchema)) body: SocialAuthRequest,
    @Req() req: IncomingMessage,
    @Res({ passthrough: true }) res: ReplyLike,
  ): Promise<SocialAuthResponse> {
    const { response, refreshToken } = await this.social.login(body, optionalBearer(req, this.tokens, !this.isProduction));
    setSetCookie(res, formatRefreshCookie(refreshToken, this.isProduction, resolveCookieDomain(req?.headers?.host)));
    return response;
  }
}
