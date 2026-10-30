import { z } from 'zod';

/**
 * Engine sync payloads (D-31). `welcome.state` is the engine snapshot and `delta.diff` the engine diff, both produced by
 * the shared `@terra/sim` codec. They travel as raw bytes: a message that carries bytes is sent as one binary
 * WebSocket frame (MessagePack of the whole envelope, see `wire.ts`); every other message is a JSON text frame.
 */
export const SimSnapshotFrame = z.instanceof(Uint8Array);
export const SimDiffFrame = z.instanceof(Uint8Array);

export const PlanetType = z.enum(['desert', 'ocean', 'temperate']); // D-33
export type PlanetType = z.infer<typeof PlanetType>;

/** A sim event as it reaches clients (`event` messages and the events of a `delta` window). */
export const SimEventWire = z.object({
  kind: z.string().min(1).max(64),
  severity: z.enum(['info', 'warn', 'critical']),
  atTick: z.number().int().nonnegative(),
  colonyIds: z.array(z.string()),
  data: z.record(z.string(), z.unknown()),
});
export type SimEventWire = z.infer<typeof SimEventWire>;

/** A command as the engine receives it (SIMULATION §4): after zod and ownership checks on the host. */
export const SimCommandV1 = z.object({
  colonyIndex: z.number().int().nonnegative().nullable(), // null = planet-level (system/admin/dev)
  source: z.enum(['player', 'ai', 'near', 'admin', 'system', 'dev']),
  commandId: z.string().min(1).max(40), // echoed in ack/reject
  kind: z.string().min(1).max(64),
  args: z.unknown(),
});
export type SimCommandV1 = z.infer<typeof SimCommandV1>;
