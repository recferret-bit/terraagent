import type { DevCommandDef, FeatureContext } from '../../core/registry/types';
import { numArg } from '../../dev/console/parse';
import type { CommandResult } from '../../net/commandBus';
import '../../net/services';

const RESOURCE_ALIASES: Record<string, string> = {
  metals: 'metals.t1',
  minerals: 'minerals.t1',
  biomass: 'bio.biomass',
  water: 'bio.water',
};

async function sim(ctx: FeatureContext, kind: string, args: unknown): Promise<CommandResult> {
  const send = ctx.services.sendCommand;
  return send ? send(kind, args) : { ok: false, code: 'not_connected', detail: 'no game server connection' };
}

function ackText(kind: string, r: CommandResult): string {
  if (r.ok) return `${kind} ok, applied at tick ${r.appliedAtTick}`;
  throw new Error(`${kind} rejected: ${r.code}${r.detail ? ` (${r.detail})` : ''}`);
}

export const grantCommand: DevCommandDef = {
  name: 'grant',
  help: 'grant <res> <n>  Add or subtract resources on colony (e.g. metals.t1, minerals, bio.water)',
  async run(a, ctx) {
    const rawRes = a[0];
    if (!rawRes) throw new Error('missing <res>');
    const resource = RESOURCE_ALIASES[rawRes] ?? rawRes;
    const amount = numArg(a, 1, 'n');
    return ackText('dev.grant', await sim(ctx, 'dev.grant', { resource, amount }));
  },
};

export const cellCommand: DevCommandDef = {
  name: 'cell',
  help: 'cell <E>  Set colony HQ power cell energy (0..cellMax)',
  async run(a, ctx) {
    const energy = numArg(a, 0, 'E');
    return ackText('dev.cell', await sim(ctx, 'dev.cell', { energy }));
  },
};

export const revealCommand: DevCommandDef = {
  name: 'reveal',
  help: 'reveal  Mark all tiles on the planet explored for colony',
  async run(_a, ctx) {
    return ackText('dev.reveal', await sim(ctx, 'dev.reveal', {}));
  },
};

export const seedCommand: DevCommandDef = {
  name: 'seed',
  help: 'seed <s>  Regenerate planet terrain with seed s',
  async run(a, ctx) {
    const s = a[0];
    if (!s) throw new Error('missing <s>');
    return ackText('dev.seed', await sim(ctx, 'dev.seed', { seed: s }));
  },
};

export const tpCommand: DevCommandDef = {
  name: 'tp',
  help: 'tp [id] <q> <r>  Teleport entity (default: colony HQ) to tile (q, r)',
  async run(a, ctx) {
    if (a.length >= 3) {
      const entityId = numArg(a, 0, 'id');
      const q = numArg(a, 1, 'q');
      const r = numArg(a, 2, 'r');
      return ackText('dev.teleport', await sim(ctx, 'dev.teleport', { entityId, q, r }));
    }
    const q = numArg(a, 0, 'q');
    const r = numArg(a, 1, 'r');
    return ackText('dev.teleport', await sim(ctx, 'dev.teleport', { entityId: 0, q, r }));
  },
};

export const landCommand: DevCommandDef = {
  name: 'land',
  help: 'land [q r]  Respawn or land colony drop pod and HQ',
  async run(a, ctx) {
    const args: { q?: number; r?: number } = {};
    if (a[0] !== undefined && a[1] !== undefined) {
      args.q = numArg(a, 0, 'q');
      args.r = numArg(a, 1, 'r');
    }
    return ackText('dev.land', await sim(ctx, 'dev.land', args));
  },
};

export const w01DevCommands: DevCommandDef[] = [
  grantCommand,
  cellCommand,
  revealCommand,
  seedCommand,
  tpCommand,
  landCommand,
];
