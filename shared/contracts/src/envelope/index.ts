import { z } from 'zod';

/** PR-05: protocol version carried in every envelope. Additive changes stay at 1. */
export const PROTOCOL_VERSION = 1 as const;

const head = {
  v: z.literal(PROTOCOL_VERSION),
  id: z.string().min(1).max(40).optional(), // client correlation id (cm_ ULID for commands)
  tick: z.number().int().nonnegative().optional(), // server → client only
};

/**
 * Client → server envelope. Strict at every level the server parses (PR-01): unknown keys are rejected.
 * The payload schema must be strict too (`z.strictObject`), which the message definitions in `ws/client.ts` are.
 */
export const ClientEnvelope = <T extends string, D extends z.ZodType>(t: T, d: D) =>
  z.strictObject({ ...head, t: z.literal(t), d });

/** Server → client envelope. Clients parse permissively (PR-01): unknown keys are dropped, never an error. */
export const ServerEnvelope = <T extends string, D extends z.ZodType>(t: T, d: D) =>
  z.object({ ...head, t: z.literal(t), d });

/** The minimal shape every frame has, used to route a frame before its full schema is known. */
export const EnvelopeHead = z.object({ v: z.literal(PROTOCOL_VERSION), t: z.string(), id: z.string().optional() });
