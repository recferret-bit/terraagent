import { defineFeature, type DevCommandDef, type FeatureContext } from '../../core/registry/types';
import { DevServerError } from '../../net/devServer';
import '../../net/services';

/**
 * `tune <table>.<row>.<field> <value>` / `tune reset` / `tune export` (D-35): balance overrides on the running planet, applied
 * by the server at once and recorded in the planet's event log. Values are in design units (seconds, per-second rates).
 *
 * The server also sends its overrides in `welcome`, so a reload compiles the same data. Until then this page's replica keeps
 * the data it was loaded with: predicted commands may differ from the server's result by the tuned amount and are corrected by
 * the next delta (D-35: "clients reload the same numbers").
 */

interface TuneReply { dataHash: string; overrides: unknown; text?: string }

async function call(ctx: FeatureContext, body: Record<string, unknown>): Promise<TuneReply> {
  const { devServer, session } = ctx.services;
  if (!devServer) throw new DevServerError('host_unavailable', 'tune needs the game server; not available on this host');
  const planetId = session?.planetId();
  if (!planetId) throw new Error('not connected to a planet yet');
  return (await devServer('tune', { planetId, ...body })) as TuneReply;
}

const USAGE = 'tune <table>.<row>.<field> <value> | tune reset | tune export';

const tune: DevCommandDef = {
  name: 'tune',
  help: `${USAGE}  Balance override on this planet, live (design units; e.g. tune dev.probe.nudgeTiles 3)`,
  async run(args, ctx) {
    const [first, ...rest] = args;
    if (first === undefined) throw new Error(`usage: ${USAGE}`);
    if (first === 'reset') {
      const r = await call(ctx, { op: 'reset' });
      return `tune reset: back to file + scenario numbers, data hash ${r.dataHash}`;
    }
    if (first === 'export') return (await call(ctx, { op: 'export' })).text ?? '{}';
    if (rest.length === 0) throw new Error(`missing <value>; usage: ${USAGE}`);
    const r = await call(ctx, { op: 'set', path: first, value: rest.join(' ') });
    return `tune ${first} = ${rest.join(' ')}, data hash ${r.dataHash} (reload the page to predict with the new numbers)`;
  },
};

export default defineFeature({ id: 'tune', wave: 'W00', devCommands: [tune] });
