import { createPublicKey, verify as cryptoVerify, type JsonWebKeyInput } from 'node:crypto';
import { NearException } from '../../../domain/errors.js';
import { verifyTokenDiffIntent } from '../../../intents/nep413-token-diff.js';
import { decodeBase58 } from '../../../keystore/base58.js';
import { ed25519PublicKeyFromNear } from '../../../keystore/keys.js';

type JwksKey = JsonWebKeyInput['key'] & {
  readonly kid?: string;
  readonly alg?: string;
};

interface JwtHeader {
  readonly alg?: string;
  readonly kid?: string;
}

export interface VerifiedSocialClaims {
  readonly subject: string;
  readonly email: string | null;
  readonly preferredName?: string;
}

const PROFILE_NAME_FIELDS = ['preferred_username', 'screen_name', 'nickname', 'given_name', 'name'] as const;

function extractPreferredOidcName(payload: Record<string, unknown>): string | undefined {
  for (const key of PROFILE_NAME_FIELDS) {
    const raw = payload[key];
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.includes('|')) continue;
    const stem = (trimmed.includes('@') ? (trimmed.split('@')[0] ?? '') : trimmed).trim();
    if (stem.replace(/[^a-z0-9]/gi, '').length >= 2) return stem;
  }
  return undefined;
}

/** Rejects cross-provider OAuth SSO mixups (e.g. a `google-oauth2|...` subject submitted under `provider: 'x'`). */
export function assertOAuthProviderMatchesSubject(
  provider: string,
  subject: string,
  email?: string | null,
): void {
  const p = provider.trim().toLowerCase();
  if (p === 'x' && /^(google-oauth2|apple|github|windowslive|email)\|/i.test(subject)) {
    throw new NearException('NEAR_PROVIDER_REJECTED', { message: 'OAuth subject does not match requested provider x' });
  }
  if (p === 'google' && /^(twitter|oauth2\|twitter|oauth2\|x|x|email)\|/i.test(subject)) {
    throw new NearException('NEAR_PROVIDER_REJECTED', { message: 'OAuth subject does not match requested provider google' });
  }
  if (p === 'email') {
    if (/^(twitter|oauth2\|twitter|oauth2\|x|x)\|/i.test(subject)) {
      throw new NearException('NEAR_PROVIDER_REJECTED', { message: 'OAuth subject does not match requested provider email' });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new NearException('NEAR_PROVIDER_REJECTED', { message: 'Verified email claim missing from OIDC token' });
    }
  }
}

const jwksCache = new Map<string, { keys: readonly JwksKey[]; fetchedAt: number }>();
const JWKS_TTL_MS = 10 * 60_000;

