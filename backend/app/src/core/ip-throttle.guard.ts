import { type CanActivate, type ExecutionContext, Inject, Injectable, Optional } from '@nestjs/common';
import { CoreException } from './errors';
import { TokenBucketLimiter } from './token-bucket';
import { APP_ENV, type AppEnv } from './tokens';

/** Default `AUTH_RATE_PER_MIN`: guest sign-ups and home requests per client IP per minute (also the burst). */
export const DEFAULT_AUTH_RATE_PER_MIN = 30;

interface RequestLike {
  readonly ip?: string;
  readonly socket?: { readonly remoteAddress?: string };
  readonly route?: { readonly path?: string };
  readonly originalUrl?: string;
}

/**
 * Per-IP throttle of the routes that create players or seat colonies (`POST /v1/auth/guest`, `GET /v1/me/home`), BE-05:
 * each new guest can make the server generate another planet, so one client may not do it without bound. A token
 * bucket per route and IP (`AUTH_RATE_PER_MIN` per minute, same burst); over it the request answers 429 `rate_limited`.
 */
@Injectable()
export class IpThrottleGuard implements CanActivate {
  private readonly limiter: TokenBucketLimiter;

  constructor(@Optional() @Inject(APP_ENV) env?: AppEnv) {
    const perMin = Number(env?.AUTH_RATE_PER_MIN ?? DEFAULT_AUTH_RATE_PER_MIN);
    this.limiter = new TokenBucketLimiter({ perSecond: perMin / 60, burst: perMin });
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RequestLike>();
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    if (this.limiter.take(`${req.route?.path ?? req.originalUrl ?? ''}|${ip}`)) return true;
    throw new CoreException('TOO_MANY_REQUESTS', { status: 429, message: 'too many requests from this address, retry in a minute' });
  }
}
