import { z } from 'zod';
import { ClientEnvelope } from '../envelope';
import { CmdId } from '../ids';
import { HomePlanetId } from '../rest/home';
import { PairId } from '../market/tokens';
import { PlanetType } from './sim';

/** Client → app messages (PROTOCOL §4.2). All strict: the server rejects unknown keys (PR-01). */
export const Hello = ClientEnvelope('hello', z.strictObject({
  accessToken: z.string().min(1).max(4096), // W00: dev session token; JWT from W01
  proto: z.array(z.number().int()).nonempty(),
  client: z.strictObject({ app: z.literal('game'), version: z.string().max(32) }),
}));
export const Join = ClientEnvelope('join', z.strictObject({ planetId: HomePlanetId }));
export const Leave = ClientEnvelope('leave', z.strictObject({}));
const Topic = z.enum(['planets', 'queue', 'party', 'market']);
export const Subscribe = ClientEnvelope('subscribe', z.strictObject({ topic: Topic, planetType: PlanetType.optional() }));
export const Unsubscribe = ClientEnvelope('unsubscribe', z.strictObject({ topic: Topic }));
/**
 * W13 per-socket market topic (LED-25). A socket that never sends these gets every pair of its planet (legacy default).
 * `market.subscribe` adds pairs (the first one switches the socket to an explicit pair list); `market.unsubscribe` removes the
 * listed pairs, or every pair when `pairs` is omitted. Both are scoped to the joined planet and ignored otherwise.
 */
export const MarketSubscribe = ClientEnvelope('market.subscribe', z.strictObject({ planetId: HomePlanetId, pairs: z.array(PairId).max(64) }));
export const MarketUnsubscribe = ClientEnvelope('market.unsubscribe', z.strictObject({ planetId: HomePlanetId, pairs: z.array(PairId).max(64).optional() }));
export const Reauth = ClientEnvelope('reauth', z.strictObject({ accessToken: z.string().min(1).max(4096) }));
export const Ping = ClientEnvelope('ping', z.strictObject({ clientTimeMs: z.number().int() }));
/** `args` is checked against the per-kind schema from `commands/*` after routing on `kind`. */
export const Cmd = ClientEnvelope('cmd', z.strictObject({ kind: z.string().min(1).max(64), args: z.unknown() })).extend({ id: CmdId });

export const ClientMessage = z.discriminatedUnion('t', [Hello, Join, Leave, Subscribe, Unsubscribe, MarketSubscribe, MarketUnsubscribe, Reauth, Ping, Cmd]);
export type ClientMessage = z.infer<typeof ClientMessage>;
export type ClientMessageOf<T extends ClientMessage['t']> = Extract<ClientMessage, { t: T }>;