async function fetchJwks(jwksUrl: string): Promise<readonly JwksKey[]> {
  const cached = jwksCache.get(jwksUrl);
  if (cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) return cached.keys;
  const res = await fetch(jwksUrl, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new NearException('NEAR_PROVIDER_REJECTED', { message: `JWKS HTTP ${res.status}` });
  const body = (await res.json()) as { keys?: JwksKey[] };
  const keys = Array.isArray(body.keys) ? body.keys : [];
  jwksCache.set(jwksUrl, { keys, fetchedAt: Date.now() });
  return keys;
}

function parseJwtParts(token: string): {
  header: JwtHeader;
  payload: Record<string, unknown>;
  signingInput: Buffer;
  signature: Buffer;
} {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new NearException('NEAR_PROVIDER_REJECTED', { message: 'Malformed OIDC JWT' });
  }
  try {
    const header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8')) as JwtHeader;
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as Record<string, unknown>;
    const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`, 'utf8');
    const signature = Buffer.from(parts[2]!, 'base64url');
    return { header, payload, signingInput, signature };
  } catch {
    throw new NearException('NEAR_PROVIDER_REJECTED', { message: 'Invalid JWT JSON encoding' });
  }
}

/** Verifies an RS256 OIDC ID token against a remote JWKS endpoint (`FastAuth Auth0` or `Google OAuth`). */
export async function verifyOidcJwt(params: {
  readonly token: string;
  readonly jwksUrl: string;
  readonly allowedIssuers: readonly string[];
  readonly expectedAudience?: string;
  readonly expectedNonce?: string;
  readonly requireNonceIfPresent?: boolean;
  readonly requireEmail?: boolean;
}): Promise<VerifiedSocialClaims> {
  const { header, payload, signingInput, signature } = parseJwtParts(params.token);
  if (header.alg !== 'RS256') {
    throw new NearException('NEAR_PROVIDER_REJECTED', { message: `Unsupported JWT alg: ${String(header.alg)}` });
  }

  const keys = await fetchJwks(params.jwksUrl);
  const candidates = header.kid ? keys.filter((k) => k.kid === header.kid) : keys;
  if (!candidates.length) {
    throw new NearException('NEAR_PROVIDER_REJECTED', { message: 'No matching JWK kid found' });
  }

  const verified = candidates.some((jwk) => {
    try {
      const pub = createPublicKey({ key: jwk, format: 'jwk' });
      return cryptoVerify('RSA-SHA256', signingInput, pub, signature);
    } catch {
      return false;
    }
  });
  if (!verified) {
    throw new NearException('NEAR_PROVIDER_REJECTED', { message: 'JWT RS256 signature invalid' });
  }

  assertJwtClaims(payload, params);

  const sub = typeof payload.sub === 'string' && payload.sub.trim() ? payload.sub.trim() : '';
  if (!sub) {
    throw new NearException('NEAR_PROVIDER_REJECTED', { message: 'JWT missing subject' });
  }
  const email = typeof payload.email === 'string' && payload.email.trim() ? payload.email.trim().toLowerCase() : null;
  if (params.requireEmail) {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new NearException('NEAR_PROVIDER_REJECTED', { message: 'JWT missing verified email claim' });
    }
    if (payload.email_verified !== true) {
      throw new NearException('NEAR_PROVIDER_REJECTED', { message: 'Email address is not verified' });
    }
  }
  const preferredName = extractPreferredOidcName(payload);
  return preferredName ? { subject: sub, email, preferredName } : { subject: sub, email };
}

function assertJwtClaims(
  payload: Record<string, unknown>,
  params: {
    readonly allowedIssuers: readonly string[];
    readonly expectedAudience?: string;
    readonly expectedNonce?: string;
    readonly requireNonceIfPresent?: boolean;
  },
): void {
  const iss = typeof payload.iss === 'string' ? payload.iss : '';
  if (!params.allowedIssuers.includes(iss)) {
    throw new NearException('NEAR_PROVIDER_REJECTED', { message: `Unexpected JWT issuer: ${iss}` });
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const exp = typeof payload.exp === 'number' ? payload.exp : 0;
  if (exp <= nowSec) {
    throw new NearException('NEAR_PROVIDER_REJECTED', { message: 'JWT expired' });
  }
  if (typeof payload.iat === 'number' && payload.iat > nowSec + 120) {
    throw new NearException('NEAR_PROVIDER_REJECTED', { message: 'JWT iat is in the future' });
  }

  if (params.expectedAudience) {
    const aud = payload.aud;
    const audList = Array.isArray(aud) ? aud : typeof aud === 'string' ? [aud] : [];
    if (!audList.includes(params.expectedAudience)) {
      throw new NearException('NEAR_PROVIDER_REJECTED', { message: 'JWT audience mismatch' });
    }
  }

  const tokenNonce = typeof payload.nonce === 'string' ? payload.nonce : '';
  if (params.expectedNonce) {
    if (tokenNonce !== params.expectedNonce) {
      throw new NearException('NEAR_PROVIDER_REJECTED', { message: 'JWT OIDC nonce mismatch' });
    }
  } else if (params.requireNonceIfPresent && tokenNonce.length > 0) {
    throw new NearException('NEAR_PROVIDER_REJECTED', { message: 'Missing OIDC PKCE nonce parameter' });
  }
}

export function assertAllowedRedirectUri(
  redirectUri: string,
  envSource?: Record<string, string | undefined>,
): void {
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    throw new NearException('NEAR_PROVIDER_REJECTED', { message: 'Invalid FastAuth redirect_uri' });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new NearException('NEAR_PROVIDER_REJECTED', { message: 'Invalid FastAuth redirect_uri protocol' });
  }

  const isProd = envSource?.NODE_ENV === 'production';
  if (!isProd && parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) {
    return;
  }

  const allowedOrigins = new Set<string>(['https://terraagent.fun', 'https://www.terraagent.fun']);
  const taDomain = envSource?.TA_DOMAIN?.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (taDomain) {
    allowedOrigins.add(`https://${taDomain}`);
    allowedOrigins.add(`https://www.${taDomain}`);
  }
  const corsRaw = envSource?.CORS_ORIGINS ?? '';
  for (const part of corsRaw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    try {
      allowedOrigins.add(new URL(trimmed).origin);
    } catch {
      /* ignore malformed entry */
    }
  }
  if (!allowedOrigins.has(parsed.origin)) {
    throw new NearException('NEAR_PROVIDER_REJECTED', {
      message: `Disallowed FastAuth redirect_uri origin: ${parsed.origin}`,
    });
  }
}

