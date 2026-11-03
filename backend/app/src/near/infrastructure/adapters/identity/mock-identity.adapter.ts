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
import { mockTxHashFor } from '../../mock/tx-hash.js';
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

  constructor(
    @Optional() @Inject(APP_ENV) env?: AppEnv,
    @Optional() @Inject(PRISMA) prisma?: PrismaClient,
  ) {
    this.book = databaseEnabled(env) ? null : new NamedAccountBook();
    this.prisma = this.book ? null : prisma ?? null;
  }

  async loginSocial(input: SocialLoginInput): Promise<SocialLoginResult> {
    const claims = verifyMockToken(input.token, mockOauthSecret(), Date.now());
    if (claims.provider !== input.provider) throw new NearException('NEAR_PROVIDER_REJECTED');
    return { playerId: claims.subject, email: claims.email ?? null, isNew: true };
  }

  createNamedAccount(input: CreateNamedAccountInput): Promise<CreateNamedAccountResult> {
    if (this.book) return Promise.resolve(this.fromBook(this.book, input));
    if (!this.prisma) return Promise.reject(new NearException('NEAR_UNAVAILABLE'));
    return insertNamedAccount(this.prisma, { opId: input.opId, name: input.name });
  }

  claimAccount(_input: ClaimAccountInput): Promise<ChainReceipt> {
    return this.unavailable();
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
