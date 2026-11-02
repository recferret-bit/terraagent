import { Injectable } from '@nestjs/common';
import { namedAccountOpId, type SocialAuthResponse } from '@terra/contracts';
import { AuthService } from '../../core/auth/auth.service.js';
import { CoreException } from '../../core/errors/core-exception.js';
import { FlagsService } from '../../flags/flags.service.js';
import { IdentityPort } from '../application/ports/identity.port.js';
import { deriveAccountName } from './account-name.js';
import { SocialLink } from './social-link.js';

export interface SocialAuthIssued {
  readonly response: SocialAuthResponse;
  readonly refreshToken: string;
}

/** Verifies the mock token, links the player, then rotates the refresh session. */
@Injectable()
export class SocialAuthService {
  constructor(
    private readonly identity: IdentityPort,
    private readonly auth: AuthService,
    private readonly links: SocialLink,
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
    const linked = await this.links.link({
      provider: input.provider,
      subject,
      accountId: named.accountId,
      email: verified.email,
      bearer: bearerPlayer,
    });
    // Revoke first: issueFor inserts the session that must stay valid.
    await this.links.revokeSessions(linked.player.id);
    const issued = await this.auth.issueFor(linked.player, false);
    return { refreshToken: issued.refreshToken, response: { ...issued.response, accountId: named.accountId } };
  }
}
