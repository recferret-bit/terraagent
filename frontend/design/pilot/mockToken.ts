export interface MockTokenMessage {
  origin: string;
  source: unknown;
  data: unknown;
}

export interface MockToken {
  provider: 'google' | 'x' | 'fastauth';
  token: string;
}

export const NEAR_TESTNET_WALLET_LOGIN_URL = 'https://testnet.mynearwallet.com/login/';
export const NEAR_FASTAUTH_ISSUER = 'https://dev-ep2ml1ryu5jcs8pz.us.auth0.com/';
export const NEAR_FASTAUTH_CLIENT_ID = 'GhPTEx5u0o5Bh16F6LWjPXOXAyQROUNL';

function randomVerifier(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 48; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)]!;
  }
  return out;
}

/**
 * Builds the real NEAR FastAuth (Auth0 OIDC + PKCE) authorize URL for `google` (`google-oauth2`) or `x` (`twitter`).
 */
export function buildFastAuthLoginUrl(
  origin: string,
  returnPath: string,
  provider: 'google' | 'x',
  opts?: { readonly universalFallback?: boolean; readonly verifier?: string },
): string {
  const redirectTarget = new URL(returnPath || '/', origin);
  redirectTarget.search = '';
  redirectTarget.hash = '';
  const redirectUri = redirectTarget.toString();
  const verifier = opts?.verifier ?? randomVerifier();
  const state = `terra-fastauth:${provider}:${verifier}:${encodeURIComponent(redirectUri)}`;

  const authorizeUrl = new URL('authorize', NEAR_FASTAUTH_ISSUER);
  authorizeUrl.searchParams.set('client_id', NEAR_FASTAUTH_CLIENT_ID);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('scope', 'openid profile email');
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('code_challenge', verifier);
  authorizeUrl.searchParams.set('code_challenge_method', 'plain');
  if (!opts?.universalFallback) {
    authorizeUrl.searchParams.set('connection', provider === 'google' ? 'google-oauth2' : 'twitter');
  }
  return authorizeUrl.toString();
}

/** Builds the real NEAR Testnet Wallet (`testnet.mynearwallet.com`) login URL with callback URLs on `origin`. */
export function buildNearWalletLoginUrl(origin: string, returnPath: string): string {
  const base = new URL(returnPath || '/', origin);
  base.searchParams.delete('near_wallet_callback');
  base.searchParams.delete('near_wallet_error');
  base.searchParams.delete('account_id');
  base.searchParams.delete('public_key');
  base.searchParams.delete('all_keys');

  const successUrl = new URL(base.toString());
  successUrl.searchParams.set('near_wallet_callback', '1');

  const failureUrl = new URL(base.toString());
  failureUrl.searchParams.set('near_wallet_error', '1');

  const loginUrl = new URL(NEAR_TESTNET_WALLET_LOGIN_URL);
  loginUrl.searchParams.set('referrer', 'TerraAgent');
  loginUrl.searchParams.set('success_url', successUrl.toString());
  loginUrl.searchParams.set('failure_url', failureUrl.toString());
  return loginUrl.toString();
}

export interface NearWalletCallbackEnv {
  readonly search?: string;
  readonly origin?: string;
  readonly pathname?: string;
  readonly hash?: string;
  readonly opener?: Window | null;
}

/**
 * Handles the redirect back from `testnet.mynearwallet.com/login/` (`?near_wallet_callback=1&account_id=...`).
 * When running inside the popup window, posts the token to `window.opener` and closes the popup.
 * When running in the main window, returns `{ provider: 'fastauth', token }` directly.
 */
