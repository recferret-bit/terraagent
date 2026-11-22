import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  namedAccountOpId,
  normalizeLocalMockPlayerName,
  type LocalMockAuthRequest,
  type NearAuthChallengeRequest,
  type NearAuthChallengeResponse,
  type NearAuthVerifyRequest,
  type SocialAuthResponse,
} from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { AuthService } from '../../core/auth/auth.service.js';
import { CoreException } from '../../core/errors/core-exception.js';
import { databaseEnabled } from '../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { FlagsService } from '../../flags/flags.service.js';
import { IdentityPort } from '../application/ports/identity.port.js';
import { nearAdapterFor } from '../infrastructure/adapter-selection.js';
import { NamedAccountBook } from './account-allocate.js';
import { deriveAccountName, deriveSocialAccountName } from './account-name.js';
import { ColonyAccounts } from './colony-accounts.js';
import { allocateLocalMockAccount } from './local-mock-account.js';
import { assertLocalMockEnvAllowed } from './local-mock-guard.js';
import { ensureLocalMockStarterFunds } from '../infrastructure/dev/local-mock-wallet-seed.js';
import { isLocalStakingFastTimings } from '../staking/local-staking-timings.js';
import { Nep413AuthService } from './nep413-auth.service.js';
import { SocialLink } from './social-link.js';

export interface SocialAuthIssued {
  readonly response: SocialAuthResponse;
  readonly refreshToken: string;
}

/** Verifies social OIDC/PKCE tokens and NEP-413 NEAR wallet signatures, links the player, and rotates the refresh session. */
@Injectable()
export class SocialAuthService {
  private readonly localMockBook = new NamedAccountBook();

  constructor(
    private readonly identity: IdentityPort,
    private readonly auth: AuthService,
    private readonly links: SocialLink,
    private readonly flags: FlagsService,
    private readonly colonies: ColonyAccounts,
    private readonly nep413: Nep413AuthService,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
  ) {}

  async loginLocalMock(
    input: LocalMockAuthRequest,
    bearerPlayer?: { id: string; handle: string },
  ): Promise<SocialAuthIssued> {
    if (!this.flags.has('W06')) throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
    assertLocalMockEnvAllowed(this.env);
    const playerName = normalizeLocalMockPlayerName(input.playerName);
    const provider = 'local-mock';
    const subject = playerName.toLowerCase();
    const accountSlug = deriveAccountName(playerName);
    const envMap = this.env as unknown as Record<string, string | undefined>;
    let ownerAccountId: string;
    if (nearAdapterFor('Identity', envMap) === 'mock') {
      const named = await this.identity.createNamedAccount({
        opId: namedAccountOpId(provider, subject),
        name: accountSlug,
      });
      ownerAccountId = named.accountId;
    } else {
      ownerAccountId = await allocateLocalMockAccount(
        databaseEnabled(this.env) ? (this.prisma ?? null) : null,
        this.localMockBook,
        { provider, subject, name: accountSlug },
      );
    }
    if (databaseEnabled(this.env)) {
      await ensureLocalMockStarterFunds(this.prisma, ownerAccountId, envMap);
    }
    return this.linkAndIssueSession({
      provider,
      subject,
      ownerAccountId,
      email: null,
      preferredName: playerName,
      exactHandle: playerName,
      onlyUpgradeGuest: true,
      bearerPlayer,
    });
  }

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
    const stem = verified.accountId.includes('.')
      ? (verified.accountId.split('.')[0] || verified.accountId)
      : verified.accountId;
    const envMap = this.env as unknown as Record<string, string | undefined>;
    if (databaseEnabled(this.env) && isLocalStakingFastTimings(envMap)) {
      await ensureLocalMockStarterFunds(this.prisma, verified.accountId, envMap);
    }
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
    const envMap = this.env as unknown as Record<string, string | undefined>;
    if (verified.verifiedAccountId) {
      if (databaseEnabled(this.env) && isLocalStakingFastTimings(envMap)) {
        await ensureLocalMockStarterFunds(this.prisma, verified.verifiedAccountId, envMap);
      }
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
    if (databaseEnabled(this.env) && isLocalStakingFastTimings(envMap)) {
      await ensureLocalMockStarterFunds(this.prisma, named.accountId, envMap);
    }
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
    readonly exactHandle?: string | null;
    readonly onlyUpgradeGuest?: boolean;
    readonly bearerPlayer?: { id: string; handle: string };
  }): Promise<SocialAuthIssued> {
    const linked = await this.links.link({
      provider: params.provider,
      subject: params.subject,
      accountId: params.ownerAccountId,
      email: params.email,
      preferredName: params.preferredName,
      exactHandle: params.exactHandle,
      onlyUpgradeGuest: params.onlyUpgradeGuest,
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
