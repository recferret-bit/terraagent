import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PrismaClient } from '@terra/db';
import { PRISMA } from '../../db/db.module';
import { databaseEnabled } from '../persistence';
import { APP_ENV, type AppEnv } from '../tokens';
import { type AuthSessionRecord, type AuthStore, MemoryAuthStore, type PlayerRecord, UniqueViolation } from './auth.store';
import { PrismaAuthStore } from './prisma-auth.store';

export type { AuthSessionRecord, PlayerRecord } from './auth.store';

/** Handles tried per new player: the asked one, then suffixed variants (`Name-1A2B`) checked against the store. */
export const HANDLE_ATTEMPTS = 8;

const suffixed = (desired: string) => `${desired.slice(0, 27)}-${randomBytes(2).toString('hex').toUpperCase()}`;

/**
 * Players and refresh sessions. The store is chosen once (`databaseEnabled`): Postgres, or memory for unit tests. A
 * database error is never hidden behind memory (BE-03): it propagates to the caller (`map-error.ts`: 500 / 409).
 */
@Injectable()
export class AuthRepository {
  private readonly store: AuthStore;
  /** Set only when players live in Postgres. Unit tests (no database) leave this null. */
  private readonly prisma: PrismaClient | null;

  constructor(
    @Optional() @Inject(PRISMA) prisma?: PrismaClient,
    @Optional() @Inject(APP_ENV) env?: AppEnv,
  ) {
    this.prisma = prisma && databaseEnabled(env) ? prisma : null;
    this.store = this.prisma ? new PrismaAuthStore(this.prisma) : new MemoryAuthStore();
  }

  /** Earliest Pilot ID for this player, or null when the database is off or the player is still a guest. */
  async findPilotAccount(playerId: string): Promise<string | null> {
    if (!this.prisma) return null;
    const row = await this.prisma.socialIdentity.findFirst({
      where: { playerId },
      orderBy: { createdAt: 'asc' },
      select: { accountId: true },
    });
    return row?.accountId ?? null;
  }

  findPlayerByDeviceSecretHash(deviceSecretHash: string): Promise<PlayerRecord | null> {
    return this.store.findPlayerByDeviceSecretHash(deviceSecretHash);
  }

  findPlayerById(id: string): Promise<PlayerRecord | null> {
    return this.store.findPlayerById(id);
  }

  /**
   * Creates a player; a taken handle is retried with a suffix (at most {@link HANDLE_ATTEMPTS} tries, against the
   * store, so it holds after a restart and across processes). A device secret registered meanwhile (two first logins
   * at once) returns that player.
   */
  async createPlayer(input: { id: string; handle: string; deviceSecretHash: string | null }): Promise<PlayerRecord> {
    let handle = input.handle;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.store.createPlayer({ ...input, handle });
      } catch (e) {
        if (e instanceof UniqueViolation && e.field === 'deviceSecretHash' && input.deviceSecretHash) {
          const existing = await this.store.findPlayerByDeviceSecretHash(input.deviceSecretHash);
          if (existing) return existing;
        }
        if (!(e instanceof UniqueViolation) || e.field !== 'handle' || attempt >= HANDLE_ATTEMPTS) throw e;
        handle = suffixed(input.handle);
      }
    }
  }

  /** Updates a player's handle, retrying with a suffix when the desired handle is already taken. */
  async updatePlayerHandle(id: string, desiredHandle: string): Promise<PlayerRecord> {
    let handle = desiredHandle;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.store.updatePlayerHandle(id, handle);
      } catch (e) {
        if (!(e instanceof UniqueViolation) || e.field !== 'handle') throw e;
        if (attempt >= HANDLE_ATTEMPTS) {
          const existing = await this.store.findPlayerById(id);
          if (existing) return existing;
          throw e;
        }
        handle = suffixed(desiredHandle);
      }
    }
  }

  createSession(input: { id: string; playerId: string; refreshTokenHash: string; expiresAt: Date }): Promise<AuthSessionRecord> {
    return this.store.createSession(input);
  }

  findSessionByTokenHash(refreshTokenHash: string): Promise<AuthSessionRecord | null> {
    return this.store.findSessionByTokenHash(refreshTokenHash);
  }

  /** Revokes the session if it is still active; true when this call revoked it (refresh rotation is atomic, BE-04). */
  revokeSessionIfActive(id: string, revokedAt = new Date()): Promise<boolean> {
    return this.store.revokeSessionIfActive(id, revokedAt);
  }

  revokeAllSessionsOfPlayer(playerId: string, revokedAt = new Date()): Promise<number> {
    return this.store.revokeAllSessionsOfPlayer(playerId, revokedAt);
  }

  async revokeSessionByTokenHash(refreshTokenHash: string, revokedAt = new Date()): Promise<boolean> {
    const session = await this.store.findSessionByTokenHash(refreshTokenHash);
    if (!session) return false;
    await this.store.revokeSessionIfActive(session.id, revokedAt);
    return true;
  }

  deleteExpiredSessions(now = new Date()): Promise<number> {
    return this.store.deleteExpiredSessions(now);
  }

  listPlayers(): Promise<PlayerRecord[]> {
    return this.store.listPlayers();
  }

  listSessions(): Promise<AuthSessionRecord[]> {
    return this.store.listSessions();
  }
}
