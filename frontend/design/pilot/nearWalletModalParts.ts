import type { NearAuthChallengeResponse } from '@terra/contracts';
import { requestNearAuthChallenge } from './nearAuthApi';
import { WalletPopupBlockedError, type WalletSelectorModuleId } from './walletSelectorRuntime';

export interface SavedNearWallet {
  readonly walletId: string;
  readonly walletName: string;
  readonly accountId: string;
  readonly publicKey?: string;
  readonly connectedAt: number;
}

export interface SelectorWalletDef {
  readonly testId: string;
  readonly moduleId: WalletSelectorModuleId;
  readonly name: string;
  readonly subtitle: string;
  readonly signupUrl: string;
  readonly signupActionLabel: string;
}

const STORAGE_KEY = 'ta_near_wallet';
const NEAR_ACCOUNT_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const GENERIC_WALLET_SIGN_ERR_RE = /^(sign error|failed to sign in)$/i;
export const MIN_PREWARMED_CHALLENGE_TTL_MS = 15_000;

const MODAL_CSS = `
.near-modal{margin:auto;padding:var(--ta-s5);width:min(460px,92vw);background:var(--ta-plate);color:var(--ta-text);border:1px solid var(--ta-seam-2);overscroll-behavior:contain}
.near-modal.is-signing{position:fixed;inset:0;margin:auto;height:fit-content;max-height:90vh;overflow-y:auto;z-index:900;box-shadow:0 24px 64px rgba(0,0,0,.72)}
.near-modal::backdrop{background:color-mix(in srgb,var(--ta-black-hole) 78%,transparent);backdrop-filter:blur(4px)}
.near-modal-head{display:flex;align-items:center;justify-content:space-between;gap:var(--ta-s3);margin-bottom:var(--ta-s3)}
.near-modal-tabs{display:grid;grid-template-columns:1fr 1fr;gap:var(--ta-s2);margin-bottom:var(--ta-s3)}
.near-modal-sub{font-size:var(--ta-fs-eyebrow);color:var(--ta-text-3);margin:0 0 var(--ta-s3);line-height:1.45}
.near-wallet-grid{display:grid;grid-template-columns:1fr 1fr;gap:var(--ta-s2);margin-bottom:var(--ta-s3)}
.near-wallet-opt{display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:10px 12px;text-align:left;background:var(--ta-plate-2);border:1px solid var(--ta-seam);color:var(--ta-text);cursor:pointer;font-family:var(--ta-font-display)}
.near-wallet-opt:hover:not(:disabled){border-color:var(--ta-orange);background:color-mix(in srgb,var(--ta-orange) 8%,var(--ta-plate-2))}
.near-wallet-opt:disabled{opacity:.55;cursor:wait}
.near-wallet-opt b{font-size:14px;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
.near-wallet-opt span{font-family:var(--ta-font-mono);font-size:var(--ta-fs-label);color:var(--ta-text-3)}
.near-wallet-panel{padding:var(--ta-s3);background:var(--ta-plate-2);border:1px solid var(--ta-seam-2);display:flex;flex-direction:column;gap:var(--ta-s2);margin-top:var(--ta-s2)}
.near-wallet-panel code{display:block;padding:var(--ta-s2) 10px;background:var(--ta-void);border:1px solid var(--ta-seam);font-family:var(--ta-font-mono);font-size:var(--ta-fs-label);color:var(--ta-orange-hi);word-break:break-all;white-space:pre-wrap;user-select:all}
.near-wallet-panel input{width:100%;box-sizing:border-box}
.near-cli-hint{font-family:var(--ta-font-mono);font-size:var(--ta-fs-label);color:var(--ta-text-2)}
.near-wallet-saved{display:flex;align-items:center;justify-content:space-between;gap:var(--ta-s2);padding:10px 12px;margin-bottom:var(--ta-s3);background:color-mix(in srgb,var(--ta-orange) 10%,var(--ta-plate-2));border:1px solid var(--ta-orange)}
.near-wallet-saved span{font-family:var(--ta-font-mono);font-size:12px;color:var(--ta-text)}
.near-wallet-step{font-family:var(--ta-font-mono);font-size:12px;color:var(--ta-blue-hi);margin:0}
.near-wallet-err{font-family:var(--ta-font-mono);font-size:12px;color:var(--ta-fault-text);margin:0}
.near-signup-links{display:flex;flex-wrap:wrap;gap:var(--ta-s2)}
`;

