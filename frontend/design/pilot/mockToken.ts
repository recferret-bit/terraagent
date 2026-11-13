import {
  consumePendingNep413Redirect,
  encodeNep413SocialToken,
  saveRecentNep413PopupResult,
} from './nearAuthApi';
import { sha256Base64Url } from './pkceSha256';
import {
  consumePkceState,
  PKCE_STATE_STORAGE_KEY,
  randomCryptoToken,
  resolveFastAuthRedirectUri,
  savePkceState,
} from './pkceState';

export { PKCE_STATE_STORAGE_KEY, randomCryptoToken, resolveFastAuthRedirectUri };

export type AuthProviderKind = 'google' | 'x' | 'email' | 'fastauth' | 'near-wallet';

export interface MockTokenMessage {
  origin: string;
  source: unknown;
  data: unknown;
}

export interface MockToken {
  provider: AuthProviderKind;
  token: string;
}

export interface OAuthCallbackError {
  provider: AuthProviderKind;
  error: string;
  message: string;
}

const viteEnv =
  (typeof import.meta !== 'undefined' && (import.meta as { env?: Record<string, string | undefined> }).env) || {};

export const NEAR_TESTNET_WALLET_URL = 'https://testnet.mynearwallet.com';
export const NEAR_MAINNET_WALLET_URL = 'https://app.mynearwallet.com';
export const NEAR_FASTAUTH_ISSUER =
  viteEnv.VITE_NEAR_FASTAUTH_ISSUER?.trim() || 'https://dev-ep2ml1ryu5jcs8pz.us.auth0.com/';
export const NEAR_FASTAUTH_CLIENT_ID =
  viteEnv.VITE_NEAR_FASTAUTH_CLIENT_ID?.trim() || 'GhPTEx5u0o5Bh16F6LWjPXOXAyQROUNL';
export const NEAR_FASTAUTH_X_CONNECTION = viteEnv.VITE_NEAR_FASTAUTH_X_CONNECTION?.trim() || 'twitter';
export const OAUTH_CALLBACK_STORAGE_KEY = 'ta_oauth_callback';
export const OAUTH_ERROR_STORAGE_KEY = 'ta_oauth_error';

const PKCE_TTL_MS = 10 * 60_000;
const POPUP_NAMES = new Set([
  'terra-near-wallet',
  'terra-fastauth-oauth',
  'terra-fastauth-auth0',
  'terra-mock-oauth',
  'MyNearWallet',
]);
const VALID_PROVIDERS = new Set<string>(['google', 'x', 'email', 'fastauth', 'near-wallet']);

let pendingDirectOAuthError: OAuthCallbackError | null = null;

/** Consumes any OAuth callback error captured during an in-window redirect on mount. */
export function consumePendingOAuthError(): OAuthCallbackError | null {
  const err = pendingDirectOAuthError;
  pendingDirectOAuthError = null;
  return err;
}

function isAuthProvider(val: unknown): val is AuthProviderKind {
  return typeof val === 'string' && VALID_PROVIDERS.has(val);
}

function broadcastToOpener(
  storageKey: string,
  msgType: 'terra:mock-token' | 'terra:oauth-error',
  payload: object,
  origin: string,
  opener: Window | null | undefined,
  isSyntheticEnv: boolean,
): boolean {
  if (!isSyntheticEnv) {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ ...payload, at: Date.now() }));
    } catch {
      /* ignore */
    }
  }
  if (opener && (typeof window === 'undefined' || opener !== window)) {
    try {
      opener.postMessage({ type: msgType, ...payload }, origin);
      window.close();
      return true;
    } catch {
      /* fallback */
    }
  }
  if (!isSyntheticEnv && typeof window !== 'undefined' && POPUP_NAMES.has(window.name)) {
    try {
      window.close();
    } catch {
      /* ignore */
    }
    return true;
  }
  return false;
}