/** Exchanges a PKCE authorization code (`fastauth-code:<code>:<verifier>:<redirectUri>[:<nonce>]`) with Auth0 `/oauth/token` and verifies the RS256 ID token. */
export async function verifyFastAuthPkceCode(params: {
  readonly rawToken: string;
  readonly issuer: string;
  readonly clientId: string;
  readonly requireEmail?: boolean;
  readonly envSource?: Record<string, string | undefined>;
}): Promise<VerifiedSocialClaims> {
  const [, rawCode = '', rawVerifier = '', rawRedirectUri = '', rawNonce = ''] = params.rawToken.split(':');
  const code = decodeURIComponent(rawCode).trim();
  const codeVerifier = decodeURIComponent(rawVerifier).trim();
  const redirectUri = decodeURIComponent(rawRedirectUri).trim();
  const expectedNonce = rawNonce ? decodeURIComponent(rawNonce).trim() : undefined;
  if (!code || codeVerifier.length < 4 || codeVerifier.length > 128 || !redirectUri) {
    throw new NearException('NEAR_PROVIDER_REJECTED', { message: 'Incomplete FastAuth PKCE code payload' });
  }
  assertAllowedRedirectUri(redirectUri, params.envSource);
  const normalizedIssuer = params.issuer.endsWith('/') ? params.issuer : `${params.issuer}/`;
  const tokenRes = await fetch(`${normalizedIssuer}oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: params.clientId,
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!tokenRes.ok) {
    const errText = await tokenRes.text().catch(() => '');
    throw new NearException('NEAR_PROVIDER_REJECTED', {
      message: `FastAuth token exchange HTTP ${tokenRes.status}: ${errText.slice(0, 200)}`,
    });
  }
  const body = (await tokenRes.json()) as { id_token?: string };
  if (!body.id_token || typeof body.id_token !== 'string') {
    throw new NearException('NEAR_PROVIDER_REJECTED', { message: 'FastAuth token exchange missing id_token' });
  }
  return verifyOidcJwt({
    token: body.id_token,
    jwksUrl: `${normalizedIssuer}.well-known/jwks.json`,
    allowedIssuers: [normalizedIssuer, normalizedIssuer.replace(/\/$/, '')],
    expectedAudience: params.clientId,
    expectedNonce,
    requireNonceIfPresent: true,
    requireEmail: params.requireEmail,
  });
}

/**
 * Low-level ed25519 signature helper for offline FastAuth session payload inspection.
 * Security note: does NOT verify server challenge/nonce or on-chain `view_access_key` ownership;
 * MUST NEVER be used alone to authenticate `POST /v1/auth/social`.
 */
export function verifyFastAuthSessionProof(rawToken: string): VerifiedSocialClaims {
  let parsed: {
    accountId?: string;
    publicKey?: string;
    signature?: string;
    message?: string;
    email?: string;
  };
  try {
    parsed = JSON.parse(Buffer.from(rawToken, 'base64url').toString('utf8')) as typeof parsed;
  } catch {
    throw new NearException('NEAR_PROVIDER_REJECTED', { message: 'Invalid FastAuth session token' });
  }
  if (!parsed.accountId || !parsed.publicKey || !parsed.signature || !parsed.message) {
    throw new NearException('NEAR_PROVIDER_REJECTED', { message: 'Incomplete FastAuth session proof' });
  }
  try {
    const pub = ed25519PublicKeyFromNear(parsed.publicKey);
    const sigBytes = parsed.signature.startsWith('ed25519:')
      ? decodeBase58(parsed.signature.slice(8))
      : Buffer.from(parsed.signature, 'base64');
    const ok = cryptoVerify(null, Buffer.from(parsed.message, 'utf8'), pub, sigBytes);
    if (!ok) throw new NearException('NEAR_PROVIDER_REJECTED');
  } catch {
    throw new NearException('NEAR_PROVIDER_REJECTED', { message: 'FastAuth ed25519 signature verification failed' });
  }
  void verifyTokenDiffIntent;
  return { subject: parsed.accountId, email: parsed.email ?? null };
}
