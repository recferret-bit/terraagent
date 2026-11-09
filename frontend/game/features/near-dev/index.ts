import { defineFeature, type DevCommandDef } from '../../core/registry/types';
import '../../net/services';
import { serverFor, usage } from '../shared/devCommand';

export { serverFor, usage };

const FAIL_USAGE = 'near.mock.fail <port> <rate>';
const LATENCY_USAGE = 'near.mock.latency <port> <minMs> <maxMs>';
const RESET_USAGE = 'account.reset <player>';
const UPGRADE_USAGE = 'account.upgrade <provider> <subject>';

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

/** Mock-chain and account dev commands. Both hosts load them; a missing server answers `host_unavailable`. */
export default defineFeature({
  id: 'near-dev',
  wave: 'W06',
  devCommands: [fail, latency, reset, upgrade],
});
