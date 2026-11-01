import { createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { APP_ENV, type AppEnv } from '../tokens';

export const ACCESS_TOKEN_TTL_S = 900;
/** The public dev secret: the env default outside production only (`core.module.ts` refuses it in production). */
export const DEV_JWT_SECRET = 'terra-dev-jwt-secret-change-in-prod';

export interface AccessTokenClaims {
  readonly sub: string;
  readonly handle: string;
}

export interface VerifiedAccessToken extends AccessTokenClaims {
  readonly iat: number;
  readonly exp: number;
}

function b64urlEncode(json: unknown): string {
  return Buffer.from(JSON.stringify(json), 'utf8').toString('base64url');
}

function b64urlDecodeJson(part: string): Record<string, unknown> {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new UnauthorizedException('Malformed JWT segment');
  try {
    const parsed: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new UnauthorizedException('Malformed JWT payload');
    }
    return parsed as Record<string, unknown>;
  } catch (e) {
    if (e instanceof UnauthorizedException) throw e;
    throw new UnauthorizedException('Malformed JWT JSON');
  }
}

@Injectable()
export class AuthTokenService {
  private readonly secret: string;

  /** `envOrSecret`: the app env (its parsed `JWT_ACCESS_SECRET`) or the secret itself (tests). */
  constructor(@Inject(APP_ENV) envOrSecret: AppEnv | string) {
    const secret = typeof envOrSecret === 'string' ? envOrSecret : envOrSecret.JWT_ACCESS_SECRET;
    if (typeof secret !== 'string' || secret.length === 0) throw new Error('AuthTokenService needs JWT_ACCESS_SECRET');
    this.secret = secret;
  }

  signAccessToken(payload: AccessTokenClaims, ttlSec = ACCESS_TOKEN_TTL_S): string {
    const nowSec = Math.floor(Date.now() / 1000);
    const headerB64 = b64urlEncode({ alg: 'HS256', typ: 'JWT' });
    const payloadB64 = b64urlEncode({
      sub: payload.sub,
      handle: payload.handle,
      iat: nowSec,
      exp: nowSec + ttlSec,
    });
    const signingInput = `${headerB64}.${payloadB64}`;
    const sigB64 = this.signInput(signingInput);
    return `${signingInput}.${sigB64}`;
  }

  verifyAccessToken(token: string): VerifiedAccessToken {
    if (typeof token !== 'string' || token.length === 0) {
      throw new UnauthorizedException('Missing access token');
    }
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedException('Malformed access token');
    }
    const [headerB64, payloadB64, sigB64] = parts as [string, string, string];
    if (!headerB64 || !payloadB64 || !sigB64) {
      throw new UnauthorizedException('Malformed access token');
    }
    const expectedSig = this.signInput(`${headerB64}.${payloadB64}`);
    const actualBuf = Buffer.from(sigB64, 'utf8');
    const expectedBuf = Buffer.from(expectedSig, 'utf8');
    if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) {
      throw new UnauthorizedException('Invalid access token signature');
    }
    const header = b64urlDecodeJson(headerB64);
    if (header.alg !== 'HS256') {
      throw new UnauthorizedException('Unsupported JWT algorithm');
    }
    const payload = b64urlDecodeJson(payloadB64);
    const { sub, handle, iat, exp } = payload;
    if (typeof sub !== 'string' || sub.length === 0 || typeof handle !== 'string' || typeof iat !== 'number' || typeof exp !== 'number') {
      throw new UnauthorizedException('Invalid access token claims');
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (exp <= nowSec) {
      throw new UnauthorizedException('Access token expired');
    }
    return { sub, handle, iat, exp };
  }

  /** Compatible with `SessionVerifier` in `ws/session-verifier.ts` for W01-03. */
  async verify(accessToken: string): Promise<{ playerId: string; handle: string; exp: number }> {
    const claims = this.verifyAccessToken(accessToken);
    return { playerId: claims.sub, handle: claims.handle, exp: claims.exp };
  }

  private signInput(signingInput: string): string {
    return createHmac('sha256', this.secret).update(signingInput).digest('base64url');
  }
}
