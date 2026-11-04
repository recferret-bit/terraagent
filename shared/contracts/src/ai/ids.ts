import { z } from 'zod';

/** Bounded id used on director jobs, requests and context refs. Not a player session token. */
export const AiId = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9_.:/-]+$/, 'expected a director id');
export type AiId = z.infer<typeof AiId>;

/** Stable id of one action inside a directive batch. */
export const ActionId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_.:-]+$/, 'expected an action id');
export type ActionId = z.infer<typeof ActionId>;

/** Colony, planet or world id as the director is allowed to name it. */
export const ScopedId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_.:-]+$/, 'expected a scoped id');
export type ScopedId = z.infer<typeof ScopedId>;
