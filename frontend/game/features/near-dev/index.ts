import { defineFeature, type DevCommandDef } from '../../core/registry/types';
import '../../net/services';
import { serverFor, usage } from '../shared/devCommand';

export { serverFor, usage };

const FAIL_USAGE = 'near.mock.fail <port> <rate>';
const LATENCY_USAGE = 'near.mock.latency <port> <minMs> <maxMs>';
const RESET_USAGE = 'account.reset <player>';
const UPGRADE_USAGE = 'account.upgrade <provider> <subject>';
const PORTS_USAGE = 'near.ports';
const QUOTE_USAGE = 'near.quote [amountInBaseUnits]';

function wholeMs(raw: string, line: string): number {
  if (!/^(0|[1-9]\d*)$/.test(raw)) usage(line);
  const n = Number(raw);
  if (!Number.isSafeInteger(n)) usage(line);
  return n;
}

const fail: DevCommandDef = {
  name: 'near.mock.fail',
  help: `${FAIL_USAGE}  Server: set how often one mock port fails (0..1; 0 forces success)`,
  async run(a, ctx) {
    if (a.length !== 2) usage(FAIL_USAGE);
    const port = a[0] ?? '';
    const rate = Number(a[1]);
    if (port.length === 0 || a[1]?.trim() === '' || !Number.isFinite(rate) || rate < 0 || rate > 1) usage(FAIL_USAGE);
    await serverFor(ctx, 'near.mock.fail')('near.mock.fail', { port, rate });
    return `fail rate for ${port} is ${rate}`;
  },
};

const latency: DevCommandDef = {
  name: 'near.mock.latency',
  help: `${LATENCY_USAGE}  Server: set the mock latency range in ms for one port`,
  async run(a, ctx) {
    if (a.length !== 3) usage(LATENCY_USAGE);
    const port = a[0] ?? '';
    if (port.length === 0) usage(LATENCY_USAGE);
    const minMs = wholeMs(a[1] ?? '', LATENCY_USAGE);
    const maxMs = wholeMs(a[2] ?? '', LATENCY_USAGE);
    if (maxMs < minMs) usage(LATENCY_USAGE);
    await serverFor(ctx, 'near.mock.latency')('near.mock.latency', { port, minMs, maxMs });
    return `latency for ${port} is ${minMs}..${maxMs} ms`;
  },
};

const reset: DevCommandDef = {
  name: 'account.reset',
  help: `${RESET_USAGE}  Server: drop sessions for a player id or handle (the player stays)`,
  async run(a, ctx) {
    if (a.length !== 1 || !a[0]) usage(RESET_USAGE);
    const player = a[0];
    const r = (await serverFor(ctx, 'account.reset')('account.reset', { player })) as { playerId?: string };
    return `reset ${r.playerId ?? player}: sessions cleared`;
  },
};

const upgrade: DevCommandDef = {
  name: 'account.upgrade',
  help: `${UPGRADE_USAGE}  Server: sign in a mock subject (google or x) and print the player id`,
  async run(a, ctx) {
    if (a.length !== 2 || !a[0] || !a[1]) usage(UPGRADE_USAGE);
    const provider = a[0];
    const subject = a[1];
    if (provider !== 'google' && provider !== 'x') usage(UPGRADE_USAGE);
    const r = (await serverFor(ctx, 'account.upgrade')('account.upgrade', { provider, subject })) as { playerId?: string; accountId?: string };
    return `${provider} ${subject} → ${r.playerId ?? '?'} ${r.accountId ?? ''}`.trim();
  },
};

const ports: DevCommandDef = {
  name: 'near.ports',
  help: `${PORTS_USAGE}  Server: show active NEAR_MODE, RPC health, and the 11-port adapter matrix`,
  async run(a, ctx) {
    if (a.length > 0) usage(PORTS_USAGE);
    if (ctx.host !== 'server') return 'error: host_unavailable: near.ports requires the game server';
    const res = await fetch('/v1/near/status', { headers: { accept: 'application/json' } });
    if (!res.ok) return `error: status HTTP ${res.status}`;
    const body = (await res.json()) as {
      nearMode: string;
      rootAccount: string;
      health?: { ok: boolean; latencyMs?: number };
      ports?: ReadonlyArray<{ port: string; mode: string; target: string }>;
    };
    const summary = (body.ports ?? []).map((p) => `${p.port}:${p.mode}`).join(', ');
    return `NEAR_MODE=${body.nearMode} root=${body.rootAccount} rpc=${body.health?.ok ? 'ok' : 'down'}(${body.health?.latencyMs ?? 0}ms) | ${summary}`;
  },
};

const quote: DevCommandDef = {
  name: 'near.quote',
  help: `${QUOTE_USAGE}  Server: request a live NEAR Intents 1Click dry quote`,
  async run(a, ctx) {
    if (a.length > 1) usage(QUOTE_USAGE);
    if (ctx.host !== 'server') return 'error: host_unavailable: near.quote requires the game server';
    const amount = a[0] ?? '1000000000000000000000000';
    const res = await fetch('/v1/near/intents/quote', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ amount }),
    });
    if (!res.ok) return `error: quote HTTP ${res.status}`;
    const q = (await res.json()) as { source: string; amountIn: string; amountOut: string; minAmountOut: string };
    return `quote[${q.source}] in=${q.amountIn} -> out=${q.amountOut} (min=${q.minAmountOut})`;
  },
};

/** Mock-chain, live-testnet port status, and account dev commands. */
export default defineFeature({
  id: 'near-dev',
  wave: 'W06',
  devCommands: [fail, latency, reset, upgrade, ports, quote],
});
