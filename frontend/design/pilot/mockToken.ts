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
