import { readApiErrorCode } from '../treasury/councilApi';

export type BountyFetch = (input: string, init?: RequestInit) => Promise<Response>;

export { readApiErrorCode };

export interface BountyPostPayload {
  readonly colonyId: string;
  readonly colonyIndex: number;
  readonly target: Record<string, unknown>;
  readonly reward: { readonly resource: string; readonly amount: number };
  readonly expiresAt: number;
}

export function bountiesUrl(planetId: string): string {
  return `/v1/bounties/${encodeURIComponent(planetId)}`;
}

export function claimUrl(planetId: string, bountyId: string): string {
  return `${bountiesUrl(planetId)}/${encodeURIComponent(bountyId)}/claim`;
}

function headers(token: string | null, json: boolean): HeadersInit {
  const out: Record<string, string> = {};
  if (json) out['content-type'] = 'application/json';
  if (token) out.authorization = `Bearer ${token}`;
  return out;
}

export function fetchBounties(planetId: string, token: string | null, fetchImpl: BountyFetch): Promise<Response> {
  return fetchImpl(bountiesUrl(planetId), { headers: headers(token, false), credentials: 'include' });
}

export function postBounty(
  planetId: string,
  body: BountyPostPayload,
  token: string | null,
  fetchImpl: BountyFetch,
): Promise<Response> {
  return fetchImpl(bountiesUrl(planetId), {
    method: 'POST',
    headers: headers(token, true),
    credentials: 'include',
    body: JSON.stringify(body),
  });
}

export function postClaim(
  planetId: string,
  bountyId: string,
  colony: { colonyId: string; colonyIndex: number },
  token: string | null,
  fetchImpl: BountyFetch,
): Promise<Response> {
  return fetchImpl(claimUrl(planetId, bountyId), {
    method: 'POST',
    headers: headers(token, true),
    credentials: 'include',
    body: JSON.stringify(colony),
  });
}