export function consumeNearWalletCallback(env?: NearWalletCallbackEnv): MockToken | null {
  if (!env && (typeof window === 'undefined' || typeof location === 'undefined')) return null;
  const search = env?.search ?? location.search;
  const origin = env?.origin ?? location.origin;
  const pathname = env?.pathname ?? location.pathname;
  const hash = env?.hash ?? (typeof location !== 'undefined' ? location.hash : '');
  const opener = env && 'opener' in env ? env.opener : (typeof window !== 'undefined' ? window.opener as Window | null : null);

  const params = new URLSearchParams(search);
  const state = params.get('state') ?? '';
  if (state.startsWith('terra-fastauth:')) {
    return consumeFastAuthRedirect(params, state, origin, pathname, hash, opener, Boolean(env));
  }
  const isCallback = params.get('near_wallet_callback') === '1';
  const isError = params.get('near_wallet_error') === '1';
  if (!isCallback && !isError) return null;

  const accountId = (params.get('account_id') ?? '').trim();
  const publicKey = (params.get('public_key') ?? params.get('all_keys')?.split(',')[0] ?? '').trim();

  params.delete('near_wallet_callback');
  params.delete('near_wallet_error');
  params.delete('account_id');
  params.delete('public_key');
  params.delete('all_keys');
  const nextQuery = params.toString();
  const cleanUrl = `${pathname}${nextQuery ? `?${nextQuery}` : ''}${hash}`;
  if (!env) {
    try {
      history.replaceState(null, '', cleanUrl);
    } catch {
      /* ignore history replace errors */
    }
  }

  if (isError || !accountId) {
    if (opener && (typeof window === 'undefined' || opener !== window)) {
      try { window.close(); } catch { /* ignore */ }
    }
    return null;
  }

  const token = publicKey ? `near-wallet:${accountId}:${publicKey}` : `near-wallet:${accountId}`;
  const hit: MockToken = { provider: 'fastauth', token };

  if (opener && (typeof window === 'undefined' || opener !== window)) {
    try {
      opener.postMessage({ type: 'terra:mock-token', ...hit }, origin);
      window.close();
      return null;
    } catch {
      /* fallback to in-window login */
    }
  }
  return hit;
}

function consumeFastAuthRedirect(
  params: URLSearchParams,
  state: string,
  origin: string,
  pathname: string,
  hash: string,
  opener: Window | null | undefined,
  isSyntheticEnv: boolean,
): MockToken | null {
  const [, rawProvider, verifier = '', encodedRedirect = ''] = state.split(':');
  const provider: 'google' | 'x' = rawProvider === 'x' ? 'x' : 'google';
  const errorDesc = (params.get('error_description') ?? '').toLowerCase();
  const code = (params.get('code') ?? '').trim();

  if (!code && provider === 'x' && errorDesc.includes('connection is not enabled') && !isSyntheticEnv && typeof location !== 'undefined') {
    const fallbackUrl = buildFastAuthLoginUrl(origin, pathname, 'x', { universalFallback: true, verifier });
    location.replace(fallbackUrl);
    return null;
  }

  params.delete('code');
  params.delete('state');
  params.delete('error');
  params.delete('error_description');
  params.delete('iss');
  const nextQuery = params.toString();
  const cleanUrl = `${pathname}${nextQuery ? `?${nextQuery}` : ''}${hash}`;
  if (!isSyntheticEnv) {
    try { history.replaceState(null, '', cleanUrl); } catch { /* ignore */ }
  }

  if (!code || !verifier) {
    if (opener && (typeof window === 'undefined' || opener !== window)) {
      try { window.close(); } catch { /* ignore */ }
    }
    return null;
  }

  const redirectUri = encodedRedirect ? decodeURIComponent(encodedRedirect) : `${origin}${pathname}`;
  const token = `fastauth-code:${encodeURIComponent(code)}:${encodeURIComponent(verifier)}:${encodeURIComponent(redirectUri)}`;
  const hit: MockToken = { provider, token };

  if (opener && (typeof window === 'undefined' || opener !== window)) {
    try {
      opener.postMessage({ type: 'terra:mock-token', ...hit }, origin);
      window.close();
      return null;
    } catch {
      /* fallback to in-window login */
    }
  }
  return hit;
}

/** Accepts only a `terra:mock-token` from the popup this page opened, on this origin. Anything else is ignored. */
export function readMockToken(event: MockTokenMessage, popup: unknown, origin: string): MockToken | null {
  if (event.origin !== origin || popup == null || event.source !== popup) return null;
  const data = event.data;
  if (!data || typeof data !== 'object') return null;
  const rec = data as { type?: unknown; provider?: unknown; token?: unknown };
  if (rec.type !== 'terra:mock-token') return null;
  if (rec.provider !== 'google' && rec.provider !== 'x' && rec.provider !== 'fastauth') return null;
  if (typeof rec.token !== 'string' || rec.token.length === 0) return null;
  return { provider: rec.provider, token: rec.token };
}
