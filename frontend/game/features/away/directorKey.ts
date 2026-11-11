import { DirectorKeyStatusPayload, type AutoTradeLimits } from '@terra/contracts';

export interface DirectorKeyHttp {
  fetchImpl?: typeof fetch;
  accessToken?: () => string | null;
}

/** `POST` adds the key. `DELETE` revokes it. Both answer with `DirectorKeyStatusPayload`. */
export async function requestDirectorKey(
  method: 'POST' | 'DELETE',
  body: { colonyId: string; limits?: AutoTradeLimits },
  http: DirectorKeyHttp,
): Promise<DirectorKeyStatusPayload> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const token = http.accessToken?.();
  if (token) headers.authorization = `Bearer ${token}`;
  const doFetch = http.fetchImpl ?? fetch;
  const res = await doFetch('/v1/near/director-key', {
    method,
    headers,
    credentials: 'include',
    body: JSON.stringify(body),
  });
  return readDirectorKey(res);
}

async function readDirectorKey(res: Response): Promise<DirectorKeyStatusPayload> {
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new Error(httpError(json, res.status));
  const parsed = DirectorKeyStatusPayload.safeParse(json);
  if (!parsed.success) throw new Error('unexpected answer');
  return parsed.data;
}

function httpError(json: unknown, status: number): string {
  if (!json || typeof json !== 'object') return `http ${status}`;
  const row = json as { errorCode?: unknown; error?: { message?: unknown } };
  const message = typeof row.error?.message === 'string' ? row.error.message : '';
  const code = typeof row.errorCode === 'string' ? row.errorCode : '';
  if (code && message) return `${code} ${message}`;
  return code || message || `http ${status}`;
}
