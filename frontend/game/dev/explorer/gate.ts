import { parseWaves } from '@terra/contracts';

/**
 * `?waves=` hides the explorer when it is a ceiling or a list that does not include W06.
 * No param (and `all`) is unrestricted. A spec `parseWaves` rejects counts as off.
 */
export function wavesExcludeW06(search: string): boolean {
  const raw = new URLSearchParams(search).get('waves');
  if (raw === null) return false;
  try {
    return !parseWaves(raw).has('W06');
  } catch {
    return true;
  }
}

/** Off when waves exclude W06, or when `GET /v1/near/health` is 404. Any other status leaves the page on. */
export function explorerIsOff(search: string, healthStatus: number | null): boolean {
  return wavesExcludeW06(search) || healthStatus === 404;
}

/** Status of `GET /v1/near/health`, or null when the request fails. */
export async function nearHealthStatus(fetchImpl: typeof fetch = fetch): Promise<number | null> {
  try {
    return (await fetchImpl('/v1/near/health')).status;
  } catch {
    return null;
  }
}
