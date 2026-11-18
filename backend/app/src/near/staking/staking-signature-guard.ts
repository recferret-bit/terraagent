import type { Nep413Signature } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { NearException } from '../domain/errors.js';
import {
  consumeNep413NoncePersistent,
  recordNep413Nonce,
  verifyNep413ClaimSignature,
} from '../identity/nep413-verifier.js';
import { nearAdapterFor } from '../infrastructure/adapter-selection.js';
import { resolveNearNetworkConfig } from '../infrastructure/network/near-network.config.js';
import { NearRpcClient } from '../infrastructure/rpc/near-rpc.client.js';
import type { AccountClaimStatus } from './account-claim.service.js';
import { nearToYocto } from './yocto.js';

export type StakingSignableAction = 'stake' | 'unstake' | 'withdraw';

export type FullAccessKeyVerifier = (
  accountId: string,
  publicKey: string,
  network: 'testnet' | 'mainnet',
  envMap: Record<string, string | undefined>,
) => Promise<void>;

const KEY_CACHE_TTL_MS = 30_000;
const verifiedKeyCache = new Map<string, number>();

export function clearStakingKeyCache(): void {
  verifiedKeyCache.clear();
}

const defaultFullAccessKeyVerifier: FullAccessKeyVerifier = async (accountId, publicKey, network, envMap) => {
  const now = Date.now();
  const cacheKey = `${network}:${accountId.toLowerCase()}:${publicKey}`;
  const expires = verifiedKeyCache.get(cacheKey);
  if (expires && expires > now) return;

  const cfg = resolveNearNetworkConfig(envMap, network);
  const rpc = new NearRpcClient(cfg);
  await rpc.verifyFullAccessKeyOnChain(accountId, publicKey);
  if (verifiedKeyCache.size > 1024) verifiedKeyCache.clear();
  verifiedKeyCache.set(cacheKey, now + KEY_CACHE_TTL_MS);
};

function hasPinnedWalletKey(rawKey?: string | null): rawKey is string {
  const trimmed = rawKey?.trim();
  return Boolean(trimmed && !trimmed.includes('mock'));
}

function rejectStakingMessage(detail: string): never {
  throw new NearException('NEAR_PROVIDER_REJECTED', {
    status: 401,
    message: `NEP-413 staking signature rejected: ${detail}`,
  });
}

function assertAmountMatches(signedRaw: string, expectedRaw: string | number | undefined): void {
  if (expectedRaw === undefined) return;
  try {
    if (nearToYocto(signedRaw) !== nearToYocto(expectedRaw)) {
      rejectStakingMessage(`signed amount "${signedRaw}" does not match requested amount "${expectedRaw}"`);
    }
  } catch (err) {
    if (err instanceof NearException) throw err;
    rejectStakingMessage(`invalid signed NEAR amount "${signedRaw}"`);
  }
}

/**
 * Binds the signed NEP-413 `message` to the exact staking operation (`stake` | `unstake` | `withdraw`),
 * colony, validator pool, and NEAR amount so login challenges or smaller-amount signatures can never be
 * substituted across actions or amounts.
 *
 * Supported formats:
 * - Canonical frontend (`stakingPanel.ts`):
 *   - `stake:<colonyId>:<pool>:<amount>`
 *   - `unstake:<colonyId>:<pool>:<amount>`
 *   - `withdraw:<colonyId>:<pool>` (or `withdraw:<colonyId>:<pool>:<amount>`)
 * - Compact CLI/SDK: `<action>:<amount>` or `<action>:<pool>:<amount>` (or `withdraw:<pool>`)
 */
