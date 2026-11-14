import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  NearAuthVerifyRequestSchema,
  type NearAuthChallengeRequest,
  type NearAuthChallengeResponse,
  type NearAuthVerifyRequest,
} from '@terra/contracts';
import { PublicKey } from 'near-api-js';
import { verifyMessage } from 'near-api-js/nep413';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { NearException } from '../domain/errors.js';
import { resolveActiveNearNetwork, resolveNearNetworkConfig } from '../infrastructure/network/near-network.config.js';
import { formatErrorText, isDeterministicChainError, toNearException } from '../infrastructure/rpc/near-error-map.js';
import { NearRpcClient } from '../infrastructure/rpc/near-rpc.client.js';
import { decodeBase58 } from '../keystore/base58.js';
import { validateCallbackUrlCandidates } from './nep413-verifier.js';

export { validateCallbackUrlCandidates };

const CHALLENGE_TTL_MS = 5 * 60_000;
const MAX_CHALLENGES = 4096;
const IMPLICIT_ACCOUNT_RE = /^[0-9a-f]{64}$/;
const NAMED_ACCOUNT_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

interface StoredNep413Challenge {
  readonly challengeId: string;
  readonly message: string;
  readonly nonceBytes: Uint8Array;
  readonly nonceBase64: string;
  readonly recipient: string;
  readonly network: 'testnet' | 'mainnet';
  readonly expiresAt: number;
  used: boolean;
}

export interface VerifiedNep413Account {
  readonly accountId: string;
  readonly publicKey: string;
  readonly network: 'testnet' | 'mainnet';
  readonly walletId?: string;
}

function assertAccountMatchesNetwork(accountId: string, network: 'testnet' | 'mainnet'): void {
  if (!NAMED_ACCOUNT_RE.test(accountId) || accountId.length < 2 || accountId.length > 64) {
    throw new NearException('NEAR_PROVIDER_REJECTED', { message: 'Invalid NEAR account ID format' });
  }
  if (accountId.endsWith('.mock')) {
    throw new NearException('NEAR_PROVIDER_REJECTED', { message: 'Mock NEAR accounts cannot authenticate via NEP-413' });
  }
  if (IMPLICIT_ACCOUNT_RE.test(accountId)) return;

  if (network === 'testnet') {
    if (/\.(near|tg|sweat)$/i.test(accountId) || accountId === 'aurora') {
      throw new NearException('NEAR_PROVIDER_REJECTED', {
        message: 'Mainnet accounts are rejected on NEAR Testnet; switch your wallet to Testnet',
      });
    }
    if (!accountId.endsWith('.testnet') || accountId.length <= '.testnet'.length) {
      throw new NearException('NEAR_PROVIDER_REJECTED', {
        message: 'Only NEAR Testnet (.testnet or implicit 64-hex) accounts are accepted',
      });
    }
    return;
  }

  const validMainnetNamed =
    (/\.(near|tg|sweat)$/i.test(accountId) && accountId.split('.')[0]!.length >= 1) || accountId === 'aurora';
  if (accountId.endsWith('.testnet') || !validMainnetNamed) {
    throw new NearException('NEAR_PROVIDER_REJECTED', {
      message: 'Only NEAR Mainnet (.near, .tg, .sweat, or implicit 64-hex) accounts are accepted',
    });
  }
}

function decodeNep413Signature(rawSignature: string): Uint8Array {
  const trimmed = rawSignature.trim();
  let bytes: Uint8Array;
  if (trimmed.startsWith('ed25519:') || trimmed.startsWith('secp256k1:')) {
    const encoded = trimmed.slice(trimmed.indexOf(':') + 1).trim();
    if (!encoded) {
      throw new NearException('NEAR_PROVIDER_REJECTED', { message: 'Empty prefixed NEP-413 signature' });
    }
    try {
      bytes = decodeBase58(encoded);
    } catch {
      throw new NearException('NEAR_PROVIDER_REJECTED', { message: 'Invalid base58 NEP-413 signature encoding' });
    }
  } else {
    const stdBase64 = trimmed.replace(/-/g, '+').replace(/_/g, '/');
    bytes = new Uint8Array(Buffer.from(stdBase64, 'base64'));
  }
  if (bytes.length !== 64 && bytes.length !== 65) {
    throw new NearException('NEAR_PROVIDER_REJECTED', {
      message: `Invalid NEP-413 signature byte length (${bytes.length})`,
    });
  }
  return bytes;
}

