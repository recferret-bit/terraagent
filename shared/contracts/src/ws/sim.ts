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

/** D-34 resource families: one storage cap per family. Energy is grid power, not a stored resource. */
export const RESOURCE_FAMILIES = ['metals', 'minerals', 'bio'] as const;
export const ResourceFamily = z.enum(RESOURCE_FAMILIES);
export type ResourceFamily = z.infer<typeof ResourceFamily>;

/** D-34 stock keys: the 10 stored sub-resources across Metals, Minerals, and Bio. */
export const RESOURCE_KEYS = [
  'metals.t1', 'metals.t2', 'metals.t3',
  'minerals.t1', 'minerals.t2', 'minerals.t3',
  'bio.water', 'bio.biomass', 'bio.t2', 'bio.t3',
] as const;
export const ResourceKey = z.enum(RESOURCE_KEYS);
export type ResourceKey = z.infer<typeof ResourceKey>;

/** Only T1 keys are granted/produced in W01 (D-34). */
export const T1_RESOURCE_KEYS = ['metals.t1', 'minerals.t1', 'bio.water', 'bio.biomass'] as const;
export const T1ResourceKey = z.enum(T1_RESOURCE_KEYS);
export type T1ResourceKey = z.infer<typeof T1ResourceKey>;

export const RESOURCE_FAMILY_OF: Readonly<Record<ResourceKey, ResourceFamily>> = {
  'metals.t1': 'metals',
  'metals.t2': 'metals',
  'metals.t3': 'metals',
  'minerals.t1': 'minerals',
  'minerals.t2': 'minerals',
  'minerals.t3': 'minerals',
  'bio.water': 'bio',
  'bio.biomass': 'bio',
  'bio.t2': 'bio',
  'bio.t3': 'bio',
};

export const Stock = z.record(ResourceKey, z.number());
export type Stock = Record<ResourceKey, number>;

export const FamilyCaps = z.strictObject({
  metals: z.number().nonnegative(),
  minerals: z.number().nonnegative(),
  bio: z.number().nonnegative(),
});
export type FamilyCaps = z.infer<typeof FamilyCaps>;

export const W01_TERRAFORM_OPS = ['grade', 'clear', 'break'] as const;
export const W02_TERRAFORM_OPS = ['grade', 'clear', 'break', 'dismantle', 'work'] as const;
export const TerraformOp = z.enum(W02_TERRAFORM_OPS);
export type TerraformOp = z.infer<typeof TerraformOp>;

export const TileCoord = z.number().int().min(-32768).max(32767);
export const TilePos = z.strictObject({ q: TileCoord, r: TileCoord });
export type TilePos = z.infer<typeof TilePos>;

/** A sim event as it reaches clients (`event` messages and the events of a `delta` window). */
export const SimEventWire = z.object({
  kind: z.string().min(1).max(64),
  severity: z.enum(['info', 'warn', 'critical']),
  atTick: z.number().int().nonnegative(),
  colonyIds: z.array(z.union([z.string(), z.number()])),
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
