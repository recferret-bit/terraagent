import { Injectable } from '@nestjs/common';
import { namedAccountOpId, newId, type SocialAuthResponse } from '@terra/contracts';
import { AuthRepository, type PlayerRecord } from '../../core/auth/auth.repository.js';
import { AuthService } from '../../core/auth/auth.service.js';
import { CoreException } from '../../core/errors/core-exception.js';
import { FlagsService } from '../../flags/flags.service.js';
import { IdentityPort } from '../application/ports/identity.port.js';
import { deriveAccountName } from './account-name.js';

export interface SocialAuthIssued {
  readonly response: SocialAuthResponse;
  readonly refreshToken: string;
}

interface SubjectAccount {
  readonly playerId: string;
  readonly accountId: string;
  readonly handle: string;
}

/** One subject, one player, in this process (BE-31). The named account is idempotent on `namedAccountOpId`. */
@Injectable()
export class SocialAuthService {
  private readonly bySubject = new Map<string, SubjectAccount>();

  constructor(
    private readonly identity: IdentityPort,
    private readonly auth: AuthService,
    private readonly authRepo: AuthRepository,
    private readonly flags: FlagsService,
  ) {}

  async login(
    input: { provider: string; token: string },
    bearerPlayer?: { id: string; handle: string },
  ): Promise<SocialAuthIssued> {
    if (!this.flags.has('W06')) throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
    const verified = await this.identity.loginSocial(input);
    const subject = verified.playerId;
    const named = await this.identity.createNamedAccount({
      opId: namedAccountOpId(input.provider, subject),
      name: deriveAccountName(subject),
    });
    const player = await this.playerFor(input.provider, subject, bearerPlayer);
    this.bySubject.set(this.key(input.provider, subject), { playerId: player.id, accountId: named.accountId, handle: player.handle });
    const issued = await this.auth.issueFor(player, false);
    return { refreshToken: issued.refreshToken, response: { ...issued.response, accountId: named.accountId } };
  }

  private async playerFor(
    provider: string,
    subject: string,
    bearerPlayer?: { id: string; handle: string },
  ): Promise<PlayerRecord> {
    const known = this.bySubject.get(this.key(provider, subject));
    if (known) return this.mustFind(known.playerId);
    if (bearerPlayer) return this.mustFind(bearerPlayer.id);
    return this.authRepo.createPlayer({ id: newId('pr'), handle: deriveAccountName(subject), deviceSecretHash: null });
  }

  private async mustFind(id: string): Promise<PlayerRecord> {
    const player = await this.authRepo.findPlayerById(id);
    if (!player) throw new CoreException('UNAUTHORIZED', { status: 401, message: 'Player not found' });
    return player;
  }

  private key(provider: string, subject: string): string {
    return `${provider}:${subject}`;
  }
}
