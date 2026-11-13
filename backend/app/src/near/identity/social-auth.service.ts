import { Inject, Injectable } from '@nestjs/common';
import {
  namedAccountOpId,
  type NearAuthChallengeRequest,
  type NearAuthChallengeResponse,
  type NearAuthVerifyRequest,
  type SocialAuthResponse,
} from '@terra/contracts';
import { AuthService } from '../../core/auth/auth.service.js';
import { CoreException } from '../../core/errors/core-exception.js';
import { databaseEnabled } from '../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { FlagsService } from '../../flags/flags.service.js';
import { IdentityPort } from '../application/ports/identity.port.js';
import { deriveSocialAccountName } from './account-name.js';
import { ColonyAccounts } from './colony-accounts.js';
import { Nep413AuthService } from './nep413-auth.service.js';
import { SocialLink } from './social-link.js';

export interface SocialAuthIssued {
  readonly response: SocialAuthResponse;
  readonly refreshToken: string;
}

/** Verifies social OIDC/PKCE tokens and NEP-413 NEAR wallet signatures, links the player, and rotates the refresh session. */
@Injectable()
export class SocialAuthService {
  constructor(
    private readonly identity: IdentityPort,
    private readonly auth: AuthService,
    private readonly links: SocialLink,
    private readonly flags: FlagsService,
    private readonly colonies: ColonyAccounts,
    private readonly nep413: Nep413AuthService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  issueNearChallenge(input?: NearAuthChallengeRequest): NearAuthChallengeResponse {
    if (!this.flags.has('W06')) throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
    return this.nep413.issueChallenge(input);
  }

  async verifyNearWallet(
    body: NearAuthVerifyRequest,
    bearerPlayer?: { id: string; handle: string },
  ): Promise<SocialAuthIssued> {
    if (!this.flags.has('W06')) throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
    const verified = await this.nep413.verifyChallenge(body);
    const stem = verified.accountId.replace(/\.(testnet|near)$/i, '') || verified.accountId;
    return this.linkAndIssueSession({
      provider: 'near-wallet',
      subject: verified.accountId,
      ownerAccountId: verified.accountId,
      email: null,
      preferredName: stem,
      bearerPlayer,
    });
  }

  async login(
    input: { provider: string; token: string },
    bearerPlayer?: { id: string; handle: string },
  ): Promise<SocialAuthIssued> {
    if (!this.flags.has('W06')) throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
    const verified = await this.identity.loginSocial(input);
    const subject = verified.playerId;
    const preferredName = deriveSocialAccountName({
      subject,
      email: verified.email,
      preferredName: verified.preferredName,
    });
    if (verified.verifiedAccountId) {
      return this.linkAndIssueSession({
        provider: 'near-wallet',
        subject,
        ownerAccountId: verified.verifiedAccountId,
        email: verified.email,
        preferredName,
        bearerPlayer,
      });
    }
    const named = await this.identity.createNamedAccount({
      opId: namedAccountOpId(input.provider, subject),
      name: preferredName,
    });
    return this.linkAndIssueSession({
      provider: input.provider,
      subject,
      ownerAccountId: named.accountId,
      email: verified.email,
      preferredName,
      bearerPlayer,
    });
  }

  private async linkAndIssueSession(params: {
    readonly provider: string;
    readonly subject: string;
    readonly ownerAccountId: string;
    readonly email: string | null;
    readonly preferredName: string;
    readonly bearerPlayer?: { id: string; handle: string };
  }): Promise<SocialAuthIssued> {
    const linked = await this.links.link({
      provider: params.provider,
      subject: params.subject,
      accountId: params.ownerAccountId,
      email: params.email,
      preferredName: params.preferredName,
      bearer: params.bearerPlayer,
    });
    // Every login, not only the first: a colony created between logins still gets a sub-account.
    // The memory path (unit tests, no Postgres) does not seal keys.
    if (databaseEnabled(this.env)) {
      await this.colonies.ensureForLinkedPlayer({
        playerId: linked.player.id,
        subject: params.subject,
        ownerAccountId: params.ownerAccountId,
      });
    }
    // Revoke first: issueFor inserts the session that must stay valid.
    await this.links.revokeSessions(linked.player.id);
    const issued = await this.auth.issueFor(linked.player, false);
    return { refreshToken: issued.refreshToken, response: { ...issued.response, accountId: params.ownerAccountId } };
  }
}
