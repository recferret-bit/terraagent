import { z } from 'zod';
import { PlayerId } from '../ids';

export const GuestAuthRequest = z.strictObject({
  deviceSecret: z.string().min(16).max(256).optional(),
});
export type GuestAuthRequest = z.infer<typeof GuestAuthRequest>;

export const PlayerDto = z.object({
  id: PlayerId,
  displayName: z.string().min(1).max(32),
  nameCustom: z.boolean().optional(),
  kind: z.enum(['GUEST', 'LINKED']).optional(),
});
export type PlayerDto = z.infer<typeof PlayerDto>;

export const AuthResponse = z.object({
  accessToken: z.string().min(1),
  player: PlayerDto,
  deviceSecret: z.string().min(16).max(256).optional(),
});
export type AuthResponse = z.infer<typeof AuthResponse>;
