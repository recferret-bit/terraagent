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

/** A unique column already holds the value (`handle` or `deviceSecretHash`); any other store error propagates as is. */
export class UniqueViolation extends Error {
  constructor(readonly field: 'handle' | 'deviceSecretHash' | 'other') {
    super(`unique constraint violated: ${field}`);
    this.name = 'UniqueViolation';
  }
}

/**
 * Where players and sessions live: Postgres ({@link PrismaAuthStore}) or process memory (unit tests, `MemoryAuthStore`),
 * chosen once by `AuthRepository`. Errors are never swallowed.
 */
export interface AuthStore {
  findPlayerByDeviceSecretHash(deviceSecretHash: string): Promise<PlayerRecord | null>;
  findPlayerById(id: string): Promise<PlayerRecord | null>;
  /** Throws {@link UniqueViolation} when the handle or device secret is taken. */
  createPlayer(input: { id: string; handle: string; deviceSecretHash: string | null }): Promise<PlayerRecord>;
  createSession(input: { id: string; playerId: string; refreshTokenHash: string; expiresAt: Date }): Promise<AuthSessionRecord>;
  findSessionByTokenHash(refreshTokenHash: string): Promise<AuthSessionRecord | null>;
  /** Atomic: revokes the session only when it is not revoked yet; true when this call revoked it. */
  revokeSessionIfActive(id: string, revokedAt: Date): Promise<boolean>;
  /** Revokes every active session of the player (refresh token reuse); returns how many. */
  revokeAllSessionsOfPlayer(playerId: string, revokedAt: Date): Promise<number>;
  /** Deletes sessions that expired before `now`; returns how many. */
  deleteExpiredSessions(now: Date): Promise<number>;
  listPlayers(): Promise<PlayerRecord[]>;
  listSessions(): Promise<AuthSessionRecord[]>;
}

/** Process-memory store (unit tests and `NODE_ENV=test` without a database). */
export class MemoryAuthStore implements AuthStore {
  private readonly playersById = new Map<string, PlayerRecord>();
  private readonly sessionsById = new Map<string, AuthSessionRecord>();

  async findPlayerByDeviceSecretHash(deviceSecretHash: string): Promise<PlayerRecord | null> {
    return [...this.playersById.values()].find((p) => p.deviceSecretHash === deviceSecretHash) ?? null;
  }

  async findPlayerById(id: string): Promise<PlayerRecord | null> {
    return this.playersById.get(id) ?? null;
  }

  async createPlayer(input: { id: string; handle: string; deviceSecretHash: string | null }): Promise<PlayerRecord> {
    const all = [...this.playersById.values()];
    if (this.playersById.has(input.id)) throw new UniqueViolation('other');
    if (all.some((p) => p.handle === input.handle)) throw new UniqueViolation('handle');
    if (input.deviceSecretHash && all.some((p) => p.deviceSecretHash === input.deviceSecretHash)) throw new UniqueViolation('deviceSecretHash');
    const now = new Date();
    const record: PlayerRecord = { ...input, createdAt: now, updatedAt: now };
    this.playersById.set(record.id, record);
    return record;
  }

  async createSession(input: { id: string; playerId: string; refreshTokenHash: string; expiresAt: Date }): Promise<AuthSessionRecord> {
    const record: AuthSessionRecord = { ...input, revokedAt: null, createdAt: new Date() };
    this.sessionsById.set(record.id, record);
    return record;
  }

  async findSessionByTokenHash(refreshTokenHash: string): Promise<AuthSessionRecord | null> {
    return [...this.sessionsById.values()].find((s) => s.refreshTokenHash === refreshTokenHash) ?? null;
  }

  async revokeSessionIfActive(id: string, revokedAt: Date): Promise<boolean> {
    const s = this.sessionsById.get(id);
    if (!s || s.revokedAt !== null) return false;
    this.sessionsById.set(id, { ...s, revokedAt });
    return true;
  }

  async revokeAllSessionsOfPlayer(playerId: string, revokedAt: Date): Promise<number> {
    let n = 0;
    for (const s of this.sessionsById.values()) if (s.playerId === playerId && (await this.revokeSessionIfActive(s.id, revokedAt))) n++;
    return n;
  }

  async deleteExpiredSessions(now: Date): Promise<number> {
    let n = 0;
    for (const [id, s] of this.sessionsById) if (s.expiresAt.getTime() < now.getTime() && this.sessionsById.delete(id)) n++;
    return n;
  }

  async listPlayers(): Promise<PlayerRecord[]> {
    return [...this.playersById.values()];
  }

  async listSessions(): Promise<AuthSessionRecord[]> {
    return [...this.sessionsById.values()];
  }
}
