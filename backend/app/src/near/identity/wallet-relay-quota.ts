import type { PrismaClient } from '@terra/db';
import { CoreException } from '../../core/errors/index.js';
import { resolveWallet } from '../staking/perks/stake-clock.reader.js';
import { resolveDbStakerPerks } from '../staking/staker-perks.js';

/** Default Tier 0 (`1x`) daily gasless NEP-366 meta-tx allowance shared across a wallet's colonies. */
export const DEFAULT_WALLET_DAILY_RELAY_TX_BASE = 25;

interface WalletRelayBucket {
  dayUtc: string;
  used: number;
}

const walletRelayBuckets = new Map<string, WalletRelayBucket>();

export function resetWalletRelayQuotasForTests(): void {
  walletRelayBuckets.clear();
}

export function resolveWalletRelayBaseCap(env?: Record<string, string | undefined>): number {
  const raw = env?.NEAR_RELAYER_WALLET_DAILY_TX_BASE?.trim();
  if (!raw || !/^\d+$/.test(raw)) return DEFAULT_WALLET_DAILY_RELAY_TX_BASE;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_WALLET_DAILY_RELAY_TX_BASE;
}

/**
 * W28 wallet-shared `NEP-366` gasless relayer quota (`NEAR_STAKING_SPEC` §1, §3):
 * scales `1x -> 2x -> 4x -> 8x -> 15x` by the wallet's staking tier and shares ONE daily bucket across all colonies
 * owned by that wallet/pilot so creating 10 colonies never multiplies sponsored gas.
 */
export async function enforceWalletRelayQuota(params: {
  readonly prisma?: PrismaClient;
  readonly env?: Record<string, string | undefined>;
  readonly w28: boolean;
  readonly playerId: string;
  readonly signerId: string;
  readonly now?: Date;
}): Promise<{ walletKey: string; used: number; cap: number; gasMultiplier: number }> {
  if (!params.w28) {
    return { walletKey: params.playerId, used: 0, cap: Number.MAX_SAFE_INTEGER, gasMultiplier: 1 };
  }
  const baseCap = resolveWalletRelayBaseCap(params.env);
  const wallet = params.prisma
    ? await resolveWallet(params.prisma, { accountId: params.signerId, playerId: params.playerId })
    : { walletKey: params.playerId };
  const perks = await resolveDbStakerPerks(params.prisma, {
    accountId: params.signerId,
    playerId: params.playerId,
    env: params.env,
    w28: true,
  });
  const walletKey = wallet.walletKey !== 'anonymous' ? wallet.walletKey : params.playerId;
  const cap = Math.max(1, Math.floor(baseCap * perks.gasMultiplier));
  const dayUtc = (params.now ?? new Date()).toISOString().slice(0, 10);
  let bucket = walletRelayBuckets.get(walletKey);
  if (!bucket || bucket.dayUtc !== dayUtc) {
    bucket = { dayUtc, used: 0 };
    walletRelayBuckets.set(walletKey, bucket);
  }
  if (bucket.used >= cap) {
    throw new CoreException('RATE_LIMITED', {
      status: 429,
      message: `Daily wallet NEP-366 gasless relay quota reached (${cap}/day at ${perks.gasMultiplier}x). Stake NEAR to scale up to 15x.`,
      details: { walletKey, used: bucket.used, cap, gasMultiplier: perks.gasMultiplier },
    });
  }
  bucket.used += 1;
  return { walletKey, used: bucket.used, cap, gasMultiplier: perks.gasMultiplier };
}