/**
 * Builds the NEAR FastAuth (OIDC + S256 PKCE) authorize URL for `google`, `x`, or `email`.
 * Persists single-use CSPRNG `stateId`, `code_verifier`, and `nonce` in client storage so `code_verifier`
 * is never exposed in the URL query string.
 */
export function buildFastAuthLoginUrl(
  origin: string,
  returnPath: string,
  provider: 'google' | 'x' | 'email',
  opts?: {
    readonly universalFallback?: boolean;
    readonly verifier?: string;
    readonly stateId?: string;
    readonly nonce?: string;
    readonly mode?: 'signin' | 'signup';
    readonly loginHint?: string;
  },
): string {
  const redirectUri = resolveFastAuthRedirectUri(origin, returnPath);
  const verifier = opts?.verifier ?? randomCryptoToken(36);
  const nonce = opts?.nonce ?? randomCryptoToken(24);
  const stateId = opts?.stateId ?? randomCryptoToken(24);
  savePkceState({
    stateId,
    provider,
    verifier,
    nonce,
    redirectUri,
    expiresAt: Date.now() + PKCE_TTL_MS,
  });

  const authorizeUrl = new URL('authorize', NEAR_FASTAUTH_ISSUER);
  authorizeUrl.searchParams.set('client_id', NEAR_FASTAUTH_CLIENT_ID);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('scope', 'openid profile email');
  authorizeUrl.searchParams.set('state', `terra-pkce:${provider}:${stateId}`);
  authorizeUrl.searchParams.set('nonce', nonce);
  authorizeUrl.searchParams.set('code_challenge', sha256Base64Url(verifier));
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  if (opts?.mode === 'signup') {
    authorizeUrl.searchParams.set('screen_hint', 'signup');
  }
  if (opts?.loginHint) {
    authorizeUrl.searchParams.set('login_hint', opts.loginHint);
  }
  if (!opts?.universalFallback && provider !== 'email') {
    authorizeUrl.searchParams.set('connection', provider === 'google' ? 'google-oauth2' : NEAR_FASTAUTH_X_CONNECTION);
  }
  return authorizeUrl.toString();
}

/** Builds a NEP-413 `sign-message` URL on MyNearWallet (`testnet` or `mainnet`). */
export function buildNearWalletSignMessageUrl(params: {
  readonly message: string;
  readonly nonce: string;
  readonly recipient: string;
  readonly callbackUrl: string;
  readonly state: string;
  readonly network?: 'testnet' | 'mainnet';
}): string {
  const baseUrl = params.network === 'mainnet' ? NEAR_MAINNET_WALLET_URL : NEAR_TESTNET_WALLET_URL;
  const href = new URL('/sign-message', baseUrl);
  href.searchParams.set('message', params.message);
  href.searchParams.set('nonce', params.nonce);
  href.searchParams.set('recipient', params.recipient);
  href.searchParams.set('callbackUrl', params.callbackUrl);
  href.searchParams.set('state', params.state);
  return href.toString();
}

export interface NearWalletCallbackEnv {
  readonly search?: string;
  readonly origin?: string;
  readonly pathname?: string;
  readonly hash?: string;
  readonly opener?: Window | null;
  readonly challengeId?: string;
}

function formatFastAuthError(provider: AuthProviderKind, errorCode: string, errorDesc: string): string {
  const desc = errorDesc.toLowerCase();
  if (desc.includes('connection is not enabled')) {
    return provider === 'x'
      ? `X sign-in is not enabled in Auth0 yet (enable the "${NEAR_FASTAUTH_X_CONNECTION}" social connection).`
      : 'Google sign-in is not enabled in Auth0 yet.';
  }
  if (errorCode.toLowerCase() === 'access_denied') {
    return 'Sign-in was cancelled.';
  }
  return 'Sign-in could not be completed. Please try again.';
}

