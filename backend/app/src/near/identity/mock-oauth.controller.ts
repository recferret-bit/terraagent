import { Body, Controller, HttpCode, Inject, Optional, Post, Req, Res, UseGuards } from '@nestjs/common';
import { LocalMockAuthRequestSchema, type SocialAuthResponse } from '@terra/contracts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { AuthTokenService, formatRefreshCookie, resolveCookieDomain } from '../../core/auth/index.js';
import { DevOnlyGuard } from '../../core/dev-only.guard.js';
import { CoreException, ZodPipe } from '../../core/errors/index.js';
import { IpThrottleGuard } from '../../core/ip-throttle.guard.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { FlagsService } from '../../flags/flags.service.js';
import { nearAdapterFor } from '../infrastructure/adapter-selection.js';
import { assertLocalhostRequest, assertLocalMockEnvAllowed } from './local-mock-guard.js';
import { mockOauthSecret, MOCK_TOKEN_TTL_S, signMockToken } from './mock-token.js';
import { optionalBearer, setSetCookie } from './social-auth.controller.js';
import { SocialAuthService } from './social-auth.service.js';

interface ReplyLike extends Partial<ServerResponse> {
  header?: (name: string, value: string) => unknown;
}

const TokenBody = z.object({
  provider: z.enum(['google', 'x', 'fastauth']),
  subject: z.string().min(1).max(64),
  email: z.string().min(1).max(320).optional(),
});

/**
 * Dev-only mock OAuth (`POST /v1/dev/mock-oauth/token` & `POST /v1/dev/mock-oauth/login`).
 * 404 in production (`DevOnlyGuard`), when `W06` is off, or when disallowed by environment guards;
 * `login` and `token` additionally reject non-localhost requests with 403.
 */
@Controller('dev/mock-oauth')
@UseGuards(DevOnlyGuard)
export class MockOauthController {
  private readonly pipe = new ZodPipe(TokenBody);
  private readonly localLoginPipe = new ZodPipe(LocalMockAuthRequestSchema);
  private readonly isProduction: boolean;

  constructor(
    private readonly flags: FlagsService,
    private readonly social: SocialAuthService,
    private readonly tokens: AuthTokenService,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
  ) {
    this.isProduction = env?.NODE_ENV === 'production';
  }

  @Post('token')
  @HttpCode(200)
  token(@Body() raw: unknown, @Req() req?: IncomingMessage): { token: string } {
    this.guardTokenRoute();
    assertLocalhostRequest(req);
    const body = this.pipe.transform(raw);
    const exp = Math.floor(Date.now() / 1000) + MOCK_TOKEN_TTL_S;
    const claims = body.email === undefined
      ? { provider: body.provider, subject: body.subject, exp }
      : { provider: body.provider, subject: body.subject, email: body.email, exp };
    return { token: signMockToken(claims, mockOauthSecret()) };
  }

  @Post('login')
  @HttpCode(200)
  @UseGuards(IpThrottleGuard)
  async localLogin(
    @Body() raw: unknown,
    @Req() req: IncomingMessage,
    @Res({ passthrough: true }) res: ReplyLike,
  ): Promise<SocialAuthResponse> {
    assertLocalMockEnvAllowed(this.env);
    if (!this.flags.has('W06')) {
      throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
    }
    assertLocalhostRequest(req);
    const body = this.localLoginPipe.transform(raw);
    const { response, refreshToken } = await this.social.loginLocalMock(
      body,
      optionalBearer(req, this.tokens, !this.isProduction),
    );
    setSetCookie(res, formatRefreshCookie(refreshToken, this.isProduction, resolveCookieDomain(req?.headers?.host)));
    return response;
  }

  /** 404 before zod, so a disabled route does not look like a validation error. */
  private guardTokenRoute(): void {
    assertLocalMockEnvAllowed(this.env);
    const envMap = (this.env ?? process.env) as Record<string, string | undefined>;
    if (nearAdapterFor('Identity', envMap) !== 'mock' || !this.flags.has('W06')) {
      throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
    }
  }
}
