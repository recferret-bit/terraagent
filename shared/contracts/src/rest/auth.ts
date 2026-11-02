import { z } from 'zod';
import { PlayerId } from '../ids';
import { NearAccountId } from './near-account';

export const GuestAuthRequest = z.strictObject({
  deviceSecret: z.string().min(16).max(256).optional(),
  handle: z.string().min(1).max(32).optional(),
});
export const GuestAuthRequestSchema = GuestAuthRequest;
export type GuestAuthRequest = z.infer<typeof GuestAuthRequest>;

export const PlayerDto = z.object({
  id: PlayerId,
  handle: z.string().min(1).max(32),
  isGuest: z.boolean(),
  displayName: z.string().min(1).max(32).optional(),
  nameCustom: z.boolean().optional(),
  kind: z.enum(['GUEST', 'LINKED']).optional(),
});
export type PlayerDto = z.infer<typeof PlayerDto>;

/** `accountId` is set when this player already has a Pilot ID. Guest responses omit it. Not strict. */
export const AuthResponse = z.object({
  accessToken: z.string().min(1),
  expiresIn: z.number().int().positive(),
  player: PlayerDto,
  accountId: NearAccountId.optional(),
});
export const AuthResponseSchema = AuthResponse;
export type AuthResponse = z.infer<typeof AuthResponse>;
