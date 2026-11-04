import { z } from 'zod';
import { ResourceKey } from '../ws/sim';

export const CargoPendingDir = z.enum(['export', 'import']);
export type CargoPendingDir = z.infer<typeof CargoPendingDir>;

export const CargoPendingState = z.enum(['PENDING', 'SENT', 'FINAL', 'FAILED']);
export type CargoPendingState = z.infer<typeof CargoPendingState>;

export const CargoPendingItem = z.object({
  ref: z.string().min(1).max(160),
  seq: z.number().int().positive().optional(),
  dir: CargoPendingDir.optional(),
  direction: CargoPendingDir.optional(),
  resource: ResourceKey,
  amount: z.number().int().nonnegative(),
  state: CargoPendingState.optional(),
  txHash: z.string().optional(),
  error: z.string().optional(),
});
export type CargoPendingItem = z.infer<typeof CargoPendingItem>;

/**
 * Sparse map of ResourceKey -> non-negative number (e.g. orbital balances or today's minted amounts).
 */
export const CargoResourceMap = z.partialRecord(ResourceKey, z.number().nonnegative());
export type CargoResourceMap = z.infer<typeof CargoResourceMap>;

/**
 * Payload of the `cargo.status` WebSocket push (PROTOCOL §6, W10-01) and per-colony entry of `GET /v1/near/cargo` (W10-14).
 */
export const CargoStatusPayload = z.object({
  colonyId: z.string().min(1),
  accountId: z.string().optional(),
  inOrbit: CargoResourceMap,
  pending: z.array(CargoPendingItem).optional(),
  pendingExport: z.array(CargoPendingItem).optional(),
  pendingImport: z.array(CargoPendingItem).optional(),
  todayMinted: CargoResourceMap.optional(),
  mintedToday: CargoResourceMap.optional(),
  dailyCap: z.number().int().positive().optional(),
  mintCapPerDay: z.number().int().positive().optional(),
  throughputUsedPerMin: z.number().nonnegative().optional(),
  throughputCapPerMin: z.number().nonnegative().optional(),
  hubOnline: z.boolean().optional(),
  hubTier: z.number().int().nonnegative().optional(),
  hubUnlocked: z.boolean().optional(),
});
export const CargoStatusPayloadSchema = CargoStatusPayload;
export type CargoStatusPayload = z.infer<typeof CargoStatusPayload>;

export const NearCargoResponse = CargoStatusPayload.extend({
  colonies: z.record(z.string(), CargoStatusPayload).optional(),
});
export const NearCargoResponseSchema = NearCargoResponse;
export type NearCargoResponse = z.infer<typeof NearCargoResponse>;
