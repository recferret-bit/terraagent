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

export const LOCAL_MOCK_PLAYER_NAME_MIN = 2;
export const LOCAL_MOCK_PLAYER_NAME_MAX = 32;
export const LOCAL_MOCK_PLAYER_NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9 _.-]{0,30}[A-Za-z0-9])?$/;

/** Trims surrounding whitespace from a localhost mock player name without collapsing single spaces. */
export function normalizeLocalMockPlayerName(raw: string): string {
  return raw.trim();
}

/** Validates a localhost mock player name (2–32 chars, letters/digits/space/`_`/`.`/`-`, >= 2 alphanumerics). */
export function validateLocalMockPlayerName(
  raw: unknown,
): { readonly ok: true; readonly value: string } | { readonly ok: false; readonly message: string } {
  if (typeof raw !== 'string') {
    return { ok: false, message: 'Enter a player name.' };
  }
  // eslint-disable-next-line no-control-regex -- intentionally rejects ASCII control characters
  if (/[\x00-\x1f\x7f\t\r\n]/.test(raw)) {
    return { ok: false, message: 'Player name cannot contain tabs, newlines, or control characters.' };
  }
  const value = normalizeLocalMockPlayerName(raw);
  if (value.length < LOCAL_MOCK_PLAYER_NAME_MIN || value.length > LOCAL_MOCK_PLAYER_NAME_MAX) {
    return {
      ok: false,
      message: `Player name must be ${LOCAL_MOCK_PLAYER_NAME_MIN}–${LOCAL_MOCK_PLAYER_NAME_MAX} characters.`,
    };
  }
  if (/ {2,}/.test(value)) {
    return { ok: false, message: 'Player name cannot contain consecutive spaces.' };
  }
  if (!LOCAL_MOCK_PLAYER_NAME_RE.test(value)) {
    return {
      ok: false,
      message: 'Use letters, digits, single spaces, _, ., or - (start and end with a letter or digit).',
    };
  }
  if ((value.match(/[A-Za-z0-9]/g)?.length ?? 0) < 2) {
    return { ok: false, message: 'Player name must contain at least 2 letters or digits.' };
  }
  return { ok: true, value };
}

export const LocalMockPlayerNameSchema = z
  .string()
  .superRefine((raw, ctx) => {
    const res = validateLocalMockPlayerName(raw);
    if (!res.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: res.message });
    }
  })
  .transform((raw) => normalizeLocalMockPlayerName(raw));

/** `POST /v1/dev/mock-oauth/login` — localhost-only dev mock login/signup by player name. */
export const LocalMockAuthRequest = z.strictObject({
  playerName: LocalMockPlayerNameSchema,
  mode: z.enum(['signin', 'signup']).optional(),
});
export const LocalMockAuthRequestSchema = LocalMockAuthRequest;
export type LocalMockAuthRequest = z.infer<typeof LocalMockAuthRequest>;
