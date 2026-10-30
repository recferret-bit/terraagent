import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { newId, type AuthResponse, type GuestAuthRequest } from '@terra/contracts';
import { ACCESS_TOKEN_TTL_S, AuthTokenService } from './auth-token.service';
import { AuthRepository, type PlayerRecord } from './auth.repository';

export const REFRESH_COOKIE_NAME = 'ta_rt';
export const REFRESH_TOKEN_TTL_S = 30 * 24 * 60 * 60; // 2592000 (30 days)

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function parseRefreshCookie(cookieHeader: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(cookieHeader) ? cookieHeader.join('; ') : cookieHeader;
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name !== REFRESH_COOKIE_NAME) continue;
    const value = part.slice(eq + 1).trim();
    return value.length > 0 ? decodeURIComponent(value) : undefined;
  }
  return undefined;
}

export function formatRefreshCookie(refreshToken: string, secure = false): string {
  return `${REFRESH_COOKIE_NAME}=${refreshToken}; HttpOnly; Path=/v1/auth; SameSite=Lax; Max-Age=${REFRESH_TOKEN_TTL_S}${secure ? '; Secure' : ''}`;
}

export function formatClearCookie(secure = false): string {
  return `${REFRESH_COOKIE_NAME}=; HttpOnly; Path=/v1/auth; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

export interface IssuedAuth {
  readonly response: AuthResponse;
  readonly refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly tokens: AuthTokenService,
  ) {}

  async guestLogin(input: GuestAuthRequest): Promise<IssuedAuth> {
    const secret = input.deviceSecret ?? randomBytes(16).toString('hex');
    const deviceSecretHash = sha256Hex(secret);
    let player = await this.repo.findPlayerByDeviceSecretHash(deviceSecretHash);
    if (!player) {
      const id = newId('pr');
      const handle = input.handle ?? `Colonist-${id.slice(-4)}`;
      player = await this.repo.createPlayer({ id, handle, deviceSecretHash });
    }
    return this.issueSession(player);
  }

  async refresh(refreshToken: string | undefined): Promise<IssuedAuth> {
    if (!refreshToken) {
      throw new UnauthorizedException('Missing refresh token cookie');
    }
    const tokenHash = sha256Hex(refreshToken);
    const session = await this.repo.findSessionByTokenHash(tokenHash);
    if (!session || session.revokedAt !== null || session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Invalid or expired refresh session');
    }
    const player = await this.repo.findPlayerById(session.playerId);
    if (!player) {
      throw new UnauthorizedException('Player not found for session');
    }
    await this.repo.revokeSessionById(session.id);
    return this.issueSession(player);
  }

  async logout(refreshToken: string | undefined): Promise<{ ok: true }> {
    if (refreshToken) {
      await this.repo.revokeSessionByTokenHash(sha256Hex(refreshToken));
    }
    return { ok: true };
  }

  private async issueSession(player: PlayerRecord): Promise<IssuedAuth> {
    const refreshToken = `rt_${randomBytes(16).toString('hex')}`;
    const refreshTokenHash = sha256Hex(refreshToken);
    const sessionId = `as_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_S * 1000);
    await this.repo.createSession({
      id: sessionId,
      playerId: player.id,
      refreshTokenHash,
      expiresAt,
    });
    const accessToken = this.tokens.signAccessToken(
      { sub: player.id, handle: player.handle },
      ACCESS_TOKEN_TTL_S,
    );
    return {
      refreshToken,
      response: {
        accessToken,
        expiresIn: ACCESS_TOKEN_TTL_S,
        player: {
          id: player.id,
          handle: player.handle,
          isGuest: true,
        },
      },
    };
  }
}
