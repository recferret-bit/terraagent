import { Auth0Client } from '@auth0/auth0-spa-js';
import {
  NEAR_FASTAUTH_CLIENT_ID,
  NEAR_FASTAUTH_ISSUER,
  randomCryptoToken,
  resolveFastAuthRedirectUri,
} from './mockToken';

export interface FastAuthEmailPopupOptions {
  readonly email?: string;
  readonly mode?: 'signin' | 'signup';
}

export interface FastAuthIdTokenResult {
  readonly idToken: string;
  readonly email: string | null;
}

type FastAuthPopupDriver = (opts: FastAuthEmailPopupOptions) => Promise<FastAuthIdTokenResult>;

let cachedSpaClient: Auth0Client | null = null;
let testPopupDriver: FastAuthPopupDriver | null = null;

/** Test seam for jsdom specs verifying `@auth0/auth0-spa-js` email/passkey flows. */
export function setFastAuthPopupDriverForTests(driver: FastAuthPopupDriver | null): void {
  testPopupDriver = driver;
}

function resolveAuth0Domain(issuerUrl: string): string {
  try {
    return new URL(issuerUrl).host;
  } catch {
    return issuerUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  }
}

function getFastAuthSpaClient(): Auth0Client {
  if (cachedSpaClient) return cachedSpaClient;
  const origin = typeof location !== 'undefined' ? location.origin : 'http://127.0.0.1:5173';
  const pathname = typeof location !== 'undefined' ? location.pathname : '/';
  cachedSpaClient = new Auth0Client({
    domain: resolveAuth0Domain(NEAR_FASTAUTH_ISSUER),
    clientId: NEAR_FASTAUTH_CLIENT_ID,
    useRefreshTokens: false,
    cacheLocation: 'memory',
    authorizationParams: {
      redirect_uri: resolveFastAuthRedirectUri(origin, pathname),
      scope: 'openid profile email',
    },
  });
  return cachedSpaClient;
}

export function isFastAuthPopupCancelled(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const rec = err as { name?: unknown; error?: unknown; message?: unknown };
  if (rec.name === 'PopupCancelledError' || rec.error === 'cancelled' || rec.error === 'access_denied') {
    return true;
  }
  if (typeof rec.message === 'string') {
    const lower = rec.message.toLowerCase();
    return lower.includes('popup closed') || lower.includes('cancelled') || lower.includes('canceled');
  }
  return false;
}

/**
 * Authenticates or registers a NEAR Testnet pilot via `@auth0/auth0-spa-js` (Email OTP / Passkey)
 * using OIDC Authorization Code + PKCE in a synchronously opened popup and returns the signed RS256 ID token.
 */
export async function authenticateFastAuthEmailPopup(
  opts: FastAuthEmailPopupOptions = {},
): Promise<FastAuthIdTokenResult> {
  if (testPopupDriver) {
    return testPopupDriver(opts);
  }
  const client = getFastAuthSpaClient();
  const nonce = randomCryptoToken(24);
  const cleanEmail = opts.email?.trim().toLowerCase();
  const origin = typeof location !== 'undefined' ? location.origin : 'http://127.0.0.1:5173';
  const pathname = typeof location !== 'undefined' ? location.pathname : '/';
  const popup =
    typeof window !== 'undefined' && typeof window.open === 'function'
      ? window.open('', 'terra-fastauth-auth0', 'popup,width=500,height=680')
      : null;
  if (!popup) {
    throw new Error('Popup window was blocked by the browser. Allow popups for this site and try again.');
  }
  try {
    await client.loginWithPopup(
      {
        authorizationParams: {
          redirect_uri: resolveFastAuthRedirectUri(origin, pathname),
          scope: 'openid profile email',
          nonce,
          ...(cleanEmail ? { login_hint: cleanEmail } : {}),
          ...(opts.mode === 'signup' ? { screen_hint: 'signup' } : {}),
        },
      },
      { popup },
    );
    const claims = await client.getIdTokenClaims();
    const rawIdToken = claims?.__raw;
    if (!rawIdToken) {
      throw new Error('NEAR FastAuth completed without returning an OIDC ID token.');
    }
    if (typeof claims?.nonce === 'string' && claims.nonce !== nonce) {
      throw new Error('NEAR FastAuth OIDC nonce mismatch.');
    }
    return {
      idToken: rawIdToken,
      email: typeof claims.email === 'string' ? claims.email : cleanEmail ?? null,
    };
  } catch (err) {
    try {
      if (!popup.closed && typeof popup.close === 'function') popup.close();
    } catch { /* ignore cross-origin popup close errors */ }
    throw err;
  }
}
