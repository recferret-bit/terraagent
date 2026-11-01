import type { DevCommandDef, FeatureContext } from '../../core/registry/types';
import { intArg, numArg } from '../../dev/console/parse';
import type { CommandResult } from '../../net/commandBus';
import '../../net/services';
import { RESOURCE_ALIASES } from '../shared/resources';
import { ledgerCommand } from './ledger';

export { ledgerCommand };


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
  help: 'grant <res> <n>  Add (n > 0) or withdraw (n < 0, clamped to the balance) whole units on colony (e.g. metals.t1, minerals, bio.water)',
  async run(a, ctx) {
    const rawRes = a[0];
    if (!rawRes) throw new Error('missing <res>');
    const resource = RESOURCE_ALIASES[rawRes] ?? rawRes;
    const amount = intArg(a, 1, 'n');
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
  help: 'tp [id] <q> <r>  Teleport entity id (default: the colony HQ) to tile (q, r); whole numbers only',
  async run(a, ctx) {
    if (a.length >= 3) {
      const entityId = intArg(a, 0, 'id');
      const q = intArg(a, 1, 'q');
      const r = intArg(a, 2, 'r');
      return ackText('dev.teleport', await sim(ctx, 'dev.teleport', { entityId, q, r }));
    }
    const q = intArg(a, 0, 'q');
    const r = intArg(a, 1, 'r');
    return ackText('dev.teleport', await sim(ctx, 'dev.teleport', { entityId: 0, q, r }));
  },
};

export const landCommand: DevCommandDef = {
  name: 'land',
  help: 'land [q r]  Land the colony drop pod and HQ now (at tile (q, r) when given: both or none)',
  async run(a, ctx) {
    if (a.length === 1 || a.length > 2) throw new Error('land takes no coordinates or both <q> <r>');
    const args = a.length === 2 ? { q: intArg(a, 0, 'q'), r: intArg(a, 1, 'r') } : {};
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
  ledgerCommand,
];
