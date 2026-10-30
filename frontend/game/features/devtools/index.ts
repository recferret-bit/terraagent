import { defineFeature, type DevCommandDef, type FeatureContext } from '../../core/registry/types';
import { DevServerError } from '../../net/devServer';
import { numArg } from '../../dev/console/parse';
import type { CommandResult } from '../../net/commandBus';
import '../../net/services';

/** Dev console commands that talk to the game: sim `dev.*` commands over the transport, server dev commands over HTTP. */

async function sim(ctx: FeatureContext, kind: string, args: unknown): Promise<CommandResult> {
  const send = ctx.services.sendCommand;
  return send ? send(kind, args) : { ok: false, code: 'not_connected', detail: 'no game server connection' };
}

function ackText(kind: string, r: CommandResult): string {
  if (r.ok) return `${kind} ok, applied at tick ${r.appliedAtTick}`;
  throw new Error(`${kind} rejected: ${r.code}${r.detail ? ` (${r.detail})` : ''}`);
}

const simCommand = (name: string, help: string, args: (a: string[]) => unknown): DevCommandDef => ({
  name, help,
  async run(a, ctx) { return ackText(`dev.${name}`, await sim(ctx, `dev.${name}`, args(a))); },
});

const chainPing: DevCommandDef = {
  name: 'chain.ping',
  help: 'Server: write a ping receipt through the mock chain, print its mock: hash',
  async run(_a, ctx) {
    const server = ctx.services.devServer;
    if (!server) throw new DevServerError('host_unavailable', 'chain.ping needs the game server; not available on this host');
    const r = (await server('chain.ping')) as { txHash?: string; status?: string; blockHeight?: unknown };
    return `${r.txHash ?? JSON.stringify(r)}${r.status ? `  ${r.status}` : ''}${r.blockHeight !== undefined ? `  block ${String(r.blockHeight)}` : ''}`;
  },
};

const scenarioCommand: DevCommandDef = {
  name: 'scenario',
  help: 'scenario <id>  Server: create a fresh dev planet from a seed scenario (e.g. w00), print its id (open ?scenario=<id> to play it)',
  async run(a, ctx) {
    const id = a[0];
    if (!id) throw new Error('usage: scenario <id>');
    const server = ctx.services.devServer;
    if (!server) throw new DevServerError('host_unavailable', 'scenario needs the game server; not available on this host');
    const r = (await server('scenario', { id })) as { planetId: string };
    return `created ${r.planetId} from scenario ${id}`;
  },
};

export default defineFeature({
  id: 'devtools',
  wave: 'W00',
  devCommands: [
    chainPing,
    scenarioCommand,
    simCommand('ping', 'Round-trip a no-op sim command; prints the ack tick', () => ({})),
    simCommand('spawn', 'spawn [q r]  Insert a test entity at tile (default 0 0)', (a) => ({ q: numArg(a, 0, 'q', 0), r: numArg(a, 1, 'r', 0) })),
    simCommand('nudge', 'nudge <id> [dq dr]  Move a test entity one nudge step (default +q)', (a) => {
      const dq = a[1] === undefined ? undefined : numArg(a, 1, 'dq');
      const dr = a[2] === undefined ? undefined : numArg(a, 2, 'dr');
      return { id: numArg(a, 0, 'id'), ...(dq !== undefined ? { dq } : {}), ...(dr !== undefined ? { dr } : {}) };
    }),
    simCommand('teleport', 'teleport <id> <q> <r>  Set a test entity position', (a) => ({ id: numArg(a, 0, 'id'), q: numArg(a, 1, 'q'), r: numArg(a, 2, 'r') })),
  ],
});
