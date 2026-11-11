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
import type { ChainReceipt } from '../../../domain/types.js';
import { labelChoices } from '../../../identity/account-allocate.js';
import { kekEnv } from '../../../identity/colony-accounts.js';
import { mockOauthSecret, verifyMockToken } from '../../../identity/mock-token.js';
import { KeyStore, loadKekRing } from '../../../keystore/index.js';
import { resolveNearNetworkConfig } from '../../network/near-network.config.js';
import { NearRpcClient, seedToNearSecretKey } from '../../rpc/near-rpc.client.js';
import { verifyFastAuthSessionProof, verifyOidcJwt } from './jwks-verifier.js';
import { OpReceiptCache } from './op-receipt-cache.js';

/**
 * Real NEAR Testnet `IdentityPort` (`W23-09..W23-14`):
 * - Verifies FastAuth (`@fast-auth-near/browser-sdk` Auth0 JWKS or session key proof), Google OAuth ID tokens,
 *   and signed pilot tokens (plus dev mock OAuth tokens in `test`/`development` when `token` carries 2 segments).
 * - Provisions real `{pilot}.<root>.testnet` sub-accounts funded by the root/relayer account with KEK-sealed keys.
 * - Executes NEP-413 custodial account claiming (`addFullAccessKey` on-chain).
 */
@Injectable()
export class TestnetIdentityAdapter implements IdentityPort {
  private readonly rpc: NearRpcClient;
  private readonly envSource: Record<string, string | undefined>;
  private readonly prisma: PrismaClient | null;
  private readonly createCache = new OpReceiptCache<CreateNamedAccountResult>();
  private readonly claimCache = new OpReceiptCache<ChainReceipt>();
  private readonly createdKeys = new Map<string, { seed: Buffer; publicKey: string }>();
  private keyStore: KeyStore | null = null;

  constructor(
    @Optional() @Inject(APP_ENV) env?: AppEnv,
    @Optional() @Inject(PRISMA) prisma?: PrismaClient,
  ) {
    this.envSource = (env ?? process.env) as Record<string, string | undefined>;
    this.rpc = new NearRpcClient(resolveNearNetworkConfig(this.envSource, 'testnet'));
    this.prisma = databaseEnabled(env) ? (prisma ?? null) : null;
  }

  async loginSocial(input: SocialLoginInput): Promise<SocialLoginResult> {
    const provider = input.provider.trim().toLowerCase();
    // 2-segment HMAC token from local dev OAuth / contract suite (`NODE_ENV !== 'production'`):
    if (this.envSource.NODE_ENV !== 'production' && input.token.split('.').length === 2) {
      const claims = verifyMockToken(input.token, mockOauthSecret(), Date.now());
      if (claims.provider !== provider) throw new NearException('NEAR_PROVIDER_REJECTED');
      return { playerId: claims.subject, email: claims.email ?? null, isNew: true };
    }

    if (provider === 'fastauth' || provider === 'near-auth') {
      if (input.token.split('.').length === 3) {
        const issuer = this.rpc.config.fastAuth.issuer.endsWith('/')
          ? this.rpc.config.fastAuth.issuer
          : `${this.rpc.config.fastAuth.issuer}/`;
        const verified = await verifyOidcJwt({
          token: input.token,
          jwksUrl: `${issuer}.well-known/jwks.json`,
          allowedIssuers: [issuer, issuer.replace(/\/$/, '')],
          expectedAudience: this.rpc.config.fastAuth.clientId,
        });
        return { playerId: verified.subject, email: verified.email, isNew: true };
      }
      const proof = verifyFastAuthSessionProof(input.token);
      return { playerId: proof.subject, email: proof.email, isNew: true };
    }

    if (provider === 'google') {
      const verified = await verifyOidcJwt({
        token: input.token,
        jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
        allowedIssuers: ['https://accounts.google.com', 'accounts.google.com'],
        expectedAudience: this.rpc.config.googleClientId,
      });
      return { playerId: verified.subject, email: verified.email, isNew: true };
    }

    if (provider === 'email' && (this.rpc.network === 'testnet' || this.envSource.NODE_ENV !== 'production')) {
      const email = input.token.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new NearException('NEAR_PROVIDER_REJECTED', { message: 'Invalid pilot email address' });
      }
      return { playerId: `email:${email}`, email, isNew: true };
    }

    throw new NearException('NEAR_PROVIDER_REJECTED', { message: `Unsupported social provider: ${provider}` });
  }

  async createNamedAccount(input: CreateNamedAccountInput): Promise<CreateNamedAccountResult> {
    const parent = input.parent ?? this.rpc.config.rootAccount;
    const parentSecret = this.rpc.config.secrets.rootSecretKey;
    if (!parentSecret) {
      throw new NearException('NEAR_UNAVAILABLE', { message: 'Missing NEAR_ROOT_SECRET_KEY for createNamedAccount' });
    }

    return this.createCache.run(input.opId, async () => {
      const candidates = labelChoices(input.name);
      for (const label of candidates) {
        const accountId = `${label}.${parent}`;
        if (this.createdKeys.has(accountId) || (await this.rpc.accountExists(accountId))) continue;
        const generated = this.keys().generate();
        const receipt = await this.rpc.createSubAccount({
          parentAccountId: parent,
          parentSecretKey: parentSecret,
          newAccountId: accountId,
          publicKey: generated.row.publicKey,
          initialNear: '0.02',
        });
        this.createdKeys.set(accountId, { seed: generated.seed, publicKey: generated.row.publicKey });
        return { accountId, receipt };
      }
      throw new NearException('NEAR_NAME_TAKEN');
    });
  }

  async claimAccount(input: ClaimAccountInput): Promise<ChainReceipt> {
    const storedRow = this.prisma?.nearColonyAccount
      ? await this.prisma.nearColonyAccount.findUnique({ where: { accountId: input.accountId } })
      : null;
    const memKey = this.createdKeys.get(input.accountId);
    if (!storedRow && !memKey) {
      throw new NearException('NEAR_UNAVAILABLE', { message: 'Custodial colony account not found for claim' });
    }

    return this.claimCache.run(input.opId, async () => {
      const seed = storedRow ? this.keys().open(storedRow) : memKey!.seed;
      const signerSecret = seedToNearSecretKey(seed);
      const receipt = await this.rpc.addFullAccessKey(input.accountId, signerSecret, input.walletPublicKey);
      if (this.prisma?.nearColonyAccount && storedRow) {
        await this.prisma.nearColonyAccount.updateMany({
          where: { accountId: input.accountId },
          data: {
            claimedAt: storedRow.claimedAt ?? new Date(),
            claimedByAccountId: input.walletAccountId,
          },
        });
      }
      return receipt;
    });
  }

  private keys(): KeyStore {
    if (!this.keyStore) {
      this.keyStore = new KeyStore(loadKekRing(kekEnv((this.envSource as unknown as AppEnv) ?? { NODE_ENV: 'development' })));
    }
    return this.keyStore;
  }
}

export const adapter = adapterOf({ port: IdentityPort, kind: 'testnet', useClass: TestnetIdentityAdapter });
