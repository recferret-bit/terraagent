import { defineFeature, type DevCommandDef, type FeatureContext } from '../../core/registry/types';
import '../../net/services';
import { DevServerError } from '../../net/devServer';
import { serverFor, usage } from '../near-dev';

const FAUCET_USAGE = 'faucet near|usdc <amount>';
const SEED_USAGE = 'market.seed here|<planetId> <base/quote>';
const CLEAR_USAGE = 'market.clear here|<planetId>';

/** `here` is the joined planet of this session; anything else is a planet id. */
function planetOf(ctx: FeatureContext, arg: string | undefined, line: string): string {
  if (!arg) usage(line);
  if (arg !== 'here') return arg;
  const id = ctx.services.session?.planetId() ?? null;
  if (!id) throw new DevServerError('host_unavailable', 'not joined to a planet yet');
  return id;
}

const colonyIndexOf = (ctx: FeatureContext): number => ctx.services.landfall?.getOwnerColonyIndex() ?? ctx.services.colonyId ?? 0;

const faucet: DevCommandDef = {
  name: 'faucet',
  help: `${FAUCET_USAGE}  Server: credit mock USDC or NEAR to this colony's verifier balance (fixture funding, never organic)`,
  async run(a, ctx) {
    const token = a[0]?.toLowerCase();
    if (a.length !== 2 || (token !== 'near' && token !== 'usdc') || !a[1]) usage(FAUCET_USAGE);
    const planetId = planetOf(ctx, 'here', FAUCET_USAGE);
    const r = (await serverFor(ctx, 'faucet')('faucet', { token, amount: a[1], planetId, colonyIndex: colonyIndexOf(ctx) })) as { display?: string; label?: string; accountId?: string };
    return `credited ${r.display ?? a[1]} ${r.label ?? `mock ${token.toUpperCase()}`} to ${r.accountId ?? 'the colony account'}`;
  },
};

const seed: DevCommandDef = {
  name: 'market.seed',
  help: `${SEED_USAGE}  Server: a fixture bot colony places 5 bids and 5 asks on the pair (solo testing)`,
  async run(a, ctx) {
    if (a.length !== 2 || !a[1]) usage(SEED_USAGE);
    const planetId = planetOf(ctx, a[0], SEED_USAGE);
    const r = (await serverFor(ctx, 'market.seed')('market.seed', { planetId, pair: a[1] })) as { bids?: number; asks?: number };
    return `seeded ${a[1]} on ${planetId}: ${r.bids ?? 0} bids, ${r.asks ?? 0} asks (fixture bot)`;
  },
};

const clear: DevCommandDef = {
  name: 'market.clear',
  help: `${CLEAR_USAGE}  Server: cancel every open fixture-bot order on the planet`,
  async run(a, ctx) {
    if (a.length !== 1) usage(CLEAR_USAGE);
    const planetId = planetOf(ctx, a[0], CLEAR_USAGE);
    const r = (await serverFor(ctx, 'market.clear')('market.clear', { planetId })) as { cancelled?: number };
    return `cleared ${r.cancelled ?? 0} fixture orders on ${planetId}`;
  },
};

/** W13 market dev console commands (server host only; the browser host answers `host_unavailable`). */
export default defineFeature({
  id: 'market-dev',
  wave: 'W13',
  devCommands: [faucet, seed, clear],
});