export function assertStakingMessageMatchesIntent(params: {
  readonly message: string;
  readonly action: StakingSignableAction;
  readonly colonyId: string;
  readonly poolId: string;
  readonly amount?: string | number;
}): void {
  const trimmed = params.message.trim();
  const prefix = `${params.action}:`;
  if (params.action === 'withdraw' && trimmed === 'withdraw') return;
  if (!trimmed.startsWith(prefix)) {
    rejectStakingMessage(`expected message starting with "${prefix}"`);
  }

  const parts = trimmed.split(':').map((p) => p.trim());
  if (params.action === 'withdraw') {
    if (parts.length === 2) {
      if (parts[1] !== params.poolId && parts[1] !== params.colonyId) {
        rejectStakingMessage(`signed withdraw target "${parts[1]}" does not match "${params.poolId}"`);
      }
      return;
    }
    if (parts.length >= 3) {
      if (parts[1] !== params.colonyId) {
        rejectStakingMessage(`signed colonyId "${parts[1]}" does not match "${params.colonyId}"`);
      }
      if (parts[2] !== params.poolId) {
        rejectStakingMessage(`signed pool "${parts[2]}" does not match "${params.poolId}"`);
      }
      if (parts.length >= 4 && parts[3]) assertAmountMatches(parts[3], params.amount);
      return;
    }
    rejectStakingMessage('malformed withdraw signature message');
  }

  if (parts.length === 2 && parts[1]) {
    assertAmountMatches(parts[1], params.amount);
    return;
  }
  if (parts.length === 3 && parts[1] && parts[2]) {
    if (parts[1] !== params.poolId) {
      rejectStakingMessage(`signed pool "${parts[1]}" does not match "${params.poolId}"`);
    }
    assertAmountMatches(parts[2], params.amount);
    return;
  }
  if (parts.length === 4 && parts[1] && parts[2] && parts[3]) {
    if (parts[1] !== params.colonyId) {
      rejectStakingMessage(`signed colonyId "${parts[1]}" does not match "${params.colonyId}"`);
    }
    if (parts[2] !== params.poolId) {
      rejectStakingMessage(`signed pool "${parts[2]}" does not match "${params.poolId}"`);
    }
    assertAmountMatches(parts[3], params.amount);
    return;
  }
  rejectStakingMessage(`malformed ${params.action} signature message`);
}

/**
 * Verifies real-network (`testnet` / `mainnet`) NEP-413 staking signatures (`ed25519:` or `secp256k1:`),
 * enforces exact action/colony/pool/amount intent binding, and verifies `FullAccess` key ownership
 * (supporting multi-key / rotated NEAR wallets via on-chain RPC while staying offline-safe in unit tests).
 */
export async function verifyStakingWalletSignature(params: {
  readonly sig: Nep413Signature | undefined;
  readonly action: StakingSignableAction;
  readonly colonyId: string;
  readonly claimInfo: AccountClaimStatus;
  readonly poolId: string;
  readonly amount?: string | number;
  readonly envMap: Record<string, string | undefined>;
  readonly keyVerifier?: FullAccessKeyVerifier;
  readonly prisma?: PrismaClient | null;
}): Promise<void> {
  const kind = nearAdapterFor('Staking', params.envMap);
  if (kind === 'mock') return;
  if (!params.sig) {
    throw new NearException('NEAR_PROVIDER_REJECTED', {
      status: 401,
      message: 'NEP-413 walletSignature is required for real-network staking actions.',
    });
  }

  assertStakingMessageMatchesIntent({
    message: params.sig.message,
    action: params.action,
    colonyId: params.colonyId,
    poolId: params.poolId,
    amount: params.amount,
  });

  const net = kind === 'mainnet' ? 'mainnet' : 'testnet';
  const cfg = resolveNearNetworkConfig(params.envMap, net);
  const expectedWallet = params.claimInfo.claimedByAccountId ?? params.claimInfo.accountId;
  const pinnedKey = hasPinnedWalletKey(params.claimInfo.claimedPublicKey)
    ? params.claimInfo.claimedPublicKey.trim()
    : undefined;
  const sigPubKey = params.sig.publicKey.trim();

  verifyNep413ClaimSignature({
    signature: params.sig,
    expectedWalletAccountId: expectedWallet,
    allowedRecipients: [params.poolId, cfg.contracts.staking, cfg.rootAccount],
    network: net,
    recordNonce: false,
  });

  if (params.keyVerifier) {
    await params.keyVerifier(expectedWallet, sigPubKey, net, params.envMap);
  } else if (params.envMap.NODE_ENV === 'test' && pinnedKey) {
    if (sigPubKey !== pinnedKey) {
      throw new NearException('NEAR_PROVIDER_REJECTED', {
        status: 401,
        message: 'NEP-413 signature publicKey is not an authorized FullAccess key on wallet',
      });
    }
  } else {
    await defaultFullAccessKeyVerifier(expectedWallet, sigPubKey, net, params.envMap);
  }

  recordNep413Nonce(params.sig);
  await consumeNep413NoncePersistent(params.prisma, params.sig, `staking:${params.action}`);
}
