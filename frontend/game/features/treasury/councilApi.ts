import { readApiErrorCode } from '../../core/net/planetHttp';

export type CouncilFetch = (input: string, init?: RequestInit) => Promise<Response>;

export { readApiErrorCode };

export function councilUrl(planetId: string): string {
  return `/v1/near/treasury/${encodeURIComponent(planetId)}`;
}

export function proposeUrl(planetId: string): string {
  return `${councilUrl(planetId)}/proposals`;
}

export function voteUrl(planetId: string, proposalId: string): string {
  return `${proposeUrl(planetId)}/${encodeURIComponent(proposalId)}/vote`;
}

function headers(token: string | null, json: boolean): HeadersInit {
  const out: Record<string, string> = {};
  if (json) out['content-type'] = 'application/json';
  if (token) out.authorization = `Bearer ${token}`;
  return out;
}

export function fetchCouncil(planetId: string, token: string | null, fetchImpl: CouncilFetch): Promise<Response> {
  return fetchImpl(councilUrl(planetId), { headers: headers(token, false), credentials: 'include' });
}

export function postProposal(planetId: string, kind: string, token: string | null, fetchImpl: CouncilFetch): Promise<Response> {
  return fetchImpl(proposeUrl(planetId), {
    method: 'POST',
    headers: headers(token, true),
    credentials: 'include',
    body: JSON.stringify({ kind }),
  });
}

export function postVote(
  planetId: string,
  proposalId: string,
  vote: 'approve' | 'reject',
  token: string | null,
  fetchImpl: CouncilFetch,
): Promise<Response> {
  return fetchImpl(voteUrl(planetId, proposalId), {
    method: 'POST',
    headers: headers(token, true),
    credentials: 'include',
    body: JSON.stringify({ vote }),
  });
}
