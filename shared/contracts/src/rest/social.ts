import { z } from 'zod';
import { AuthResponse } from './auth';
import { NearAccountId } from './near-account';

/** Mock providers on the dev OAuth screen (W06-02). The real provider is chosen in W23. */
export const SocialProvider = z.enum(['google', 'x']);
export type SocialProvider = z.infer<typeof SocialProvider>;

/** `POST /v1/auth/social` (PROTOCOL §8). Bearer is optional: a guest token upgrades that player. */
export const SocialAuthRequest = z.strictObject({
  provider: SocialProvider,
  token: z.string().min(1).max(4096),
});
export const SocialAuthRequestSchema = SocialAuthRequest;
export type SocialAuthRequest = z.infer<typeof SocialAuthRequest>;

/** `200 { accessToken, player, accountId }`. `accountId` is the Pilot ID (`name.terraagent.mock`). */
export const SocialAuthResponse = AuthResponse.extend({
  accountId: NearAccountId,
});
export const SocialAuthResponseSchema = SocialAuthResponse;
export type SocialAuthResponse = z.infer<typeof SocialAuthResponse>;
