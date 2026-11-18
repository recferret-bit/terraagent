import type { Nep413Signature, PlaceTradeOrderRequest } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { NearException } from '../../near/domain/errors.js';
import {
  consumeNep413NoncePersistent,
  recordNep413Nonce,
  verifyNep413ClaimSignature,
} from '../../near/identity/nep413-verifier.js';
import { nearAdapterFor } from '../../near/infrastructure/adapter-selection.js';
import {
  resolveActiveNearNetwork,
  resolveNearNetworkConfig,
} from '../../near/infrastructure/network/near-network.config.js';
import { NearRpcClient } from '../../near/infrastructure/rpc/near-rpc.client.js';
import type { FullAccessKeyVerifier } from '../../near/staking/staking-signature-guard.js';

const MAX_APPROVED = 4096;
const approvedOrders = new Set<string>();
const KEY_CACHE_TTL_MS = 30_000;
const verifiedOrderKeyCache = new Map<string, number>();

export function markWalletSignedOrder(commandId: string): void {
  const trimmed = commandId.trim();
  if (!trimmed) return;
  if (approvedOrders.size >= MAX_APPROVED) {
    const first = approvedOrders.values().next().value;
    if (first) approvedOrders.delete(first);
  }
  approvedOrders.add(trimmed);
}

export function hasWalletSignedOrder(commandId?: string | null): boolean {
  if (!commandId) return false;
  return approvedOrders.has(commandId.trim());
}

export function clearWalletSignedOrdersForTests(): void {
  approvedOrders.clear();
  verifiedOrderKeyCache.clear();
}

export function expectedWalletOrderMessage(
  planetId: string,
  body: Pick<PlaceTradeOrderRequest, 'side' | 'resource' | 'amount' | 'price'>,
): string {
  return `order:${planetId}:${body.side}:${body.resource}:${body.amount}:${body.price.token}:${body.price.amount}`;
}

async function verifyOrderFullAccessKey(
  accountId: string,
  publicKey: string,
  network: 'testnet' | 'mainnet',
  envMap: Record<string, string | undefined>,
): Promise<void> {
  const now = Date.now();
  const cacheKey = `${network}:${accountId.toLowerCase()}:${publicKey}`;
  const expires = verifiedOrderKeyCache.get(cacheKey);
  if (expires && expires > now) return;

  const cfg = resolveNearNetworkConfig(envMap, network);
  const rpc = new NearRpcClient(cfg);
  await rpc.verifyFullAccessKeyOnChain(accountId, publicKey);
  if (verifiedOrderKeyCache.size > 1024) verifiedOrderKeyCache.clear();
  verifiedOrderKeyCache.set(cacheKey, now + KEY_CACHE_TTL_MS);
}

export async function verifyWalletOrderSignature(params: {
  readonly sig: Nep413Signature;
  readonly planetId: string;
  readonly body: Pick<PlaceTradeOrderRequest, 'side' | 'resource' | 'amount' | 'price'>;
  readonly expectedWalletAccountId: string;
  readonly pinnedPublicKey?: string | null;
  readonly envMap: Record<string, string | undefined>;
  readonly prisma?: PrismaClient | null;
  readonly keyVerifier?: FullAccessKeyVerifier;
}): Promise<void> {
  const expectedMsg = expectedWalletOrderMessage(params.planetId, params.body);
  if (params.sig.message.trim() !== expectedMsg) {
    throw new NearException('NEAR_PROVIDER_REJECTED', {
      status: 401,
      message: `NEP-413 order signature message does not match requested order ("${expectedMsg}")`,
    });
  }

  const adapterMode = nearAdapterFor('Intents', params.envMap);
  if (adapterMode === 'mock' && params.sig.accountId.endsWith('.mock')) {
    return;
  }

  const net = resolveActiveNearNetwork('Intents', params.envMap);
  const cfg = resolveNearNetworkConfig(params.envMap, net);
  verifyNep413ClaimSignature({
    signature: params.sig,
    expectedWalletAccountId: params.expectedWalletAccountId,
    expectedMessagePrefix: expectedMsg,
    allowedRecipients: [cfg.contracts.res, cfg.contracts.intents, 'intents.near', cfg.rootAccount, 'terraagent.app'],
    network: net,
    recordNonce: false,
  });

  const sigPubKey = params.sig.publicKey.trim();
  const pinned = params.pinnedPublicKey?.trim();
  const hasRealPinned = Boolean(pinned && !pinned.includes('mock') && !pinned.includes('custodial'));

  if (params.keyVerifier) {
    await params.keyVerifier(params.expectedWalletAccountId, sigPubKey, net, params.envMap);
  } else if (params.envMap.NODE_ENV === 'test' && hasRealPinned) {
    if (sigPubKey !== pinned) {
      throw new NearException('NEAR_PROVIDER_REJECTED', {
        status: 401,
        message: 'NEP-413 order signature publicKey is not an authorized FullAccess key on wallet',
      });
    }
  } else if (adapterMode !== 'mock') {
    await verifyOrderFullAccessKey(params.expectedWalletAccountId, sigPubKey, net, params.envMap);
  }

  recordNep413Nonce(params.sig);
  await consumeNep413NoncePersistent(params.prisma, params.sig, 'market:placeOrder');
}
