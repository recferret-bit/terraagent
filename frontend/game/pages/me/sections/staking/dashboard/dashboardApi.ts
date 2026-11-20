import { StakeProfitsResponse, StakingPerformanceResponse, type PerformanceWindow } from '@terra/contracts';
import type { MeFetchFn } from '../../../api';

export type PerformanceResult =
  | { readonly kind: 'ok'; readonly perf: StakingPerformanceResponse }
  | { readonly kind: 'unavailable'; readonly status: number };

export type ApiAuth = () => string;

const headers = (auth: ApiAuth, json: boolean): Record<string, string> => {
  const token = auth();
  return { Accept: 'application/json', ...(json ? { 'content-type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
};

/** `GET /v1/near/staking/performance`: a 404 (W28 off / not deployed), any non-OK, network error or schema mismatch is `unavailable`. */
export async function fetchPerformance(
  doFetch: MeFetchFn,
  auth: ApiAuth,
  accountId: string,
  window: PerformanceWindow,
): Promise<PerformanceResult> {
  try {
    const url = `/v1/near/staking/performance?accountId=${encodeURIComponent(accountId)}&window=${window}`;
    const res = await doFetch(url, { headers: headers(auth, false) });
    if (!res.ok) return { kind: 'unavailable', status: res.status };
    const parsed = StakingPerformanceResponse.safeParse(await res.json());
    return parsed.success ? { kind: 'ok', perf: parsed.data } : { kind: 'unavailable', status: 422 };
  } catch {
    return { kind: 'unavailable', status: 0 };
  }
}

export interface PostResult {
  readonly ok: boolean;
  readonly status: number;
  readonly body: unknown;
}

export async function postJson(doFetch: MeFetchFn, auth: ApiAuth, path: string, body: unknown): Promise<PostResult> {
  try {
    const res = await doFetch(path, { method: 'POST', headers: headers(auth, true), body: JSON.stringify(body) });
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      /* empty body */
    }
    return { ok: res.ok, status: res.status, body: parsed };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

export const parseProfitsResponse = (body: unknown): StakeProfitsResponse | null => {
  const r = StakeProfitsResponse.safeParse(body);
  return r.success ? r.data : null;
};

/** Best-effort server message out of a Nest-style error body. */
export function apiErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const o = body as { message?: unknown; error?: unknown };
    if (typeof o.message === 'string' && o.message) return o.message;
    if (o.error && typeof o.error === 'object') {
      const m = (o.error as { message?: unknown }).message;
      if (typeof m === 'string' && m) return m;
    }
    if (typeof o.error === 'string' && o.error) return o.error;
  }
  return fallback;
}