function recordCallbackError(
  errPayload: OAuthCallbackError,
  origin: string,
  opener: Window | null | undefined,
  isSyntheticEnv: boolean,
): null {
  if (!broadcastToOpener(OAUTH_ERROR_STORAGE_KEY, 'terra:oauth-error', errPayload, origin, opener, isSyntheticEnv)) {
    pendingDirectOAuthError = errPayload;
  }
  return null;
}

function cleanBrowserAddress(pathname: string, params: URLSearchParams, hash: string, isSyntheticEnv: boolean): void {
  if (isSyntheticEnv) return;
  const nextQuery = params.toString();
  const cleanUrl = `${pathname}${nextQuery ? `?${nextQuery}` : ''}${hash}`;
  try {
    history.replaceState(null, '', cleanUrl);
  } catch {
    /* ignore */
  }
}

function consumeStoredPkceRedirect(
  params: URLSearchParams,
  state: string,
  origin: string,
  pathname: string,
  hash: string,
  opener: Window | null | undefined,
  isSyntheticEnv: boolean,
): MockToken | null {
  const [, rawProvider = 'google', stateId = ''] = state.split(':');
  const provider: 'google' | 'x' | 'email' =
    rawProvider === 'x' ? 'x' : rawProvider === 'email' ? 'email' : 'google';
  const errorCode = (params.get('error') ?? '').trim();
  const errorDesc = (params.get('error_description') ?? '').trim();
  const code = (params.get('code') ?? '').trim();

  for (const key of ['code', 'state', 'error', 'error_description', 'iss']) {
    params.delete(key);
  }
  cleanBrowserAddress(pathname, params, hash, isSyntheticEnv);

  const stored = stateId ? consumePkceState(stateId) : null;
  if (!stored || stored.provider !== provider) {
    return recordCallbackError(
      { provider, error: 'state_mismatch', message: 'Sign-in session expired or state did not match. Please try again.' },
      origin,
      opener,
      isSyntheticEnv,
    );
  }
  if (!code) {
    return recordCallbackError(
      { provider, error: errorCode || 'oauth_error', message: formatFastAuthError(provider, errorCode, errorDesc) },
      origin,
      opener,
      isSyntheticEnv,
    );
  }

  const token = [
    'fastauth-code',
    encodeURIComponent(code),
    encodeURIComponent(stored.verifier),
    encodeURIComponent(stored.redirectUri),
    encodeURIComponent(stored.nonce),
  ].join(':');
  const hit: MockToken = { provider, token };
  if (broadcastToOpener(OAUTH_CALLBACK_STORAGE_KEY, 'terra:mock-token', hit, origin, opener, isSyntheticEnv)) {
    return null;
  }
  return hit;
}

function isPopupRedirectWindow(opener: Window | null | undefined, isSyntheticEnv: boolean): boolean {
  if (opener && (typeof window === 'undefined' || opener !== window)) return true;
  return !isSyntheticEnv && typeof window !== 'undefined' && POPUP_NAMES.has(window.name);
}

function closePopupWindow(shouldClose: boolean): null {
  if (shouldClose && typeof window !== 'undefined') {
    try {
      window.close();
    } catch {
      /* ignore */
    }
  }
  return null;
}

