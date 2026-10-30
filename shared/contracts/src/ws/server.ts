import { z } from 'zod';
import { ServerEnvelope } from '../envelope';
import { CloseCode, RejectCode } from '../errors';
import { WaveId } from '../flags';
import { ColonyId, PlanetId, PlayerId } from '../ids';
import { PlanetType, SimDiffFrame, SimEventWire, SimSnapshotFrame } from './sim';

/** App → client messages (PROTOCOL §4.3). Parsed permissively by clients (PR-01). */
export const Ready = ServerEnvelope('ready', z.object({
  playerId: PlayerId,
  home: z.unknown().optional(), // HomeResponse once the lobby exists
  flags: z.array(WaveId),
}));

export const WelcomePlanet = z.object({
  id: PlanetId,
  type: PlanetType,
  name: z.string(),
  // lifecycle fields are filled by the lobby; a W00 dev planet leaves them out
  state: z.string().optional(),
  endsAtMs: z.number().int().optional(),
  seats: z.object({ taken: z.number().int(), capacity: z.number().int() }).optional(),
});

export const Welcome = ServerEnvelope('welcome', z.object({
  reason: z.enum(['join', 'resync']),
  colonyId: ColonyId.nullable(), // null = dev session without a colony (W00)
  planet: WelcomePlanet,
  state: SimSnapshotFrame, // engine snapshot (D-31), everything on the planet (D-25)
  simVersion: z.number().int(),
  dataHash: z.string(), // a client whose engine/data differ reloads (SIM-X-08)
  tick: z.number().int().nonnegative(),
  serverTimeMs: z.number().int(),
  tickMs: z.literal(200),
  deltaHz: z.literal(5),
  flags: z.array(WaveId), // PRODUCT_WAVES §3: the enabled wave set
  warp: z.number().int().min(1).max(100).optional(), // dev time warp in effect
}));

export const Delta = ServerEnvelope('delta', z.object({
  fromTick: z.number().int().nonnegative(),
  toTick: z.number().int().nonnegative(),
  diff: SimDiffFrame, // engine diffSince(fromTick)
  events: z.array(SimEventWire).optional(), // events of this window
}));

export const Event = ServerEnvelope('event', SimEventWire);
export const CmdAck = ServerEnvelope('cmd.ack', z.object({ id: z.string(), appliedAtTick: z.number().int().nonnegative() }));
export const CmdReject = ServerEnvelope('cmd.reject', z.object({ id: z.string(), code: RejectCode, detail: z.string().max(200).optional() }));
export const Pong = ServerEnvelope('pong', z.object({ clientTimeMs: z.number().int(), serverTimeMs: z.number().int(), tick: z.number().int().optional() }));
export const Bye = ServerEnvelope('bye', z.object({ code: CloseCode, reason: z.string().max(120) }));

export const ServerMessage = z.discriminatedUnion('t', [Ready, Welcome, Delta, Event, CmdAck, CmdReject, Pong, Bye]);
export type ServerMessage = z.infer<typeof ServerMessage>;
export type ServerMessageOf<T extends ServerMessage['t']> = Extract<ServerMessage, { t: T }>;
