import { z } from 'zod';
import { ClientEnvelope } from '../envelope';
import { CmdId, PlanetId } from '../ids';
import { PlanetType } from './sim';

/** Client → app messages (PROTOCOL §4.2). All strict: the server rejects unknown keys (PR-01). */
export const Hello = ClientEnvelope('hello', z.strictObject({
  accessToken: z.string().min(1).max(4096), // W00: dev session token; JWT from W01
  proto: z.array(z.number().int()).nonempty(),
  client: z.strictObject({ app: z.literal('game'), version: z.string().max(32) }),
}));
export const Join = ClientEnvelope('join', z.strictObject({ planetId: PlanetId }));
export const Leave = ClientEnvelope('leave', z.strictObject({}));
const Topic = z.enum(['planets', 'queue', 'party', 'market']);
export const Subscribe = ClientEnvelope('subscribe', z.strictObject({ topic: Topic, planetType: PlanetType.optional() }));
export const Unsubscribe = ClientEnvelope('unsubscribe', z.strictObject({ topic: Topic }));
export const Reauth = ClientEnvelope('reauth', z.strictObject({ accessToken: z.string().min(1).max(4096) }));
export const Ping = ClientEnvelope('ping', z.strictObject({ clientTimeMs: z.number().int() }));
/** `args` is checked against the per-kind schema from `commands/*` after routing on `kind`. */
export const Cmd = ClientEnvelope('cmd', z.strictObject({ kind: z.string().min(1).max(64), args: z.unknown() })).extend({ id: CmdId });

export const ClientMessage = z.discriminatedUnion('t', [Hello, Join, Leave, Subscribe, Unsubscribe, Reauth, Ping, Cmd]);
export type ClientMessage = z.infer<typeof ClientMessage>;
export type ClientMessageOf<T extends ClientMessage['t']> = Extract<ClientMessage, { t: T }>;