function consumeNep413WalletRedirect(
  params: URLSearchParams,
  hashParams: URLSearchParams,
  origin: string,
  pathname: string,
  opener: Window | null | undefined,
  env?: NearWalletCallbackEnv,
): MockToken | null {
  const isSyntheticEnv = Boolean(env);
  const accountId = (hashParams.get('accountId') ?? params.get('accountId') ?? '').trim().toLowerCase();
  const publicKey = (hashParams.get('publicKey') ?? params.get('publicKey') ?? '').trim();
  const signature = (hashParams.get('signature') ?? params.get('signature') ?? '').trim();
  const state = (hashParams.get('state') ?? params.get('state') ?? '').trim();
  const walletErr = (hashParams.get('error') ?? params.get('error') ?? '').trim();

  if (!accountId && !signature && !walletErr) return null;

  for (const key of ['accountId', 'publicKey', 'signature', 'state', 'error']) {
    hashParams.delete(key);
    params.delete(key);
  }
  const remHash = hashParams.toString();
  cleanBrowserAddress(pathname, params, remHash ? `#${remHash}` : '', isSyntheticEnv);

  const isPopup = isPopupRedirectWindow(opener, isSyntheticEnv);
  const isSignerState = state.startsWith('signer-');

  if (walletErr || !accountId || !publicKey || !signature) {
    if (isSignerState) {
      consumePendingNep413Redirect(state);
      return closePopupWindow(!isSyntheticEnv && isPopup);
    }
    return recordCallbackError(
      {
        provider: 'near-wallet',
        error: walletErr || 'signature_cancelled',
        message: 'NEAR wallet signature was cancelled or incomplete.',
      },
      origin,
      opener,
      isSyntheticEnv,
    );
  }

  const pending = consumePendingNep413Redirect(state || undefined);
  const challengeId = pending?.challengeId ?? (env?.challengeId && env.challengeId === state ? env.challengeId : '');
  const callbackUrl = pending?.callbackUrl ?? `${origin}${pathname}`;
  if (!challengeId) {
    if (isSignerState) return closePopupWindow(!isSyntheticEnv && isPopup);
    return recordCallbackError(
      {
        provider: 'near-wallet',
        error: 'challenge_mismatch',
        message: 'NEAR sign-in challenge expired or did not match this session. Please try again.',
      },
      origin,
      opener,
      isSyntheticEnv,
    );
  }

  const verifyPayload = {
    challengeId,
    accountId,
    publicKey,
    signature,
    callbackUrl,
    walletId: pending?.walletId ?? 'my-near-wallet',
  };
  if (!isSyntheticEnv) {
    if (isPopup || challengeId.startsWith('signer-')) {
      saveRecentNep413PopupResult(verifyPayload);
    }
    try {
      localStorage.setItem(
        'ta_near_wallet',
        JSON.stringify({
          walletId: verifyPayload.walletId,
          walletName: 'MyNearWallet',
          accountId,
          publicKey,
          connectedAt: Date.now(),
        }),
      );
    } catch {
      /* ignore */
    }
  }
  if (challengeId.startsWith('signer-')) {
    return closePopupWindow(!isSyntheticEnv && isPopup);
  }
  const hit: MockToken = { provider: 'near-wallet', token: encodeNep413SocialToken(verifyPayload) };
  if (broadcastToOpener(OAUTH_CALLBACK_STORAGE_KEY, 'terra:mock-token', hit, origin, opener, isSyntheticEnv)) {
    return null;
  }
  return hit;
}

/**
 * Consumes OAuth PKCE (`?code=...&state=terra-pkce:...`) and NEP-413 MyNearWallet
 * (`#accountId=...&publicKey=...&signature=...&state=...`) redirects.
 * Unsigned legacy `?near_wallet_callback=1&account_id=...` redirects are rejected.
 */
export function consumeNearWalletCallback(env?: NearWalletCallbackEnv): MockToken | null {
  if (!env && (typeof window === 'undefined' || typeof location === 'undefined')) return null;
  const search = env?.search ?? location.search;
  const origin = env?.origin ?? location.origin;
  const pathname = env?.pathname ?? location.pathname;
  const hash = env?.hash ?? (typeof location !== 'undefined' ? location.hash : '');
  const opener =
    env && 'opener' in env ? env.opener : typeof window !== 'undefined' ? (window.opener as Window | null) : null;

  const params = new URLSearchParams(search);
  const state = params.get('state') ?? '';
  if (state.startsWith('terra-pkce:')) {
    return consumeStoredPkceRedirect(params, state, origin, pathname, hash, opener, Boolean(env));
  }

  const hashParams = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const nep413Hit = consumeNep413WalletRedirect(params, hashParams, origin, pathname, opener, env);
  if (nep413Hit) return nep413Hit;

  if (params.get('near_wallet_callback') === '1' || params.get('near_wallet_error') === '1') {
    for (const key of ['near_wallet_callback', 'near_wallet_error', 'account_id', 'public_key', 'all_keys']) {
      params.delete(key);
    }
    cleanBrowserAddress(pathname, params, hash, Boolean(env));
    return recordCallbackError(
      {
        provider: 'near-wallet',
        error: 'unsigned_callback_rejected',
        message: 'Unsigned NEAR wallet redirect rejected. Please confirm the NEP-413 signature in your wallet.',
      },
      origin,
      opener,
      Boolean(env),
    );
  }
  return null;
}

