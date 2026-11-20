import { StakingPrestigeResponse } from '@terra/contracts/staking/performance';

export type PrestigeFetch = (input: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

/**
 * `GET /v1/near/staking/prestige?planetId=…` (W28-03). Cosmetic only: any answer that is not a well-formed 200 means
 * "no prestige" (404 = W28 off or the endpoint is missing, other statuses, a network error, malformed JSON, a body
 * that fails the contract). It never throws and never retries by itself.
 */
export async function fetchPrestige(
  planetId: string,
  doFetch: PrestigeFetch = (i, init) => fetch(i, init),
): Promise<StakingPrestigeResponse | null> {
  if (!planetId) return null;
  try {
    const res = await doFetch(`/v1/near/staking/prestige?planetId=${encodeURIComponent(planetId)}`, { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const parsed = StakingPrestigeResponse.safeParse(await res.json());
    return parsed.success && parsed.data.planetId === planetId ? parsed.data : null;
  } catch {
    return null;
  }
}
