import { Inject, Injectable, Optional } from '@nestjs/common';
import { envFlagTrue } from '@terra/config';
import { PublicKey, nearToYocto } from 'near-api-js';
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
import { Nep413AuthService } from '../../../identity/nep413-auth.service.js';
import { verifyNep413ClaimSignature } from '../../../identity/nep413-verifier.js';
import { KeyStore, loadKekRing } from '../../../keystore/index.js';
import { resolveActiveNearNetwork, resolveNearNetworkConfig } from '../../network/near-network.config.js';
import { NearRpcClient, seedToNearSecretKey } from '../../rpc/near-rpc.client.js';
import {
  assertOAuthProviderMatchesSubject,
  verifyFastAuthPkceCode,
  verifyOidcJwt,
} from './jwks-verifier.js';
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
  private readonly nep413: Nep413AuthService;
  private keyStore: KeyStore | null = null;

  constructor(
    @Optional() @Inject(APP_ENV) env?: AppEnv,
    @Optional() @Inject(PRISMA) prisma?: PrismaClient,
    @Optional() @Inject(Nep413AuthService) nep413?: Nep413AuthService,
  ) {
    this.envSource = (env ?? process.env) as Record<string, string | undefined>;
    this.rpc = new NearRpcClient(resolveNearNetworkConfig(this.envSource, resolveActiveNearNetwork('Identity', this.envSource)));
    this.prisma = databaseEnabled(env) ? (prisma ?? null) : null;
    this.nep413 = nep413 ?? new Nep413AuthService(env);
  }

  async loginSocial(input: SocialLoginInput): Promise<SocialLoginResult> {
    const provider = input.provider.trim().toLowerCase();

    if (provider === 'near-wallet' || input.token.startsWith('nep413:')) {
      const verified = await this.nep413.verifyInlineToken(input.token);
      const preferredName = verified.accountId.includes('.')
        ? (verified.accountId.split('.')[0] || verified.accountId)
        : verified.accountId;
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

    if (
      (provider === 'google' || provider === 'x' || provider === 'email' || provider === 'fastauth' || provider === 'near-auth') &&
      input.token.startsWith('fastauth-code:')
    ) {
      const verified = await verifyFastAuthPkceCode({
        rawToken: input.token,
        issuer: this.rpc.config.fastAuth.issuer,
        clientId: this.rpc.config.fastAuth.clientId,
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

    // 2-segment HMAC token from local/test dev OAuth popup (`google`, `x`, `fastauth`, `email`):
    if (this.envSource.NODE_ENV !== 'production' && input.token.split('.').length === 2 && !input.token.includes(':')) {
      const claims = verifyMockToken(input.token, mockOauthSecret(), Date.now());
      if (claims.provider !== provider) throw new NearException('NEAR_PROVIDER_REJECTED');
      return { playerId: claims.subject, email: claims.email ?? null, isNew: true };
    }

    if (provider === 'email') {
      if (input.token.split('.').length === 3) {
        return this.verifyFastAuthJwt(input.token, provider, true);
      }
      throw new NearException('NEAR_PROVIDER_REJECTED', {
        message: 'Email sign-in requires a verified FastAuth OIDC token or PKCE code',
      });
    }

    if (provider === 'fastauth' || provider === 'near-auth') {
      if (input.token.split('.').length === 3) {
        return this.verifyFastAuthJwt(input.token, provider);
      }
      throw new NearException('NEAR_PROVIDER_REJECTED', {
        message: 'FastAuth login requires a verified OIDC JWT, PKCE code, or NEP-413 challenge signature',
      });
    }

    if (provider === 'google') {
      if (input.token.split('.').length === 3 && !isDirectGoogleIssuer(input.token)) {
        return this.verifyFastAuthJwt(input.token, provider);
      }
      const verified = await verifyOidcJwt({
        token: input.token,
        jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
        allowedIssuers: ['https://accounts.google.com', 'accounts.google.com'],
        expectedAudience: this.rpc.config.googleClientId,
      });
      assertOAuthProviderMatchesSubject(provider, verified.subject, verified.email);
      return {
        playerId: verified.subject,
        email: verified.email,
        ...(verified.preferredName ? { preferredName: verified.preferredName } : {}),
        isNew: true,
      };
    }

    if (provider === 'x' && input.token.split('.').length === 3) {
      return this.verifyFastAuthJwt(input.token, provider);
    }

    throw new NearException('NEAR_PROVIDER_REJECTED', { message: `Unsupported social provider: ${provider}` });
  }

  async createNamedAccount(input: CreateNamedAccountInput): Promise<CreateNamedAccountResult> {
    const forceFactory =
      envFlagTrue(this.envSource.NEAR_USE_PILOTS_FACTORY) || this.envSource.NEAR_USE_PILOTS_FACTORY?.trim() === '1';
    const parentSecret = this.rpc.config.secrets.rootSecretKey;
    const useFactory = forceFactory || input.parent === this.rpc.config.contracts.pilots || !parentSecret;
    const operatorSecret = this.rpc.config.secrets.relayerSecretKey;
    if (useFactory && !operatorSecret) {
      throw new NearException('NEAR_UNAVAILABLE', {
        message: 'Missing NEAR_RELAYER_SECRET_KEY (or NEAR_ROOT_SECRET_KEY) for createNamedAccount',
      });
    }
    const parent = useFactory
      ? (input.parent ?? this.rpc.config.contracts.pilots)
      : (input.parent ?? this.rpc.config.rootAccount);

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
        try {
          const receipt = useFactory
            ? await this.createViaPilotFactory(input.opId, label, parent, generated.row.publicKey, operatorSecret!)
            : await this.rpc.createSubAccount({
                parentAccountId: parent,
                parentSecretKey: parentSecret!,
                newAccountId: accountId,
                publicKey: generated.row.publicKey,
                initialNear: '0.02',
              });
          this.createdKeys.set(accountId, { seed: generated.seed, publicKey: generated.row.publicKey });
          registerPreSealedAccountKey(accountId, generated.row);
          return { accountId, receipt };
        } catch (err) {
          if (err instanceof NearException && (err.errorCode === 'NEAR_NAME_TAKEN' || err.errorCode === 'NEAR_ACCOUNT_EXISTS')) {
            continue;
          }
          throw err;
        }
      }
      throw new NearException('NEAR_NAME_TAKEN');
    });
  }

  private async createViaPilotFactory(
    opId: string,
    label: string,
    factoryContract: string,
    publicKey: string,
    operatorSecret: string,
  ): Promise<ChainReceipt> {
    const { receipt, outcome } = await this.rpc.call({
      signerAccountId: this.rpc.config.accounts.relayer,
      signerSecretKey: operatorSecret,
      contractId: factoryContract,
      methodName: 'create_pilot_account',
      args: { op_id: `${opId}:${label}`, label, public_key: publicKey },
      gasTgas: 80,
      depositYocto: nearToYocto('0.02'),
    });
    const rawSuccess =
      outcome && typeof outcome.status === 'object' && outcome.status !== null && 'SuccessValue' in outcome.status
        ? outcome.status.SuccessValue
        : undefined;
    if (typeof rawSuccess === 'string' && rawSuccess.length > 0) {
      const decoded = Buffer.from(rawSuccess, 'base64').toString('utf8');
      if (decoded.includes('ERR:NEAR_NAME_TAKEN')) {
        throw new NearException('NEAR_NAME_TAKEN', { message: decoded });
      }
    }
    return receipt;
  }

  async claimAccount(input: ClaimAccountInput): Promise<ChainReceipt> {
    return this.claimCache.run(input.opId, async () => {
      const storedRow = this.prisma?.nearColonyAccount
        ? await this.prisma.nearColonyAccount.findUnique({ where: { accountId: input.accountId } })
        : null;
      const memKey = this.createdKeys.get(input.accountId);
      if (!storedRow && !memKey) {
        throw new NearException('NEAR_UNAVAILABLE', { message: 'Custodial colony account not found for claim' });
      }
      if (storedRow?.encryptedSecret === 'claimed' && !memKey) {
        if (storedRow.claimedByAccountId === input.walletAccountId) {
          return {
            txHash: `claimed:${storedRow.accountId}`,
            status: 'success',
            network: this.rpc.network,
            at: (storedRow.claimedAt ?? new Date()).getTime(),
          };
        }
        throw new NearException('NEAR_NOT_OWNER', {
          message: 'Colony account has already been claimed to self-custody',
        });
      }
      if (!input.walletSignature) {
        throw new NearException('NEAR_PROVIDER_REJECTED', {
          message: 'NEP-413 walletSignature is required to claim a custodial NEAR account',
        });
      }

      const target = await this.resolveClaimTarget(input.accountId, storedRow, memKey);
      const allowedRecipients = Array.from(
        new Set([this.rpc.config.rootAccount, input.accountId, target.accountId, 'terraagent.app']),
      );
      verifyNep413ClaimSignature({
        signature: input.walletSignature,
        expectedWalletAccountId: input.walletAccountId,
        expectedPublicKey: input.walletPublicKey,
        allowedRecipients,
        network: this.rpc.network,
      });
      await this.rpc.verifyFullAccessKeyOnChain(input.walletAccountId, input.walletSignature.publicKey);

      const signerSecret = seedToNearSecretKey(target.seed);
      const walletPubKey = normalizeNearPublicKey(input.walletSignature.publicKey);

      if (this.rpc.network === 'mainnet' && target.publicKey !== walletPubKey) {
        await this.revokeMainnetIntentsKeyBestEffort(target.accountId, signerSecret, target.publicKey);
      }

      const receipt = await this.rpc.rotateCustodialKeys({
        accountId: target.accountId,
        currentSecretKey: signerSecret,
        currentPublicKey: target.publicKey,
        newFullAccessPublicKey: walletPubKey,
      });

      this.createdKeys.delete(target.accountId);
      this.createdKeys.delete(input.accountId);
      if (this.prisma?.nearColonyAccount && storedRow) {
        const updatedAccounts = Array.from(new Set([input.accountId, target.accountId]));
        await this.prisma.nearColonyAccount.updateMany({
          where: { accountId: { in: updatedAccounts } },
          data: {
            publicKey: walletPubKey,
            encryptedSecret: 'claimed',
            claimedAt: storedRow.claimedAt ?? new Date(),
            claimedByAccountId: input.walletAccountId,
          },
        });
      }
      return receipt;
    });
  }

  private async revokeMainnetIntentsKeyBestEffort(
    accountId: string,
    signerSecret: string,
    oldPublicKey: string,
  ): Promise<void> {
    try {
      await this.rpc.call({
        signerAccountId: accountId,
        signerSecretKey: signerSecret,
        contractId: this.rpc.config.contracts.intents,
        methodName: 'remove_public_key',
        args: { public_key: oldPublicKey },
        gasTgas: 30,
        depositYocto: 1n,
      });
    } catch {
      /* key was never registered on intents.near or already removed */
    }
  }

  private async resolveClaimTarget(
    requestedAccountId: string,
    storedRow: {
      accountId: string;
      playerId?: string;
      ownerAccountId: string;
      publicKey: string;
      encryptedSecret: string;
      kekVersion: number;
    } | null,
    memKey: { seed: Buffer; publicKey: string } | undefined,
  ): Promise<{ accountId: string; seed: Buffer; publicKey: string }> {
    if (memKey) return { accountId: requestedAccountId, seed: memKey.seed, publicKey: memKey.publicKey };
    if (storedRow && storedRow.ownerAccountId && storedRow.ownerAccountId !== storedRow.accountId) {
      const subExists = !storedRow.accountId.endsWith('.mock') && (await this.rpc.accountExists(storedRow.accountId));
      if (!subExists && !storedRow.ownerAccountId.endsWith('.mock')) {
        const ownerMem = this.createdKeys.get(storedRow.ownerAccountId);
        if (ownerMem) return { accountId: storedRow.ownerAccountId, seed: ownerMem.seed, publicKey: ownerMem.publicKey };
        const ownerRow = await this.prisma?.nearColonyAccount.findUnique({
          where: { accountId: storedRow.ownerAccountId },
        });
        if (ownerRow && ownerRow.encryptedSecret !== 'mock' && ownerRow.encryptedSecret !== 'claimed') {
          return { accountId: ownerRow.accountId, seed: this.keys().open(ownerRow), publicKey: ownerRow.publicKey };
        }
      }
    }
    if (storedRow && (storedRow.encryptedSecret === 'mock' || storedRow.accountId.endsWith('.mock'))) {
      if (storedRow.playerId) {
        const playerRow = await this.prisma?.nearColonyAccount.findFirst({
          where: { playerId: storedRow.playerId, slot: 'player', encryptedSecret: { notIn: ['mock', 'claimed'] } },
          orderBy: { createdAt: 'asc' },
        });
        if (playerRow) {
          return { accountId: playerRow.accountId, seed: this.keys().open(playerRow), publicKey: playerRow.publicKey };
        }
      }
      throw new NearException('NEAR_UNAVAILABLE', { message: 'Custodial colony account has no testnet key' });
    }
    return { accountId: requestedAccountId, seed: this.keys().open(storedRow!), publicKey: storedRow!.publicKey };
  }

  private async verifyFastAuthJwt(token: string, provider: string, requireEmail = false): Promise<SocialLoginResult> {
    const issuer = this.rpc.config.fastAuth.issuer.endsWith('/')
      ? this.rpc.config.fastAuth.issuer
      : `${this.rpc.config.fastAuth.issuer}/`;
    const verified = await verifyOidcJwt({
      token,
      jwksUrl: `${issuer}.well-known/jwks.json`,
      allowedIssuers: [issuer, issuer.replace(/\/$/, '')],
      expectedAudience: this.rpc.config.fastAuth.clientId,
      requireEmail,
    });
    assertOAuthProviderMatchesSubject(provider, verified.subject, verified.email);
    return {
      playerId: verified.subject,
      email: verified.email,
      ...(verified.preferredName ? { preferredName: verified.preferredName } : {}),
      isNew: true,
    };
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
    return PublicKey.fromString(raw.trim()).toString();
  } catch {
    throw new NearException('NEAR_PROVIDER_REJECTED', { message: 'Invalid NEAR public key format' });
  }
}

export const adapter = adapterOf({ port: IdentityPort, kind: 'testnet', useClass: TestnetIdentityAdapter });
export const mainnetAdapter = adapterOf({ port: IdentityPort, kind: 'mainnet', useClass: TestnetIdentityAdapter });
