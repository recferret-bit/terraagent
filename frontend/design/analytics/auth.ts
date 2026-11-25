import { getConsent } from '../../game/core/analytics';
import { browserDeps } from '../../game/core/analytics/browser';
import { currentSurface, runtimeLabel } from './context';
import { trackProduct } from './trackSafe';

const METHODS = ['google', 'x', 'email', 'near-wallet', 'fastauth'] as const;
const WALLETS = ['none', 'meteor-wallet', 'okx-wallet', 'near-mobile-wallet', 'intear-wallet', 'my-near-wallet', 'other'] as const;

export type AuthMethod = (typeof METHODS)[number];
export type WalletKind = (typeof WALLETS)[number];
export type AuthStage = 'popup' | 'oauth' | 'verify' | 'restore';
export type AuthReason = 'popup_blocked' | 'dismissed' | 'oauth_error' | 'rejected' | 'network' | 'invalid' | 'timeout' | 'unknown';

export interface AuthFailureInput {
  readonly popupBlocked?: boolean;
  readonly dismissed?: boolean;
  readonly oauth?: boolean;
  readonly network?: boolean;
  readonly invalid?: boolean;
  readonly timeout?: boolean;
  readonly restore?: boolean;
  readonly status?: number;
}

interface Attempt { method: AuthMethod; wallet: WalletKind; generation: number }

let generation = 0;
let settled = true;
let pending: Attempt | undefined;
let stopWatch: () => void = () => {};

export function walletKindOf(id: string): WalletKind {
  return (WALLETS as readonly string[]).includes(id) ? id as WalletKind : 'other';
}

export function authMethodOf(id: string): AuthMethod | undefined {
  return (METHODS as readonly string[]).includes(id) ? id as AuthMethod : undefined;
}

/** Closed mapper. Every catalog auth reason is a literal here; anything else is `unknown`. */
export function classifyAuthFailure(input: AuthFailureInput): { stage: AuthStage; reason: AuthReason } {
  const reason = reasonOf(input);
  if (input.restore) return { stage: 'restore', reason };
  if (reason === 'popup_blocked' || reason === 'dismissed') return { stage: 'popup', reason };
  if (reason === 'oauth_error') return { stage: 'oauth', reason };
  return { stage: 'verify', reason };
}

function reasonOf(input: AuthFailureInput): AuthReason {
  if (input.popupBlocked) return 'popup_blocked';
  if (input.dismissed) return 'dismissed';
  if (input.oauth) return 'oauth_error';
  if (input.timeout) return 'timeout';
  if (input.network) return 'network';
  if (input.invalid || input.status === 400 || input.status === 422) return 'invalid';
  if (typeof input.status === 'number' && input.status >= 400 && input.status < 500) return 'rejected';
  return 'unknown';
}

export function beginAuth(method: AuthMethod, wallet: WalletKind = 'none'): number {
  stopProviderWatch();
  generation += 1;
  settled = false;
  pending = { method, wallet, generation };
  trackAuth('auth_started', method, wallet);
  return generation;
}

export function trackProviderPopup(method: 'google' | 'x', popup: Window | null): Window | null {
  const gen = beginAuth(method, 'none');
  if (!popup) {
    failAuth(gen, { popupBlocked: true });
    return null;
  }
  const timer = setInterval(() => {
    try {
      if (popup.closed) failAuth(gen, { dismissed: true });
    } catch { /* a cross-origin popup can still be observed via closed */ }
  }, 400);
  stopWatch = () => clearInterval(timer);
  return popup;
}

export function stopProviderWatch(): void {
  stopWatch();
  stopWatch = () => {};
}

export function beginEmailAuth(): number {
  return beginAuth('email', 'none');
}

export function beginNearWalletAuth(walletId: string): number {
  return beginAuth('near-wallet', walletKindOf(walletId));
}

export function rememberAuthProvider(provider: string, walletId?: string): void {
  const method = authMethodOf(provider);
  if (!method) return;
  const wallet: WalletKind = method === 'near-wallet'
    ? (walletId ? walletKindOf(walletId) : pending?.wallet ?? 'other')
    : 'none';
  if (!pending || settled) {
    beginAuth(method, wallet);
    return;
  }
  pending = { ...pending, method, wallet };
}

export function failAuth(gen: number, input: AuthFailureInput): void {
  if (settled || gen !== generation) return;
  settled = true;
  stopProviderWatch();
  const failure = classifyAuthFailure(input);
  const method = pending?.method ?? 'google';
  const wallet = pending?.wallet ?? 'none';
  trackProduct('auth_failed', {
    method, wallet_kind: wallet, surface: currentSurface(), stage: failure.stage, reason: failure.reason, runtime: runtimeLabel(),
  });
}

export function failCurrentAuth(input: AuthFailureInput): void {
  failAuth(generation, input);
}

export function failEmailAuth(err: unknown): void {
  failCurrentAuth(classifyThrownAuth(err));
}

export function failNearWalletAuth(err: unknown): void {
  failCurrentAuth(classifyThrownAuth(err));
}

export function failOAuthMessage(): void {
  failCurrentAuth({ oauth: true });
}

export function failAuthHttp(status: number): void {
  failCurrentAuth(status === 408 ? { timeout: true } : { status });
}

export function failAuthThrown(err: unknown): void {
  failCurrentAuth(classifyThrownAuth(err));
}

/** Client step after the auth HTTP response is ok. Never emits `auth_completed` (server only). */
export function succeedAuth(): void {
  if (settled || !pending) return;
  settled = true;
  stopProviderWatch();
  trackAuth('auth_succeeded', pending.method, pending.wallet);
}

function trackAuth(name: 'auth_started' | 'auth_succeeded', method: AuthMethod, wallet: WalletKind): void {
  trackProduct(name, { method, wallet_kind: wallet, surface: currentSurface(), runtime: runtimeLabel() });
}

export function classifyThrownAuth(err: unknown): AuthFailureInput {
  const name = err instanceof Error ? err.name : '';
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const lower = message.toLowerCase();
  return {
    popupBlocked: name === 'WalletPopupBlockedError' || (/popup/.test(lower) && /block/.test(lower)),
    dismissed: /cancel|dismiss|popup closed|access_denied/.test(lower),
    timeout: name === 'TimeoutError' || /timeout|timed out/.test(lower),
    network: err instanceof TypeError || /network|failed to fetch/.test(lower),
    oauth: /oauth/.test(lower),
    invalid: name === 'ZodError',
  };
}

export function consentedAnonHeader(): Record<string, string> {
  if (!getConsent()) return {};
  const anon = anonId();
  return anon ? { 'x-terra-anon': anon } : {};
}

export function consentedAuthHeaders(): Record<string, string> {
  if (!getConsent()) return {};
  return { ...consentedAnonHeader(), 'x-terra-wallet': pending?.wallet ?? 'none' };
}

function anonId(): string {
  return browserDeps().anonId();
}
