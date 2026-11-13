import { Body, Controller, HttpCode, Inject, Optional, Post, Req, Res, UseGuards } from '@nestjs/common';
import { GuestAuthRequestSchema, type AuthResponse } from '@terra/contracts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ZodPipe } from '../errors/zod.pipe';
import { IpThrottleGuard } from '../ip-throttle.guard';
import { APP_ENV, type AppEnv } from '../tokens';
import { AuthService, formatClearCookie, formatRefreshCookie, parseRefreshCookie, resolveCookieDomain } from './auth.service';

interface ReplyLike extends Partial<ServerResponse> {
  header?: (name: string, value: string | string[]) => unknown;
}

function setSetCookie(res: ReplyLike, cookie: string | string[]): void {
  if (typeof res.setHeader === 'function') {
    res.setHeader('set-cookie', cookie);
  } else if (typeof res.header === 'function') {
    res.header('set-cookie', cookie);
  }
}

@Controller('auth')
export class AuthController {
  private readonly guestPipe = new ZodPipe(GuestAuthRequestSchema);
  private readonly isProduction: boolean;

  constructor(
    private readonly auth: AuthService,
    @Optional() @Inject(APP_ENV) env?: AppEnv,
  ) {
    this.isProduction = env?.NODE_ENV === 'production';
  }

  @Post('guest')
  @HttpCode(200)
  @UseGuards(IpThrottleGuard)
  async guest(
    @Body() body: unknown,
    @Req() req: IncomingMessage,
    @Res({ passthrough: true }) res: ReplyLike,
  ): Promise<AuthResponse> {
    const parsed = this.guestPipe.transform(body ?? {});
    const { response, refreshToken } = await this.auth.guestLogin(parsed);
    setSetCookie(res, formatRefreshCookie(refreshToken, this.isProduction, resolveCookieDomain(req?.headers?.host)));
    return response;
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: IncomingMessage,
    @Res({ passthrough: true }) res: ReplyLike,
  ): Promise<AuthResponse> {
    const rt = parseRefreshCookie(req.headers?.cookie);
    const { response, refreshToken } = await this.auth.refresh(rt);
    setSetCookie(res, formatRefreshCookie(refreshToken, this.isProduction, resolveCookieDomain(req?.headers?.host)));
    return response;
  }

  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() req: IncomingMessage,
    @Res({ passthrough: true }) res: ReplyLike,
  ): Promise<{ ok: true }> {
    const rt = parseRefreshCookie(req.headers?.cookie);
    const result = await this.auth.logout(rt);
    const domain = resolveCookieDomain(req?.headers?.host);
    setSetCookie(
      res,
      domain
        ? [formatClearCookie(this.isProduction, domain), formatClearCookie(this.isProduction)]
        : formatClearCookie(this.isProduction),
    );
    return result;
  }
}