export const SELECTOR_WALLETS: readonly SelectorWalletDef[] = [
  {
    testId: 'near-wallet-meteor',
    moduleId: 'meteor-wallet',
    name: 'Meteor Wallet',
    subtitle: 'EXTENSION / WEB · TESTNET',
    signupUrl: 'https://wallet.meteorwallet.app',
    signupActionLabel: 'Create Meteor Testnet Wallet ↗',
  },
  {
    testId: 'near-wallet-okx',
    moduleId: 'okx-wallet',
    name: 'OKX Wallet',
    subtitle: 'EXTENSION · TESTNET',
    signupUrl: 'https://web3.okx.com/download',
    signupActionLabel: 'Install OKX Extension ↗',
  },
  {
    testId: 'near-wallet-mobile',
    moduleId: 'near-mobile-wallet',
    name: 'NEAR Mobile',
    subtitle: 'QR / APP PAIR · TESTNET',
    signupUrl: 'https://nearmobile.app',
    signupActionLabel: 'Get NEAR Mobile (iOS / Android) ↗',
  },
  {
    testId: 'near-wallet-intear',
    moduleId: 'intear-wallet',
    name: 'Intear Wallet',
    subtitle: 'WEB / DESKTOP · TESTNET',
    signupUrl: 'https://wallet.intear.tech',
    signupActionLabel: 'Create Intear Testnet Wallet ↗',
  },
  {
    testId: 'near-wallet-mynearwallet',
    moduleId: 'my-near-wallet',
    name: 'MyNearWallet',
    subtitle: 'TESTNET WEB WALLET',
    signupUrl: 'https://testnet.mynearwallet.com/create',
    signupActionLabel: 'Create MyNearWallet (.testnet) ↗',
  },
];

export function friendlyWalletError(
  err: unknown,
  network: 'testnet' | 'mainnet' = 'testnet',
  fallback = 'Wallet signature could not be completed.',
): string {
  const raw = err instanceof Error ? err.message.trim() : typeof err === 'string' ? err.trim() : '';
  if (!raw) return fallback;
  if (GENERIC_WALLET_SIGN_ERR_RE.test(raw)) {
    return network === 'mainnet'
      ? 'Wallet extension rejected or could not sign on NEAR Mainnet. Ensure your wallet is unlocked, switched to NEAR Mainnet (.near), and try again.'
      : 'Wallet extension rejected or could not sign on NEAR Testnet. Ensure your wallet is unlocked, switched to NEAR Testnet (.testnet), and try again.';
  }
  return raw;
}

export function extractPopupBlockedAccountId(err: unknown): string | null {
  if (err instanceof WalletPopupBlockedError && err.connectedAccountId) {
    return err.connectedAccountId;
  }
  if (err && typeof err === 'object') {
    const acct = (err as { connectedAccountId?: unknown }).connectedAccountId;
    if (typeof acct === 'string' && acct.trim().length > 0) return acct.trim();
  }
  return null;
}

export interface PrefetchedChallengeStore {
  warm(intent: 'signin' | 'signup', allowAutoRefresh?: boolean): Promise<NearAuthChallengeResponse | null>;
  takeReady(intent: 'signin' | 'signup'): NearAuthChallengeResponse | null;
  restoreUnused(intent: 'signin' | 'signup', challenge: NearAuthChallengeResponse): void;
  awaitOrFetch(walletId: string, intent: 'signin' | 'signup'): Promise<NearAuthChallengeResponse>;
  ensureFresh(intent: 'signin' | 'signup'): void;
  dispose(): void;
}

const MAX_AUTO_REFRESHES = 6;

function hasEnoughChallengeTtl(ch: NearAuthChallengeResponse): boolean {
  return ch.expiresAt - Date.now() > MIN_PREWARMED_CHALLENGE_TTL_MS;
}

interface ChallengeRefreshTimer {
  clear(): void;
  schedule(expiresAt: number, remaining: number, onExpire: (nextRemaining: number) => void): void;
}

function createChallengeRefreshTimer(isDisposed: () => boolean): ChallengeRefreshTimer {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return {
    clear,
    schedule(expiresAt, remaining, onExpire) {
      clear();
      if (isDisposed() || remaining <= 0) return;
      const refreshIn = expiresAt - Date.now() - MIN_PREWARMED_CHALLENGE_TTL_MS;
      if (refreshIn <= 0) {
        onExpire(remaining - 1);
        return;
      }
      if (refreshIn <= 10 * 60_000) {
        timer = setTimeout(() => {
          if (!isDisposed()) onExpire(remaining - 1);
        }, refreshIn);
      }
    },
  };
}