function isRpcMissingOrKeyError(err: unknown): boolean {
  const text = formatErrorText(err).toLowerCase();
  return (
    text.includes('doesnotexist') ||
    text.includes('does not exist') ||
    text.includes('unknown_account') ||
    text.includes('unknown_access_key') ||
    text.includes('access key') ||
    text.includes('fullaccess') ||
    text.includes('signature verification failed') ||
    text.includes('invalid public key') ||
    text.includes('unsupported public key')
  );
}

/**
 * Server-side NEP-413 challenge store and on-chain `FullAccess` verifier (`NEAR.md` §3).
 * Uses `verifyMessage` from `near-api-js/nep413` at `final` finality against NEAR Testnet RPC.
 */
@Injectable()
export class Nep413AuthService {
  private readonly challenges = new Map<string, StoredNep413Challenge>();
  private readonly rpc: NearRpcClient;

  constructor(@Optional() @Inject(APP_ENV) env?: AppEnv) {
    const envMap = (env ?? process.env) as Record<string, string | undefined>;
    const targetNetwork = resolveActiveNearNetwork('Identity', envMap);
    this.rpc = new NearRpcClient(resolveNearNetworkConfig(envMap, targetNetwork));
  }

  issueChallenge(input?: NearAuthChallengeRequest, now = Date.now()): NearAuthChallengeResponse {
    this.pruneExpired(now);
    const nonceBuf = randomBytes(32);
    const nonceBase64 = nonceBuf.toString('base64');
    const challengeId = `ch_${randomBytes(20).toString('hex')}`;
    const recipient = this.rpc.config.rootAccount;
    const network = this.rpc.network;
    const action = input?.intent === 'signup' ? 'Create & link Pilot on TerraAgent' : 'Sign in to TerraAgent';
    const issuedIso = new Date(now).toISOString();
    const message = `${action}\nNetwork: ${network}\nRecipient: ${recipient}\nChallenge: ${challengeId}\nIssued At: ${issuedIso}`;
    const expiresAt = now + CHALLENGE_TTL_MS;

    this.challenges.set(challengeId, {
      challengeId,
      message,
      nonceBytes: new Uint8Array(nonceBuf),
      nonceBase64,
      recipient,
      network,
      expiresAt,
      used: false,
    });
    return { challengeId, message, nonce: nonceBase64, recipient, network, expiresAt };
  }

  async verifyInlineToken(rawToken: string): Promise<VerifiedNep413Account> {
    if (!rawToken.startsWith('nep413:')) {
      throw new NearException('NEAR_PROVIDER_REJECTED', { message: 'Expected nep413 signed authentication payload' });
    }
    let decodedJson: unknown;
    try {
      decodedJson = JSON.parse(Buffer.from(rawToken.slice('nep413:'.length), 'base64url').toString('utf8'));
    } catch {
      throw new NearException('NEAR_PROVIDER_REJECTED', { message: 'Malformed nep413 authentication token' });
    }
    const parsed = NearAuthVerifyRequestSchema.safeParse(decodedJson);
    if (!parsed.success) {
      throw new NearException('NEAR_PROVIDER_REJECTED', { message: 'Incomplete nep413 authentication payload' });
    }
    return this.verifyChallenge(parsed.data);
  }

