import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PrismaClient } from '@terra/db';
import { PRISMA } from '../../db/db.module';
import { APP_ENV, type AppEnv } from '../tokens';

export interface PlayerRecord {
  readonly id: string;
  readonly handle: string;
  readonly deviceSecretHash: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface AuthSessionRecord {
  readonly id: string;
  readonly playerId: string;
  readonly refreshTokenHash: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
}

@Injectable()
export class AuthRepository {
  private readonly playersById = new Map<string, PlayerRecord>();
  private readonly playersBySecret = new Map<string, PlayerRecord>();
  private readonly handles = new Set<string>();
  private readonly sessionsById = new Map<string, AuthSessionRecord>();
  private readonly sessionsByHash = new Map<string, AuthSessionRecord>();
  private readonly dbEnabled: boolean;

  constructor(
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
    @Optional() @Inject(APP_ENV) env?: AppEnv,
  ) {
    this.dbEnabled = Boolean(prisma) && (!env || env.NODE_ENV !== 'test' || Boolean(env.DATABASE_URL));
  }

  async findPlayerByDeviceSecretHash(deviceSecretHash: string): Promise<PlayerRecord | null> {
    if (this.dbEnabled && this.prisma) {
      try {
        const row = await this.prisma.player.findUnique({ where: { deviceSecretHash } });
        if (row) {
          this.saveMemPlayer(row);
          return row;
        }
        return null;
      } catch {
        // Fall through to in-memory store if database is unreachable
      }
    }
    return this.playersBySecret.get(deviceSecretHash) ?? null;
  }

  async findPlayerById(id: string): Promise<PlayerRecord | null> {
    if (this.dbEnabled && this.prisma) {
      try {
        const row = await this.prisma.player.findUnique({ where: { id } });
        if (row) {
          this.saveMemPlayer(row);
          return row;
        }
        return null;
      } catch {
        // Fall through to in-memory store
      }
    }
    return this.playersById.get(id) ?? null;
  }

  async createPlayer(input: { id: string; handle: string; deviceSecretHash: string | null }): Promise<PlayerRecord> {
    const handle = this.uniqueHandle(input.handle);
    if (this.dbEnabled && this.prisma) {
      try {
        const row = await this.prisma.player.create({
          data: { id: input.id, handle, deviceSecretHash: input.deviceSecretHash },
        });
        this.saveMemPlayer(row);
        return row;
      } catch {
        // Fall through to in-memory store
      }
    }
    const now = new Date();
    const record: PlayerRecord = {
      id: input.id,
      handle,
      deviceSecretHash: input.deviceSecretHash,
      createdAt: now,
      updatedAt: now,
    };
    this.saveMemPlayer(record);
    return record;
  }

  async createSession(input: { id: string; playerId: string; refreshTokenHash: string; expiresAt: Date }): Promise<AuthSessionRecord> {
    if (this.dbEnabled && this.prisma) {
      try {
        const row = await this.prisma.authSession.create({
          data: {
            id: input.id,
            playerId: input.playerId,
            refreshTokenHash: input.refreshTokenHash,
            expiresAt: input.expiresAt,
          },
        });
        this.saveMemSession(row);
        return row;
      } catch {
        // Fall through to in-memory store
      }
    }
    const record: AuthSessionRecord = {
      id: input.id,
      playerId: input.playerId,
      refreshTokenHash: input.refreshTokenHash,
      expiresAt: input.expiresAt,
      revokedAt: null,
      createdAt: new Date(),
    };
    this.saveMemSession(record);
    return record;
  }

  async findSessionByTokenHash(refreshTokenHash: string): Promise<AuthSessionRecord | null> {
    if (this.dbEnabled && this.prisma) {
      try {
        const row = await this.prisma.authSession.findUnique({ where: { refreshTokenHash } });
        if (row) {
          this.saveMemSession(row);
          return row;
        }
        return null;
      } catch {
        // Fall through to in-memory store
      }
    }
    return this.sessionsByHash.get(refreshTokenHash) ?? null;
  }

  async revokeSessionById(id: string, revokedAt = new Date()): Promise<void> {
    if (this.dbEnabled && this.prisma) {
      try {
        const updated = await this.prisma.authSession.update({ where: { id }, data: { revokedAt } });
        this.saveMemSession(updated);
        return;
      } catch {
        // Fall through to in-memory store
      }
    }
    const existing = this.sessionsById.get(id);
    if (existing) {
      this.saveMemSession({ ...existing, revokedAt });
    }
  }

  async revokeSessionByTokenHash(refreshTokenHash: string, revokedAt = new Date()): Promise<boolean> {
    const session = await this.findSessionByTokenHash(refreshTokenHash);
    if (!session) return false;
    await this.revokeSessionById(session.id, revokedAt);
    return true;
  }

  async listPlayers(): Promise<PlayerRecord[]> {
    if (this.dbEnabled && this.prisma) {
      try {
        return await this.prisma.player.findMany();
      } catch {
        // Fall through
      }
    }
    return [...this.playersById.values()];
  }

  async listSessions(): Promise<AuthSessionRecord[]> {
    if (this.dbEnabled && this.prisma) {
      try {
        return await this.prisma.authSession.findMany();
      } catch {
        // Fall through
      }
    }
    return [...this.sessionsById.values()];
  }

  private uniqueHandle(desired: string): string {
    if (!this.handles.has(desired)) return desired;
    const suffix = randomBytes(2).toString('hex').toUpperCase();
    return `${desired.slice(0, 27)}-${suffix}`;
  }

  private saveMemPlayer(player: PlayerRecord): void {
    this.playersById.set(player.id, player);
    this.handles.add(player.handle);
    if (player.deviceSecretHash) {
      this.playersBySecret.set(player.deviceSecretHash, player);
    }
  }

  private saveMemSession(session: AuthSessionRecord): void {
    this.sessionsById.set(session.id, session);
    this.sessionsByHash.set(session.refreshTokenHash, session);
  }
}