export function createPrefetchedChallengeStore(): PrefetchedChallengeStore {
  let disposed = false;
  let activeIntent: 'signin' | 'signup' = 'signin';
  let ready: { intent: 'signin' | 'signup'; challenge: NearAuthChallengeResponse } | null = null;
  let inFlight: { intent: 'signin' | 'signup'; promise: Promise<NearAuthChallengeResponse | null> } | null = null;
  const refreshTimer = createChallengeRefreshTimer(() => disposed);

  const scheduleFor = (intent: 'signin' | 'signup', ch: NearAuthChallengeResponse, remaining: number): void => {
    refreshTimer.schedule(ch.expiresAt, remaining, (nextRemaining) => {
      if (ready?.challenge.challengeId === ch.challengeId || !hasEnoughChallengeTtl(ch)) {
        void warmInternal(intent, nextRemaining);
      }
    });
  };

  const warmInternal = (
    intent: 'signin' | 'signup',
    remainingAutoRefreshes: number,
  ): Promise<NearAuthChallengeResponse | null> => {
    activeIntent = intent;
    refreshTimer.clear();
    if (ready && ready.intent !== intent) ready = null;
    if (inFlight && inFlight.intent === intent) return inFlight.promise;
    const promise = requestNearAuthChallenge({ intent })
      .then((ch) => {
        if (disposed || activeIntent !== intent) return ch;
        ready = { intent, challenge: ch };
        scheduleFor(intent, ch, remainingAutoRefreshes);
        return ch;
      })
      .catch(() => null)
      .finally(() => {
        if (inFlight?.promise === promise) inFlight = null;
      });
    inFlight = { intent, promise };
    return promise;
  };

  const warm = (
    intent: 'signin' | 'signup',
    allowAutoRefresh = true,
  ): Promise<NearAuthChallengeResponse | null> =>
    warmInternal(intent, allowAutoRefresh ? MAX_AUTO_REFRESHES : 0);

  const takeReady = (intent: 'signin' | 'signup'): NearAuthChallengeResponse | null => {
    if (!ready || ready.intent !== intent) return null;
    refreshTimer.clear();
    const ch = ready.challenge;
    ready = null;
    return hasEnoughChallengeTtl(ch) ? ch : null;
  };

  return {
    warm,
    takeReady,
    restoreUnused(intent, challenge) {
      if (disposed) return;
      if (!hasEnoughChallengeTtl(challenge)) {
        if (activeIntent === intent) void warm(intent);
        return;
      }
      if (!ready || ready.intent !== intent) {
        ready = { intent, challenge };
        scheduleFor(intent, challenge, MAX_AUTO_REFRESHES);
      }
    },
    async awaitOrFetch(walletId, intent) {
      const sync = takeReady(intent);
      if (sync) return sync;
      if (inFlight && inFlight.intent === intent) {
        const awaited = await inFlight.promise;
        if (awaited && hasEnoughChallengeTtl(awaited)) {
          if (ready?.challenge.challengeId === awaited.challengeId) {
            refreshTimer.clear();
            ready = null;
          }
          return awaited;
        }
      }
      return requestNearAuthChallenge({ walletId, intent });
    },
    ensureFresh(intent) {
      if (ready && ready.intent === intent && hasEnoughChallengeTtl(ready.challenge)) return;
      if (inFlight && inFlight.intent === intent) return;
      void warm(intent);
    },
    dispose() {
      disposed = true;
      refreshTimer.clear();
      ready = null;
      inFlight = null;
    },
  };
}

export function ensureModalCss(): void {
  if (typeof document === 'undefined' || document.getElementById('near-wallet-modal-css')) return;
  const style = document.createElement('style');
  style.id = 'near-wallet-modal-css';
  style.textContent = MODAL_CSS;
  document.head.appendChild(style);
}

export function readSavedNearWallet(): SavedNearWallet | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedNearWallet>;
    if (typeof parsed.accountId === 'string' && NEAR_ACCOUNT_RE.test(parsed.accountId)) {
      return {
        walletId: parsed.walletId ?? 'near-cli',
        walletName: parsed.walletName ?? 'NEAR Wallet',
        accountId: parsed.accountId,
        publicKey: typeof parsed.publicKey === 'string' ? parsed.publicKey : undefined,
        connectedAt: typeof parsed.connectedAt === 'number' ? parsed.connectedAt : Date.now(),
      };
    }
  } catch {
    /* ignore storage errors */
  }
  return null;
}

export function saveNearWallet(entry: SavedNearWallet): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
  } catch {
    /* ignore storage errors */
  }
}

export function renderStatusBox(
  panelHost: HTMLElement,
  opts: {
    readonly headline: string;
    readonly stepText?: string;
    readonly errorText?: string;
    readonly actionLink?: { readonly label: string; readonly href: string };
    readonly retryAction?: { readonly label: string; readonly onClick: () => void };
  },
): HTMLElement {
  panelHost.replaceChildren();
  const box = document.createElement('div');
  box.className = 'near-wallet-panel';
  box.dataset.testid = 'near-wallet-status-panel';

  const head = document.createElement('div');
  head.className = 'label';
  head.textContent = opts.headline;
  box.append(head);

  if (opts.stepText) {
    const p = document.createElement('p');
    p.className = 'near-wallet-step';
    p.dataset.testid = 'near-wallet-step';
    p.textContent = opts.stepText;
    box.append(p);
  }
  if (opts.errorText) {
    const err = document.createElement('p');
    err.className = 'near-wallet-err';
    err.dataset.testid = 'near-wallet-error';
    err.textContent = opts.errorText;
    box.append(err);
  }
  if (opts.actionLink || opts.retryAction) {
    const actions = document.createElement('div');
    actions.className = 'near-signup-links';
    if (opts.actionLink) {
      const a = document.createElement('a');
      a.className = 'btn btn-ghost btn-sm';
      a.href = opts.actionLink.href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.dataset.testid = 'near-wallet-external-link';
      a.textContent = opts.actionLink.label;
      actions.append(a);
    }
    if (opts.retryAction) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'btn btn-primary btn-sm';
      retry.dataset.testid = 'near-wallet-pair-btn';
      retry.textContent = opts.retryAction.label;
      retry.onclick = opts.retryAction.onClick;
      actions.append(retry);
    }
    box.append(actions);
  }
  panelHost.append(box);
  return box;
}