  async verifyChallenge(req: NearAuthVerifyRequest, now = Date.now()): Promise<VerifiedNep413Account> {
    const entry = this.consumeChallenge(req.challengeId, now);
    const accountId = req.accountId.trim().toLowerCase();
    assertAccountMatchesNetwork(accountId, entry.network);

    let normalizedPubKey: string;
    try {
      normalizedPubKey = PublicKey.fromString(req.publicKey.trim()).toString();
    } catch {
      throw new NearException('NEAR_PROVIDER_REJECTED', { message: 'Invalid NEAR public key format' });
    }
    const signature = decodeNep413Signature(req.signature);
    const callbackUrlCandidates = validateCallbackUrlCandidates(req.callbackUrl);

    await this.verifyOnChainNep413({
      accountId,
      publicKey: normalizedPubKey,
      signature,
      message: entry.message,
      nonce: entry.nonceBytes,
      recipient: entry.recipient,
      callbackUrlCandidates,
    });

    return {
      accountId,
      publicKey: normalizedPubKey,
      network: entry.network,
      ...(req.walletId ? { walletId: req.walletId } : {}),
    };
  }

  private consumeChallenge(challengeId: string, now: number): StoredNep413Challenge {
    const entry = this.challenges.get(challengeId);
    if (!entry) {
      throw new NearException('NEAR_PROVIDER_REJECTED', { message: 'Invalid or unknown NEAR sign-in challenge' });
    }
    this.challenges.delete(challengeId);
    if (entry.used || now > entry.expiresAt) {
      throw new NearException('NEAR_PROVIDER_REJECTED', { message: 'NEAR sign-in challenge expired; please try again' });
    }
    entry.used = true;
    return entry;
  }

  private async verifyOnChainNep413(params: {
    readonly accountId: string;
    readonly publicKey: string;
    readonly signature: Uint8Array;
    readonly message: string;
    readonly nonce: Uint8Array;
    readonly recipient: string;
    readonly callbackUrlCandidates: readonly (string | undefined)[];
  }): Promise<void> {
    let cachedKeyPromise: Promise<unknown> | null = null;
    const finalProvider = {
      viewAccessKey: ({ accountId, publicKey }: { accountId: string; publicKey: { toString(): string } | string }) => {
        if (!cachedKeyPromise) {
          const pkStr = typeof publicKey === 'string' ? publicKey : publicKey.toString();
          cachedKeyPromise = this.rpc.withFailover((p) =>
            p.viewAccessKey({ accountId, publicKey: pkStr, finalityQuery: { finality: 'final' } }),
          );
        }
        return cachedKeyPromise;
      },
    };

    let lastErr: unknown;
    for (const candidateUrl of params.callbackUrlCandidates) {
      try {
        await verifyMessage({
          signerAccountId: params.accountId,
          signerPublicKey: params.publicKey,
          payload: {
            message: params.message,
            nonce: params.nonce,
            recipient: params.recipient,
            ...(candidateUrl !== undefined ? { callbackUrl: candidateUrl } : {}),
          },
          signature: params.signature,
          provider: finalProvider as never,
        });
        return;
      } catch (err) {
        lastErr = err;
        if (!formatErrorText(err).includes('Signature verification failed')) {
          this.throwMappedVerifyError(err);
        }
      }
    }
    this.throwMappedVerifyError(lastErr);
  }

  private throwMappedVerifyError(err: unknown): never {
    if (err instanceof NearException) throw err;
    if (isRpcMissingOrKeyError(err) || isDeterministicChainError(err)) {
      throw new NearException('NEAR_PROVIDER_REJECTED', {
        message: formatErrorText(err).slice(0, 200) || 'NEP-413 signature or FullAccess key verification failed',
      });
    }
    throw toNearException(err);
  }

  private pruneExpired(now: number): void {
    for (const [id, item] of this.challenges) {
      if (item.used || now > item.expiresAt) {
        this.challenges.delete(id);
      }
    }
    while (this.challenges.size >= MAX_CHALLENGES) {
      const oldestKey = this.challenges.keys().next().value;
      if (!oldestKey) break;
      this.challenges.delete(oldestKey);
    }
  }
}
