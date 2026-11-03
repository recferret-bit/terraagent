import { RelayRetryResponse, RelayStatusResponse } from '@terra/contracts';
import type { FetchLike } from './bootOnline';

export interface RelayWatch {
  /** `GET /v1/near/relay` with the pilot bearer. */
  poll(): Promise<{ state: 'none' | 'pending' | 'settled' | 'failed'; opId?: string }>;
  /** `POST /v1/near/relay/retry`, then the caller polls again. */
  retry(): Promise<{ state: 'pending' }>;
}

function headers(token: string, jsonBody: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  if (token) out.Authorization = `Bearer ${token}`;
  if (jsonBody) out['content-type'] = 'application/json';
  return out;
}

async function call(doFetch: FetchLike, token: () => string, path: string, method: 'GET' | 'POST'): Promise<unknown> {
  const res = await doFetch(path, {
    method,
    headers: headers(token(), method === 'POST'),
    credentials: 'include',
    body: method === 'POST' ? '{}' : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status}`);
  return res.json();
}

/** Authenticated poll of the colony deposit. The spec passes the session `fetch`. */
export function createRelayWatch(doFetch: FetchLike, token: () => string): RelayWatch {
  return {
    async poll() {
      const parsed = RelayStatusResponse.safeParse(await call(doFetch, token, '/v1/near/relay', 'GET'));
      if (!parsed.success) throw new Error('GET /v1/near/relay: unexpected answer');
      return parsed.data;
    },
    async retry() {
      const parsed = RelayRetryResponse.safeParse(await call(doFetch, token, '/v1/near/relay/retry', 'POST'));
      if (!parsed.success) throw new Error('POST /v1/near/relay/retry: unexpected answer');
      return parsed.data;
    },
  };
}
