import { StakingOverviewResponse } from '@terra/contracts';
import type { MeFetchFn } from '../../api';
import { fallbackOverview } from './stakingMath';

export interface OverviewResult {
  readonly overview: StakingOverviewResponse;
  /** True when the overview came from the endpoint; false for the locally computed fallback. */
  readonly live: boolean;
}

/**
 * `GET /v1/near/staking/overview?amount=<X>` (public, unauthenticated). A 404, any non-OK status, a network error or a
 * payload that does not match `StakingOverviewResponse` yields the local fallback (`Est.` price + `Sim APY` badges).
 */
export async function fetchStakingOverview(
  amount: number,
  doFetch: MeFetchFn = (input, init) => fetch(input, init),
): Promise<OverviewResult> {
  try {
    const res = await doFetch(`/v1/near/staking/overview?amount=${encodeURIComponent(String(amount))}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return { overview: fallbackOverview(amount), live: false };
    const parsed = StakingOverviewResponse.safeParse(await res.json());
    if (!parsed.success) return { overview: fallbackOverview(amount), live: false };
    return { overview: parsed.data, live: true };
  } catch {
    return { overview: fallbackOverview(amount), live: false };
  }
}
