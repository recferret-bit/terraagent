import { NearException } from '../../domain/errors.js';

interface BudgetBucket {
  dayUtc: string;
  spentNear: number;
}

const sharedBuckets = new Map<string, BudgetBucket>();

export function resetRelayerBudgetForTests(): void {
  sharedBuckets.clear();
}

export function getRelayerSpentTodayNear(network: string, relayerAccountId: string, now = new Date()): number {
  const key = `${network}:${relayerAccountId}`;
  const today = now.toISOString().slice(0, 10);
  const bucket = sharedBuckets.get(key);
  if (!bucket || bucket.dayUtc !== today) return 0;
  return bucket.spentNear;
}

/**
 * Shared process-wide UTC-day gas/deposit budget across every `NearRpcClient` instance
 * (`CargoToken`, `DeedNft`, `Escrow`, `Relayer`, `Staking`, etc.) sharing one relayer account.
 */
export function chargeSharedRelayerBudget(params: {
  readonly network: string;
  readonly relayerAccountId: string;
  readonly estimatedNear: number;
  readonly dailyCapNear: number;
  readonly now?: Date;
}): void {
  const key = `${params.network}:${params.relayerAccountId}`;
  const today = (params.now ?? new Date()).toISOString().slice(0, 10);
  let bucket = sharedBuckets.get(key);
  if (!bucket || bucket.dayUtc !== today) {
    bucket = { dayUtc: today, spentNear: 0 };
    sharedBuckets.set(key, bucket);
  }
  if (bucket.spentNear + params.estimatedNear > params.dailyCapNear) {
    throw new NearException('NEAR_UNAVAILABLE', {
      message: 'Chain busy (daily relayer cap reached), will settle automatically.',
    });
  }
  bucket.spentNear += params.estimatedNear;
}
