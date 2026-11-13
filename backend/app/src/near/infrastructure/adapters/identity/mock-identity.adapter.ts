import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PrismaClient } from '@terra/db';
import { databaseEnabled } from '../../../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../../../core/tokens.js';
import { PRISMA } from '../../../../db/db.module.js';
import { adapterOf } from '../../../../ports/adapters.js';
import {
  IdentityPort,
  type ClaimAccountInput,
  type CreateNamedAccountInput,
  type CreateNamedAccountResult,
  type SocialLoginInput,
  type SocialLoginResult,
} from '../../../application/ports/identity.port.js';
import { NearException } from '../../../domain/errors.js';
import { ChainReceipt } from '../../../domain/types.js';
import { NamedAccountBook } from '../../../identity/account-allocate.js';
import { mockOauthSecret, verifyMockToken } from '../../../identity/mock-token.js';
import { Nep413AuthService } from '../../../identity/nep413-auth.service.js';
import { mockTxHashFor } from '../../mock/tx-hash.js';
import { resolveNearNetworkConfig } from '../../network/near-network.config.js';
import { assertOAuthProviderMatchesSubject, verifyFastAuthPkceCode, verifyOidcJwt } from '../real/jwks-verifier.js';
import { insertNamedAccount } from './named-account.db.js';

/**
 * Mock social login and named accounts. No `MockChainBase` sleep (BE-38): unit tests have no database,
 * and social login must not wait on mock latency. `claimAccount` stays unavailable.
 */
@Injectable()
export class MockIdentityAdapter implements IdentityPort {
  private readonly book: NamedAccountBook | null;
  private readonly prisma: PrismaClient | null;
  private readonly receipts = new Map<string, ChainReceipt>();
  private readonly nep413: Nep413AuthService;
  private readonly envSource: Record<string, string | undefined>;

  constructor(
    @Optional() @Inject(APP_ENV) env?: AppEnv,
    @Optional() @Inject(PRISMA) prisma?: PrismaClient,
    @Optional() @Inject(Nep413AuthService) nep413?: Nep413AuthService,
  ) {
    this.book = databaseEnabled(env) ? null : new NamedAccountBook();
    this.prisma = this.book ? null : prisma ?? null;
    this.envSource = (env ?? process.env) as Record<string, string | undefined>;
    this.nep413 = nep413 ?? new Nep413AuthService(env);
  }

  async loginSocial(input: SocialLoginInput): Promise<SocialLoginResult> {
    const provider = input.provider.trim().toLowerCase();
    if (provider === 'near-wallet' || input.token.startsWith('nep413:')) {
      const verified = await this.nep413.verifyInlineToken(input.token);
      const preferredName = verified.accountId.replace(/\.(testnet|near)$/i, '') || verified.accountId;
      return {
        playerId: verified.accountId,
        email: null,
        preferredName,
        verifiedAccountId: verified.accountId,
        isNew: true,
      };
    }
    if (input.token.startsWith('near-wallet:')) {
      throw new NearException('NEAR_PROVIDER_REJECTED', {
        message: 'NEAR wallet authentication requires a NEP-413 challenge signature',
      });
    }
    if (input.token.startsWith('fastauth-code:')) {
      const cfg = resolveNearNetworkConfig(this.envSource, 'testnet');
      const verified = await verifyFastAuthPkceCode({
        rawToken: input.token,
        issuer: cfg.fastAuth.issuer,
        clientId: cfg.fastAuth.clientId,
        requireEmail: provider === 'email',
        envSource: this.envSource,
      });
      assertOAuthProviderMatchesSubject(provider, verified.subject, verified.email);
      return {
        playerId: verified.subject,
        email: verified.email,
        ...(verified.preferredName ? { preferredName: verified.preferredName } : {}),
        isNew: true,
      };
    }
    if (input.token.split('.').length === 3 && !input.token.includes(':')) {
      const cfg = resolveNearNetworkConfig(this.envSource, 'testnet');
      const issuer = cfg.fastAuth.issuer.endsWith('/') ? cfg.fastAuth.issuer : `${cfg.fastAuth.issuer}/`;
      const verified = await verifyOidcJwt({
        token: input.token,
        jwksUrl: `${issuer}.well-known/jwks.json`,
        allowedIssuers: [issuer, issuer.replace(/\/$/, '')],
        expectedAudience: cfg.fastAuth.clientId,
        requireEmail: provider === 'email',
      });
      assertOAuthProviderMatchesSubject(provider, verified.subject, verified.email);
      return {
        playerId: verified.subject,
        email: verified.email,
        ...(verified.preferredName ? { preferredName: verified.preferredName } : {}),
        isNew: true,
      };
    }
    const claims = verifyMockToken(input.token, mockOauthSecret(), Date.now());
    if (claims.provider !== provider) throw new NearException('NEAR_PROVIDER_REJECTED');
    return { playerId: claims.subject, email: claims.email ?? null, isNew: true };
  }

  createNamedAccount(input: CreateNamedAccountInput): Promise<CreateNamedAccountResult> {
    if (this.book) return Promise.resolve(this.fromBook(this.book, input));
    if (!this.prisma) return Promise.reject(new NearException('NEAR_UNAVAILABLE'));
    return insertNamedAccount(this.prisma, { opId: input.opId, name: input.name });
  }

  async claimAccount(input: ClaimAccountInput): Promise<ChainReceipt> {
    const isClaimOp = input.opId.startsWith('account-claim:');
    const existing = this.prisma?.nearColonyAccount
      ? await this.prisma.nearColonyAccount.findUnique({ where: { accountId: input.accountId } })
      : null;
    if (!isClaimOp && !existing) {
      return this.unavailable();
    }
    if (this.prisma?.nearColonyAccount) {
      await this.prisma.nearColonyAccount.updateMany({
        where: { accountId: input.accountId },
        data: {
          claimedAt: existing?.claimedAt ?? new Date(),
          claimedByAccountId: input.walletAccountId,
        },
      });
    }
    return this.receiptFor(input.opId);
  }

  private fromBook(book: NamedAccountBook, input: CreateNamedAccountInput): CreateNamedAccountResult {
    return { accountId: book.allocate(input.opId, input.name), receipt: this.receiptFor(input.opId) };
  }

  private receiptFor(opId: string): ChainReceipt {
    const prior = this.receipts.get(opId);
    if (prior) return prior;
    const receipt = ChainReceipt.parse({ txHash: mockTxHashFor(opId), status: 'success', network: 'mock', at: Date.now() });
    this.receipts.set(opId, receipt);
    return receipt;
  }

  private unavailable(): never {
    throw new NearException('NEAR_UNAVAILABLE', { message: 'not implemented' });
  }
}

export const adapter = adapterOf({ port: IdentityPort, kind: 'mock', useClass: MockIdentityAdapter });
