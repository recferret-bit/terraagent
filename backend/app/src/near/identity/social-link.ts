import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { eventDef, newId } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { AuthRepository, type PlayerRecord } from '../../core/auth/auth.repository.js';
import { CoreException } from '../../core/errors/core-exception.js';
import { databaseEnabled } from '../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { deriveAccountName } from './account-name.js';

export interface SocialLinkInput {
  readonly provider: string;
  readonly subject: string;
  readonly accountId: string;
  readonly email: string | null;
  readonly bearer?: { readonly id: string; readonly handle: string };
}

export interface LinkedPlayer {
  readonly player: PlayerRecord;
  /** True the first time this `(provider, subject)` is linked in this process. */
  readonly created: boolean;
}

/** Last `account.created` payload built in this process. Not pushed on the socket (BE-40). */
export interface AccountCreatedNote {
  readonly playerId: string;
  readonly accountId: string;
  readonly provider: string;
  readonly subject: string;
}

const EMAIL_MAX = 254;

function clipEmail(email: string | null): string | null {
  if (email === null || email.length === 0 || email.length > EMAIL_MAX) return null;
  return email;
}

/**
 * One `(provider, subject)`, one player. Postgres `core.social_identity` when the database is on;
 * the process map when it is off, so unit tests stay free of Postgres (BE-36).
 */
@Injectable()
export class SocialLink {
  private readonly bySubject = new Map<string, { playerId: string; accountId: string }>();
  private readonly prisma: PrismaClient | null;
  private lastCreated: AccountCreatedNote | null = null;

  constructor(
    private readonly authRepo: AuthRepository,
    @Optional() @Inject(APP_ENV) env?: AppEnv,
    @Optional() @Inject(PRISMA) prisma?: PrismaClient,
  ) {
    this.prisma = prisma && databaseEnabled(env) ? prisma : null;
  }

  /** Find or create the player and upsert the social row. An existing subject keeps its player (colonies stay). */
  async link(input: SocialLinkInput): Promise<LinkedPlayer> {
    const linked = this.prisma ? await this.linkDb(input) : await this.linkMemory(input);
    if (linked.created) this.noteAccountCreated(input, linked.player.id);
    return linked;
  }

  /** Drop every refresh session of this player. Call this before `issueFor`, or the new session is revoked too. */
  revokeSessions(playerId: string): Promise<number> {
    return this.authRepo.revokeAllSessionsOfPlayer(playerId);
  }

  lastAccountCreated(): AccountCreatedNote | null {
    return this.lastCreated;
  }

  private async linkDb(input: SocialLinkInput): Promise<LinkedPlayer> {
    const prisma = this.prisma;
    if (!prisma) return this.linkMemory(input);
    const where = { provider_subject: { provider: input.provider, subject: input.subject } };
    const existing = await prisma.socialIdentity.findUnique({ where });
    const player = existing ? await this.mustFind(existing.playerId) : await this.playerForNew(input);
    const email = clipEmail(input.email);
    await prisma.socialIdentity.upsert({
      where,
      create: {
        id: `si_${randomUUID().replace(/-/g, '')}`,
        playerId: player.id,
        provider: input.provider,
        subject: input.subject,
        accountId: input.accountId,
        email,
      },
      // A later login with no email must not wipe one already stored.
      update: email === null ? { accountId: input.accountId } : { accountId: input.accountId, email },
    });
    return { player, created: existing === null };
  }

  private async linkMemory(input: SocialLinkInput): Promise<LinkedPlayer> {
    const key = `${input.provider}:${input.subject}`;
    const known = this.bySubject.get(key);
    const player = known ? await this.mustFind(known.playerId) : await this.playerForNew(input);
    this.bySubject.set(key, { playerId: player.id, accountId: input.accountId });
    return { player, created: known === undefined };
  }

  private async playerForNew(input: SocialLinkInput): Promise<PlayerRecord> {
    if (input.bearer) return this.mustFind(input.bearer.id);
    return this.authRepo.createPlayer({
      id: newId('pr'),
      handle: deriveAccountName(input.subject),
      deviceSecretHash: null,
    });
  }

  private async mustFind(id: string): Promise<PlayerRecord> {
    const player = await this.authRepo.findPlayerById(id);
    if (!player) throw new CoreException('UNAUTHORIZED', { status: 401, message: 'Player not found' });
    return player;
  }

  /** Checked against the contract. Nothing delivers a non-sim event on the socket (BE-40). */
  private noteAccountCreated(input: SocialLinkInput, playerId: string): void {
    this.lastCreated = eventDef('account.created').data.parse({
      playerId,
      accountId: input.accountId,
      provider: input.provider,
      subject: input.subject,
    });
  }
}
