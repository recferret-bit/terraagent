import type { LedgerView } from '@terra/sim';

/** Server dev command by name (`POST /v1/dev/commands/:name`); resolves with the JSON result, rejects with a `DevServerError`. */
export type DevServer = (name: string, args?: unknown) => Promise<unknown>;

export class DevServerError extends Error {
  constructor(readonly code: string, message: string) { super(`${code}: ${message}`); this.name = 'DevServerError'; }
}

/** Service for hosts with no server (`?host=local`): every server-only command reports `host_unavailable`. */
export const hostUnavailableDevServer: DevServer = async (name) => {
  throw new DevServerError('host_unavailable', `"${name}" needs the game server; not available on this host`);
};

/** JSON body of a dev route; a non-2xx status becomes a `DevServerError` (`not_found` for 404, else `http_<status>`). */
async function readDevReply(res: Response): Promise<unknown> {
  const text = await res.text();
  let body: unknown = text;
  try { body = text ? JSON.parse(text) : null; } catch { /* keep text */ }
  if (res.ok) return body;
  const msg = typeof body === 'object' && body !== null && 'message' in body ? String((body as { message: unknown }).message) : text.slice(0, 200);
  throw new DevServerError(res.status === 404 ? 'not_found' : `http_${res.status}`, `${res.status} ${msg}`.trim());
}

/** Default online implementation; `fetchImpl` and `base` are injectable (the local host and tests swap them). */
export const httpDevServer = (base = '', fetchImpl: typeof fetch = (...a) => fetch(...a)): DevServer => async (name, args = {}) =>
  readDevReply(await fetchImpl(`${base}/v1/dev/commands/${encodeURIComponent(name)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args),
  }));

/**
 * Host-side resource ledger of one account (`GET /v1/dev/planets/:planetId/ledger?account=&limit=`, or a browser host's
 * `PlanetJournal.view`): its non-zero balances and the last `limit` journal entries touching it, oldest first. The
 * shared `LedgerView`, so server and browser hosts answer with one shape. Clients never receive the journal through the
 * sim stream; this dev query is the only way to look at it.
 */
export type LedgerReply = LedgerView;

/** Asks the host for an account's ledger (`services.ledgerQuery`). */
export type LedgerQuery = (account: string, limit: number) => Promise<LedgerReply>;

/** Online `ledgerQuery`: the server's dev ledger route for the joined planet. */
export const httpLedgerQuery = (planetId: () => string | null, base = '', fetchImpl: typeof fetch = (...a) => fetch(...a)): LedgerQuery =>
  async (account, limit) => {
    const id = planetId();
    if (!id) throw new DevServerError('not_connected', 'not connected to a planet yet');
    const q = new URLSearchParams({ account, limit: String(limit) });
    return (await readDevReply(await fetchImpl(`${base}/v1/dev/planets/${encodeURIComponent(id)}/ledger?${q.toString()}`))) as LedgerReply;
  };

/** A browser host that keeps the journal in-process (the fallback `LocalHost`). */
interface InProcessLedgerHost { ledger: { view(planetId: string, account: string, limit: number): LedgerReply } }

/**
 * `services.ledgerQuery` of a session: the in-process fallback host when one is attached, else the `?host=local` worker
 * (its `devServer('ledger')`), else the server's dev route for the joined planet.
 */
export function sessionLedgerQuery(inProcess: () => InProcessLedgerHost | null, worker: DevServer | null, planetId: () => string | null): LedgerQuery {
  const online = httpLedgerQuery(planetId);
  return async (account, limit) => {
    const host = inProcess();
    if (host) return host.ledger.view(planetId() ?? 'local', account, limit);
    if (worker) return (await worker('ledger', { account, limit })) as LedgerReply;
    return online(account, limit);
  };
}