/** Accepts only a `terra:mock-token` from the popup this page opened, on this origin. Anything else is ignored. */
export function readMockToken(event: MockTokenMessage, popup: unknown, origin: string): MockToken | null {
  if (event.origin !== origin || popup == null || event.source !== popup) return null;
  const data = event.data;
  if (!data || typeof data !== 'object') return null;
  const rec = data as { type?: unknown; provider?: unknown; token?: unknown };
  if (rec.type !== 'terra:mock-token' || !isAuthProvider(rec.provider)) return null;
  if (typeof rec.token !== 'string' || rec.token.length === 0) return null;
  return { provider: rec.provider, token: rec.token };
}

/** Reads and clears a popup callback token written to `localStorage` (`ta_oauth_callback`) when COOP severs `window.opener`. */
export function readOAuthStorageEvent(event: StorageEvent, hasPopup: boolean): MockToken | null {
  if (event.key !== OAUTH_CALLBACK_STORAGE_KEY || !event.newValue || !hasPopup) return null;
  try {
    const parsed = JSON.parse(event.newValue) as Partial<MockToken>;
    if (isAuthProvider(parsed.provider) && typeof parsed.token === 'string' && parsed.token.length > 0) {
      try {
        localStorage.removeItem(OAUTH_CALLBACK_STORAGE_KEY);
      } catch {
        /* ignore */
      }
      return { provider: parsed.provider, token: parsed.token };
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Reads an OAuth error message posted back by the popup on the same origin. */
export function readOAuthError(event: MockTokenMessage, popup: unknown, origin: string): OAuthCallbackError | null {
  if (event.origin !== origin || popup == null || event.source !== popup) return null;
  const data = event.data;
  if (!data || typeof data !== 'object') return null;
  const rec = data as { type?: unknown; provider?: unknown; error?: unknown; message?: unknown };
  if (rec.type !== 'terra:oauth-error' || !isAuthProvider(rec.provider)) return null;
  if (typeof rec.message !== 'string' || rec.message.length === 0) return null;
  return {
    provider: rec.provider,
    error: typeof rec.error === 'string' && rec.error ? rec.error : 'oauth_error',
    message: rec.message,
  };
}

/** Reads and clears a popup OAuth error written to `localStorage` (`ta_oauth_error`) when COOP severs `window.opener`. */
export function readOAuthErrorStorageEvent(event: StorageEvent, hasPopup: boolean): OAuthCallbackError | null {
  if (event.key !== OAUTH_ERROR_STORAGE_KEY || !event.newValue || !hasPopup) return null;
  try {
    const parsed = JSON.parse(event.newValue) as Partial<OAuthCallbackError>;
    if (isAuthProvider(parsed.provider) && typeof parsed.message === 'string' && parsed.message.length > 0) {
      try {
        localStorage.removeItem(OAUTH_ERROR_STORAGE_KEY);
      } catch {
        /* ignore */
      }
      return {
        provider: parsed.provider,
        error: typeof parsed.error === 'string' && parsed.error ? parsed.error : 'oauth_error',
        message: parsed.message,
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}
