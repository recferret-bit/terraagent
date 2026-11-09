import { defineFeature, type DevCommandDef, type FeatureContext } from '../../core/registry/types';
import { DevServerError } from '../../net/devServer';
import '../../net/services';
import { ownColonyIndex, viewColony } from '../shared/colony';

interface SeatBody {
  readonly planetId: string;
  readonly colonyIndex: number;
  readonly colonyId?: string;
}

interface PresenceReply {
  readonly posted: boolean;
  readonly away: boolean;
  readonly tick: number;
  readonly appliedAtTick?: number;
}

interface EliminateReply {
  readonly atTick: number;
  readonly startedAtMs: number;
}

function seat(ctx: FeatureContext, cmd: string): SeatBody {
  const planetId = ctx.services.session?.planetId();
  if (!planetId) throw new Error(`${cmd}: not connected to a planet yet`);
  const colonyIndex = ownColonyIndex(ctx.services);
  const row = viewColony(ctx.services.store?.latest, colonyIndex);
  return { planetId, colonyIndex, ...(row?.id ? { colonyId: row.id } : {}) };
}

async function call(ctx: FeatureContext, cmd: string, name: string, body: SeatBody): Promise<unknown> {
  const server = ctx.services.devServer;
  if (!server) throw new DevServerError('host_unavailable', `${cmd} needs the game server; not available on this host`);
  try {
    return await server(name, body);
  } catch (err) {
    if (err instanceof DevServerError && (err.errorCode === 'NOT_AWAY' || err.code === 'not_away')) throw new Error('not_away');
    throw err;
  }
}

function presenceText(kind: 'away' | 'back', reply: PresenceReply): string {
  const tick = reply.appliedAtTick ?? reply.tick;
  if (kind === 'away') return reply.posted ? `away at tick ${tick}` : `already away (tick ${reply.tick})`;
  return reply.posted ? `back at tick ${tick}` : `already present (tick ${reply.tick})`;
}

const awayCommand: DevCommandDef = {
  name: 'away',
  help: 'away  Mark this colony away on the next sim tick (W09). A repeat does not post again.',
  async run(args, ctx) {
    if (args.length !== 0) throw new Error('usage: away');
    const reply = (await call(ctx, 'away', 'away', seat(ctx, 'away'))) as PresenceReply;
    return presenceText('away', reply);
  },
};

const backCommand: DevCommandDef = {
  name: 'back',
  help: 'back  Mark this colony present again (W09). A repeat does not post again.',
  async run(args, ctx) {
    if (args.length !== 0) throw new Error('usage: back');
    const reply = (await call(ctx, 'back', 'back', seat(ctx, 'back'))) as PresenceReply;
    return presenceText('back', reply);
  },
};

const colonyCommand: DevCommandDef = {
  name: 'colony',
  help: 'colony eliminate  Emit colonyEliminated and start the hard-mode clock. Rejects not_away when the colony is present (W09).',
  async run(args, ctx) {
    if (args.length !== 1 || args[0] !== 'eliminate') throw new Error('usage: colony eliminate');
    const reply = (await call(ctx, 'colony eliminate', 'colony.eliminate', seat(ctx, 'colony eliminate'))) as EliminateReply;
    return `colonyEliminated at tick ${reply.atTick}; hard-mode clock ${reply.startedAtMs}`;
  },
};

/** Hidden unless flag W09 is on (`loadFeatures` drops the feature). */
export const devPresence = defineFeature({
  id: 'dev-presence',
  wave: 'W09',
  devCommands: [awayCommand, backCommand, colonyCommand],
});
