import type { PrismaClient } from '@terra/db';
import { type AuthSessionRecord, type AuthStore, type PlayerRecord, UniqueViolation } from './auth.store';

/** Prisma P2002 (unique constraint) → {@link UniqueViolation} naming the column; anything else is rethrown unchanged. */
function asUniqueViolation(e: unknown): unknown {
  if (typeof e !== 'object' || e === null || (e as { code?: unknown }).code !== 'P2002') return e;
  const target = JSON.stringify((e as { meta?: { target?: unknown } }).meta?.target ?? '');
  if (/device/i.test(target)) return new UniqueViolation('deviceSecretHash');
  if (/handle/i.test(target)) return new UniqueViolation('handle');
  return new UniqueViolation('other');
}

/** Players and sessions in `core.player` / `core.auth_session`. */
export class PrismaAuthStore implements AuthStore {
  constructor(private readonly prisma: PrismaClient) {}

  findPlayerByDeviceSecretHash(deviceSecretHash: string): Promise<PlayerRecord | null> {
    return this.prisma.player.findUnique({ where: { deviceSecretHash } });
  }

  findPlayerById(id: string): Promise<PlayerRecord | null> {
    return this.prisma.player.findUnique({ where: { id } });
  }

  async createPlayer(input: { id: string; handle: string; deviceSecretHash: string | null }): Promise<PlayerRecord> {
    try {
      return await this.prisma.player.create({ data: input });
    } catch (e) {
      throw asUniqueViolation(e);
    }
  }

  createSession(input: { id: string; playerId: string; refreshTokenHash: string; expiresAt: Date }): Promise<AuthSessionRecord> {
    return this.prisma.authSession.create({ data: input });
  }

  findSessionByTokenHash(refreshTokenHash: string): Promise<AuthSessionRecord | null> {
    return this.prisma.authSession.findUnique({ where: { refreshTokenHash } });
  }

  async revokeSessionIfActive(id: string, revokedAt: Date): Promise<boolean> {
    const r = await this.prisma.authSession.updateMany({ where: { id, revokedAt: null }, data: { revokedAt } });
    return r.count === 1;
  }

  async revokeAllSessionsOfPlayer(playerId: string, revokedAt: Date): Promise<number> {
    return (await this.prisma.authSession.updateMany({ where: { playerId, revokedAt: null }, data: { revokedAt } })).count;
  }

  async deleteExpiredSessions(now: Date): Promise<number> {
    return (await this.prisma.authSession.deleteMany({ where: { expiresAt: { lt: now } } })).count;
  }

  listPlayers(): Promise<PlayerRecord[]> {
    return this.prisma.player.findMany();
  }

  listSessions(): Promise<AuthSessionRecord[]> {
    return this.prisma.authSession.findMany();
  }
}
