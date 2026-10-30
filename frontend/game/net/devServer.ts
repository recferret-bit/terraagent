/** Server dev command by name (`POST /v1/dev/commands/:name`); resolves with the JSON result, rejects with a `DevServerError`. */
export type DevServer = (name: string, args?: unknown) => Promise<unknown>;

export class DevServerError extends Error {
  constructor(readonly code: string, message: string) { super(`${code}: ${message}`); this.name = 'DevServerError'; }
}

/** Service for hosts with no server (`?host=local`): every server-only command reports `host_unavailable`. */
export const hostUnavailableDevServer: DevServer = async (name) => {
  throw new DevServerError('host_unavailable', `"${name}" needs the game server; not available on this host`);
};

/** Default online implementation; `fetchImpl` and `base` are injectable (the local host and tests swap them). */
export const httpDevServer = (base = '', fetchImpl: typeof fetch = (...a) => fetch(...a)): DevServer => async (name, args = {}) => {
  const res = await fetchImpl(`${base}/v1/dev/commands/${encodeURIComponent(name)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args),
  });
  const text = await res.text();
  let body: unknown = text;
  try { body = text ? JSON.parse(text) : null; } catch { /* keep text */ }
  if (res.ok) return body;
  const msg = typeof body === 'object' && body !== null && 'message' in body ? String((body as { message: unknown }).message) : text.slice(0, 200);
  throw new DevServerError(res.status === 404 ? 'not_found' : `http_${res.status}`, `${res.status} ${msg}`.trim());
};
