import { createHash, createPublicKey } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { PublicKey } from 'near-api-js';
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
import { registerPreSealedAccountKey } from '../../../identity/colony-account-write.js';
import { kekEnv } from '../../../identity/colony-accounts.js';
import { mockOauthSecret, verifyMockToken } from '../../../identity/mock-token.js';
import { encodeBase58 } from '../../../keystore/base58.js';
import { ed25519PrivateKeyFromSeed, KeyStore, loadKekRing } from '../../../keystore/index.js';
import { resolveNearNetworkConfig } from '../../network/near-network.config.js';
import { NearRpcClient, seedToNearSecretKey } from '../../rpc/near-rpc.client.js';
import { verifyFastAuthPkceCode, verifyFastAuthSessionProof, verifyOidcJwt } from './jwks-verifier.js';
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
    // 2-segment HMAC token from local/testnet OAuth popup (`google`, `x`, `fastauth`):
    if ((this.rpc.network === 'testnet' || this.envSource.NODE_ENV !== 'production') && input.token.split('.').length === 2) {
      const claims = verifyMockToken(input.token, mockOauthSecret(), Date.now());
      if (claims.provider !== provider) throw new NearException('NEAR_PROVIDER_REJECTED');
      return { playerId: claims.subject, email: claims.email ?? null, isNew: true };
    }

    if ((provider === 'google' || provider === 'x' || provider === 'fastauth' || provider === 'near-auth') && input.token.startsWith('fastauth-code:')) {
      const verified = await verifyFastAuthPkceCode({
        rawToken: input.token,
        issuer: this.rpc.config.fastAuth.issuer,
        clientId: this.rpc.config.fastAuth.clientId,
      });
      return { playerId: verified.subject, email: verified.email, isNew: true };
    }

    if (provider === 'fastauth' || provider === 'near-auth') {
      if (input.token.startsWith('near-wallet:')) {
        const rawAccountId = input.token.split(':')[1]?.trim().toLowerCase() ?? '';
        if (!/^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(rawAccountId) || rawAccountId.length < 2 || rawAccountId.length > 64) {
          throw new NearException('NEAR_PROVIDER_REJECTED', { message: 'Invalid NEAR wallet account ID' });
        }
        const subject = rawAccountId.replace(/\.(testnet|near)$/i, '') || rawAccountId;
        return { playerId: subject, email: null, isNew: true };
      }
      if (input.token.split('.').length === 3) {
        return this.verifyFastAuthJwt(input.token);
      }
      const proof = verifyFastAuthSessionProof(input.token);
      return { playerId: proof.subject, email: proof.email, isNew: true };
    }

    if (provider === 'google') {
      if (input.token.split('.').length === 3 && !isDirectGoogleIssuer(input.token)) {
        return this.verifyFastAuthJwt(input.token);
      }
      const verified = await verifyOidcJwt({
        token: input.token,
        jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
        allowedIssuers: ['https://accounts.google.com', 'accounts.google.com'],
        expectedAudience: this.rpc.config.googleClientId,
      });
      return { playerId: verified.subject, email: verified.email, isNew: true };
    }

    if (provider === 'x' && input.token.split('.').length === 3) {
      return this.verifyFastAuthJwt(input.token);
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
      if (input.opId.startsWith('named-account:') && this.prisma?.socialIdentity) {
        const [, provider, ...subjectParts] = input.opId.split(':');
        const subject = subjectParts.join(':');
        if (provider && subject) {
          const existing = await this.prisma.socialIdentity.findUnique({
            where: { provider_subject: { provider, subject } },
          });
          if (existing?.accountId) {
            return {
              accountId: existing.accountId,
              receipt: { txHash: `reused:${existing.accountId}`, status: 'success', network: this.rpc.network, at: Date.now() },
            };
          }
        }
      }
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
        registerPreSealedAccountKey(accountId, generated.row);
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
      const target = await this.resolveClaimTarget(input.accountId, storedRow, memKey);
      const signerSecret = seedToNearSecretKey(target.seed);
      const walletPubKey = normalizeNearPublicKey(input.walletPublicKey);
      const receipt = await this.rpc.addFullAccessKey(target.accountId, signerSecret, walletPubKey);
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

  private async resolveClaimTarget(
    requestedAccountId: string,
    storedRow: { accountId: string; ownerAccountId: string; publicKey: string; encryptedSecret: string; kekVersion: number } | null,
    memKey: { seed: Buffer; publicKey: string } | undefined,
  ): Promise<{ accountId: string; seed: Buffer }> {
    if (memKey) return { accountId: requestedAccountId, seed: memKey.seed };
    if (storedRow && storedRow.accountId.endsWith('.mock') && !storedRow.ownerAccountId.endsWith('.mock')) {
      const ownerMem = this.createdKeys.get(storedRow.ownerAccountId);
      if (ownerMem) return { accountId: storedRow.ownerAccountId, seed: ownerMem.seed };
      const ownerRow = await this.prisma?.nearColonyAccount.findUnique({
        where: { accountId: storedRow.ownerAccountId },
      });
      if (ownerRow && ownerRow.encryptedSecret !== 'mock') {
        return { accountId: ownerRow.accountId, seed: this.keys().open(ownerRow) };
      }
    }
    if (storedRow && (storedRow.encryptedSecret === 'mock' || storedRow.accountId.endsWith('.mock'))) {
      const playerRow = await this.prisma?.nearColonyAccount.findFirst({
        where: { slot: 'player', encryptedSecret: { not: 'mock' } },
        orderBy: { createdAt: 'asc' },
      });
      if (playerRow) return { accountId: playerRow.accountId, seed: this.keys().open(playerRow) };
      const firstMem = this.createdKeys.entries().next().value as [string, { seed: Buffer; publicKey: string }] | undefined;
      if (firstMem) return { accountId: firstMem[0], seed: firstMem[1].seed };
      if (storedRow.encryptedSecret === 'mock') {
        throw new NearException('NEAR_UNAVAILABLE', { message: 'Custodial colony account has no testnet key' });
      }
    }
    return { accountId: requestedAccountId, seed: this.keys().open(storedRow!) };
  }

  private async verifyFastAuthJwt(token: string): Promise<SocialLoginResult> {
    const issuer = this.rpc.config.fastAuth.issuer.endsWith('/')
      ? this.rpc.config.fastAuth.issuer
      : `${this.rpc.config.fastAuth.issuer}/`;
    const verified = await verifyOidcJwt({
      token,
      jwksUrl: `${issuer}.well-known/jwks.json`,
      allowedIssuers: [issuer, issuer.replace(/\/$/, '')],
      expectedAudience: this.rpc.config.fastAuth.clientId,
    });
    return { playerId: verified.subject, email: verified.email, isNew: true };
  }

  private keys(): KeyStore {
    if (!this.keyStore) {
      this.keyStore = new KeyStore(loadKekRing(kekEnv((this.envSource as unknown as AppEnv) ?? { NODE_ENV: 'development' })));
    }
    return this.keyStore;
  }
}

function isDirectGoogleIssuer(token: string): boolean {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { iss?: unknown };
    return payload.iss === 'https://accounts.google.com' || payload.iss === 'accounts.google.com';
  } catch {
    return false;
  }
}

function normalizeNearPublicKey(raw: string): string {
  try {
    PublicKey.fromString(raw);
    return raw;
  } catch {
    const seed = createHash('sha256').update(raw).digest();
    const priv = ed25519PrivateKeyFromSeed(seed);
    const pubDer = createPublicKey(priv).export({ format: 'der', type: 'spki' });
    return `ed25519:${encodeBase58(pubDer.subarray(pubDer.length - 32))}`;
  }
}

export const adapter = adapterOf({ port: IdentityPort, kind: 'testnet', useClass: TestnetIdentityAdapter });
