import { MarketSnapshotResponse } from '@terra/contracts';

declare module '../core/registry/types' {
  interface FeatureServices {
    /** `GET /v1/market/{planetId}` with the session's bearer (W13-20); rejects on a non-2xx answer. */
    marketSnapshot?: (planetId: string) => Promise<MarketSnapshotResponse>;
  }
}

/** Book snapshot, board, recent trades and (with a token) the caller's orders of one planet. */
export async function fetchMarketSnapshot(planetId: string, token: string | null, fetchImpl: typeof fetch = (...a) => fetch(...a), base = ''): Promise<MarketSnapshotResponse> {
  const res = await fetchImpl(`${base}/v1/market/${encodeURIComponent(planetId)}`, { headers: token ? { authorization: `Bearer ${token}` } : {}, credentials: 'include' });
  if (!res.ok) throw new Error(`market snapshot ${res.status}`);
  return MarketSnapshotResponse.parse(await res.json());
}
