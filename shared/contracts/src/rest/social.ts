import { z } from 'zod';
import { AuthResponse } from './auth';
import { NearAccountId } from './near-account';

/** Social & wallet providers: FastAuth OIDC (`google`, `x`, `email`, `fastauth`) and NEP-413 `near-wallet`. */
export const SocialProvider = z.enum(['google', 'x', 'fastauth', 'email', 'near-wallet']);
export type SocialProvider = z.infer<typeof SocialProvider>;

/** `POST /v1/auth/social` (PROTOCOL §8). Bearer is optional: a guest token upgrades that player. */
export const SocialAuthRequest = z.strictObject({
  provider: SocialProvider,
  token: z.string().min(1).max(8192),
});
export const SocialAuthRequestSchema = SocialAuthRequest;
export type SocialAuthRequest = z.infer<typeof SocialAuthRequest>;

/** `200 { accessToken, player, accountId }`. `accountId` is the Pilot ID (`*.testnet` or `*.terraagent.mock`). */
export const SocialAuthResponse = AuthResponse.extend({
  accountId: NearAccountId,
});
export const SocialAuthResponseSchema = SocialAuthResponse;
export type SocialAuthResponse = z.infer<typeof SocialAuthResponse>;

/** `POST /v1/auth/near/challenge` — issues a single-use 32-byte NEP-413 challenge (5-minute TTL). */
export const NearAuthChallengeRequest = z.strictObject({
  walletId: z.string().min(1).max(64).optional(),
  intent: z.enum(['signin', 'signup']).optional(),
});
export const NearAuthChallengeRequestSchema = NearAuthChallengeRequest;
export type NearAuthChallengeRequest = z.infer<typeof NearAuthChallengeRequest>;

export const NearAuthChallengeResponse = z.strictObject({
  challengeId: z.string().min(16).max(128),
  message: z.string().min(1).max(512),
  nonce: z.string().min(40).max(64),
  recipient: z.string().min(2).max(128),
  network: z.enum(['mock', 'testnet', 'mainnet']),
  expiresAt: z.number().int().positive(),
});
export const NearAuthChallengeResponseSchema = NearAuthChallengeResponse;
export type NearAuthChallengeResponse = z.infer<typeof NearAuthChallengeResponse>;

/** `POST /v1/auth/near/verify` — verifies a NEP-413 signature + on-chain FullAccess key at `final` finality. */
export const NearAuthVerifyRequest = z.strictObject({
  challengeId: z.string().min(16).max(128),
  accountId: NearAccountId,
  publicKey: z.string().min(8).max(256),
  signature: z.string().min(16).max(512),
  callbackUrl: z.string().url().max(1024).optional(),
  walletId: z.string().min(1).max(64).optional(),
});
export const NearAuthVerifyRequestSchema = NearAuthVerifyRequest;
export type NearAuthVerifyRequest = z.infer<typeof NearAuthVerifyRequest>;
