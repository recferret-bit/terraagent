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

export function resolveCookieDomain(hostHeader: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
  const host = (raw ?? '').split(':')[0]?.trim().toLowerCase() ?? '';
  if (host === 'terraagent.fun' || host.endsWith('.terraagent.fun')) return '.terraagent.fun';
  if (host === 'terraagent.com' || host.endsWith('.terraagent.com')) return '.terraagent.com';
  return undefined;
}

export function formatRefreshCookie(refreshToken: string, secure = false, domain?: string): string {
  return `${REFRESH_COOKIE_NAME}=${refreshToken}; HttpOnly; Path=/v1/auth; SameSite=Lax; Max-Age=${REFRESH_TOKEN_TTL_S}${domain ? `; Domain=${domain}` : ''}${secure ? '; Secure' : ''}`;
}

export function formatClearCookie(secure = false, domain?: string): string {
  return `${REFRESH_COOKIE_NAME}=; HttpOnly; Path=/v1/auth; SameSite=Lax; Max-Age=0${domain ? `; Domain=${domain}` : ''}${secure ? '; Secure' : ''}`;
}

/** Expired sessions are deleted at most this often, from a login or refresh (no timer to stop). */
export const SESSION_PRUNE_EVERY_MS = 60 * 60 * 1000;

export interface IssuedAuth {
  readonly response: AuthResponse;
  readonly refreshToken: string;
}

@Injectable()
export class AuthService {
  private lastPruneMs = -Infinity;

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
    return this.issueForKnownPlayer(player);
  }

  /** Access token plus refresh session. Social login passes `isGuest: false` and sets `accountId` itself. */
  issueFor(player: PlayerRecord, isGuest: boolean): Promise<IssuedAuth> {
    return this.issueSession(player, isGuest);
  }

  /**
   * Rotates the refresh session atomically: only the request that revokes the presented session gets a new one, so two
   * concurrent refreshes with one cookie yield one session (the other answers 401). Presenting a session that was
   * already rotated or logged out is reuse (a stolen copy, or the real one after the thief rotated it): every session of
   * that player is revoked (BE-04).
   */
  async refresh(refreshToken: string | undefined): Promise<IssuedAuth> {
    if (!refreshToken) {
      throw new UnauthorizedException('Missing refresh token cookie');
    }
    const session = await this.repo.findSessionByTokenHash(sha256Hex(refreshToken));
    if (!session || session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Invalid or expired refresh session');
    }
    if (session.revokedAt !== null || !(await this.repo.revokeSessionIfActive(session.id))) {
      await this.repo.revokeAllSessionsOfPlayer(session.playerId);
      throw new UnauthorizedException('Refresh token reused: every session of this player is revoked');
    }
    const player = await this.repo.findPlayerById(session.playerId);
    if (!player) {
      throw new UnauthorizedException('Player not found for session');
    }
    return this.issueForKnownPlayer(player);
  }

  async logout(refreshToken: string | undefined): Promise<{ ok: true }> {
    if (refreshToken) {
      await this.repo.revokeSessionByTokenHash(sha256Hex(refreshToken));
    }
    return { ok: true };
  }

  /** A `social_identity` row means this player is a Pilot: `isGuest: false` and the Pilot ID on the response. */
  private async issueForKnownPlayer(player: PlayerRecord): Promise<IssuedAuth> {
    const accountId = await this.repo.findPilotAccount(player.id);
    const issued = await this.issueSession(player, accountId === null);
    if (accountId === null) return issued;
    return { refreshToken: issued.refreshToken, response: { ...issued.response, accountId } };
  }

  private async issueSession(player: PlayerRecord, isGuest = true): Promise<IssuedAuth> {
    await this.pruneExpiredSessions();
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
          isGuest,
        },
      },
    };
  }

  private async pruneExpiredSessions(): Promise<void> {
    const now = Date.now();
    if (now - this.lastPruneMs < SESSION_PRUNE_EVERY_MS) return;
    this.lastPruneMs = now;
    await this.repo.deleteExpiredSessions(new Date(now));
  }
}
