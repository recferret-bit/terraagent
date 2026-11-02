import { createHmac, timingSafeEqual } from 'node:crypto';
import { NearException } from '../domain/errors.js';

/** Dev default when `MOCK_OAUTH_SECRET` is unset. Not part of the Nest boot env schema. */
export const MOCK_OAUTH_SECRET_DEFAULT = 'terra-dev-mock-oauth-secret';

/** Mock login tokens last five minutes. */
export const MOCK_TOKEN_TTL_S = 5 * 60;

export interface MockTokenClaims {
  readonly provider: 'google' | 'x';
  readonly subject: string;
  readonly email?: string;
  /** Unix seconds. */
  readonly exp: number;
}

type EnvSource = Readonly<Record<string, string | undefined>>;

/** `MOCK_OAUTH_SECRET`, or the dev default when unset or empty. */
export function mockOauthSecret(env: EnvSource = process.env): string {
  const v = env.MOCK_OAUTH_SECRET;
  return v === undefined || v === '' ? MOCK_OAUTH_SECRET_DEFAULT : v;
}

function rejected(): never {
  throw new NearException('NEAR_PROVIDER_REJECTED');
}

function hmacSha256(secret: string, payload: string): Buffer {
  return createHmac('sha256', secret).update(payload).digest();
}

/** `base64url(claims) + '.' + base64url(hmacSha256(secret, payload))`. */
export function signMockToken(claims: MockTokenClaims, secret: string): string {
  const body: MockTokenClaims = claims.email === undefined
    ? { provider: claims.provider, subject: claims.subject, exp: claims.exp }
    : { provider: claims.provider, subject: claims.subject, email: claims.email, exp: claims.exp };
  const payload = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
  return `${payload}.${hmacSha256(secret, payload).toString('base64url')}`;
}

/**
 * Checks the signature, the claim shape, and `exp`. A bad signature, a malformed token, or an `exp` that is now or
 * earlier throws `NEAR_PROVIDER_REJECTED` (401). `nowMs` is unix milliseconds.
 */
export function verifyMockToken(token: string, secret: string, nowMs: number): MockTokenClaims {
  const payload = signedPayload(token, secret);
  const claims = readClaims(payload);
  if (claims.exp <= Math.floor(nowMs / 1000)) rejected();
  return claims;
}

function signedPayload(token: string, secret: string): string {
  const dot = token.indexOf('.');
  if (dot <= 0 || token.indexOf('.', dot + 1) !== -1) rejected();
  const payload = token.slice(0, dot);
  const actual = Buffer.from(token.slice(dot + 1), 'base64url');
  const expected = hmacSha256(secret, payload);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) rejected();
  return payload;
}

function readClaims(payload: string): MockTokenClaims {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown;
  } catch {
    rejected();
  }
  if (typeof value !== 'object' || value === null) rejected();
  const row = value as Record<string, unknown>;
  const { provider, subject, exp, email } = row;
  if (provider !== 'google' && provider !== 'x') rejected();
  if (typeof subject !== 'string' || subject.length < 1 || subject.length > 64) rejected();
  if (typeof exp !== 'number' || !Number.isSafeInteger(exp)) rejected();
  if (email !== undefined && typeof email !== 'string') rejected();
  return typeof email === 'string' ? { provider, subject, email, exp } : { provider, subject, exp };
}
