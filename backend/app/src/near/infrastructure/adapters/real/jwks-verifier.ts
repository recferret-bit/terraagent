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

  const iss = typeof payload.iss === 'string' ? payload.iss : '';
  if (!params.allowedIssuers.includes(iss)) {
    throw new NearException('NEAR_PROVIDER_REJECTED', { message: `Unexpected JWT issuer: ${iss}` });
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const exp = typeof payload.exp === 'number' ? payload.exp : 0;
  if (exp <= nowSec) {
    throw new NearException('NEAR_PROVIDER_REJECTED', { message: 'JWT expired' });
  }

  if (params.expectedAudience) {
    const aud = payload.aud;
    const audList = Array.isArray(aud) ? aud : typeof aud === 'string' ? [aud] : [];
    if (!audList.includes(params.expectedAudience)) {
      throw new NearException('NEAR_PROVIDER_REJECTED', { message: 'JWT audience mismatch' });
    }
  }

  const sub = typeof payload.sub === 'string' && payload.sub.trim() ? payload.sub.trim() : '';
  if (!sub) {
    throw new NearException('NEAR_PROVIDER_REJECTED', { message: 'JWT missing subject' });
  }
  const email = typeof payload.email === 'string' ? payload.email : null;
  return { subject: sub, email };
}

/** Exchanges a PKCE authorization code (`fastauth-code:<code>:<verifier>:<redirectUri>`) with Auth0 `/oauth/token` and verifies the RS256 ID token. */
export async function verifyFastAuthPkceCode(params: {
  readonly rawToken: string;
  readonly issuer: string;
  readonly clientId: string;
}): Promise<VerifiedSocialClaims> {
  const [, rawCode = '', rawVerifier = '', rawRedirectUri = ''] = params.rawToken.split(':');
  const code = decodeURIComponent(rawCode).trim();
  const codeVerifier = decodeURIComponent(rawVerifier).trim();
  const redirectUri = decodeURIComponent(rawRedirectUri).trim();
  if (!code || !codeVerifier || !redirectUri) {
    throw new NearException('NEAR_PROVIDER_REJECTED', { message: 'Incomplete FastAuth PKCE code payload' });
  }
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
    throw new NearException('NEAR_PROVIDER_REJECTED', { message: `FastAuth token exchange HTTP ${tokenRes.status}` });
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
  });
}

/** Verifies a JSON-encoded FastAuth / NEP-413 ed25519 session signature token (`@fast-auth-near/browser-sdk`). */
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
