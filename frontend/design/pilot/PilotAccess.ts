import { SocialAuthResponseSchema } from '@terra/contracts';
import { authenticateFastAuthEmailPopup, isFastAuthPopupCancelled } from './fastAuthSpa';
import {
  buildFastAuthLoginUrl,
  consumeNearWalletCallback,
  consumePendingOAuthError,
  OAUTH_CALLBACK_STORAGE_KEY,
  OAUTH_ERROR_STORAGE_KEY,
  PKCE_STATE_STORAGE_KEY,
  readMockToken,
  readOAuthError,
  readOAuthErrorStorageEvent,
  readOAuthStorageEvent,
} from './mockToken';
import {
  decodeNep413SocialToken,
  extractAuthApiErrorMessage,
  jwtStillValid,
  PENDING_NEP413_STORAGE_KEY,
  readStoredGuestUpgradeBearer,
  RECENT_NEP413_POPUP_KEY,
} from './nearAuthApi';
import { openNearWalletSelectorModal } from './nearWalletModal';
import { signOutNearWalletSelector } from './walletSelectorRuntime';

export { jwtStillValid };

const PILOT_DIALOG_CSS = `
.pilot-access-bar{display:inline-flex;align-items:center;gap:var(--ta-s2);flex-wrap:wrap}
.pilot-dialog{margin:auto;padding:var(--ta-s5);min-width:320px;max-width:390px;background:var(--ta-plate);color:var(--ta-text);border:1px solid var(--ta-seam-2);overscroll-behavior:contain}
.pilot-dialog::backdrop{background:color-mix(in srgb,var(--ta-black-hole) 74%,transparent);backdrop-filter:blur(4px)}
.pilot-dialog-head{display:flex;align-items:center;justify-content:space-between;gap:var(--ta-s3);margin-bottom:var(--ta-s3)}
.pilot-dialog-tabs{display:grid;grid-template-columns:1fr 1fr;gap:var(--ta-s2);margin-bottom:var(--ta-s3)}
.pilot-dialog-sub{font-size:var(--ta-fs-eyebrow);color:var(--ta-text-3);margin:0 0 var(--ta-s3);line-height:1.4}
.pilot-dialog-list{display:flex;flex-direction:column;gap:var(--ta-s2)}
.pilot-dialog-list .btn{width:100%;justify-content:center}
.pilot-email-box{display:flex;flex-direction:column;gap:var(--ta-s2);padding:var(--ta-s2);background:var(--ta-plate-2);border:1px solid var(--ta-seam)}
.pilot-email-box input{width:100%;box-sizing:border-box}
.pilot-status{font-family:var(--ta-font-mono);font-size:var(--ta-fs-label);color:var(--ta-fault-text)}
`;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PROVIDERS = [
  { id: 'google', label: 'Google', testId: 'continue-google' },
  { id: 'x', label: 'X', testId: 'continue-x' },
  { id: 'fastauth', label: 'NEAR', testId: 'continue-near' },
] as const;

export interface PilotAccessSession {
  readonly accessToken: string;
  readonly accountId?: string;
  readonly player: { readonly id: string; readonly isGuest?: boolean; readonly handle: string };
}

export interface PilotAccessOptions {
  readonly onAuthChange?: (session: PilotAccessSession | null) => void;
  readonly triggerLabel?: string;
  readonly initialSession?: PilotAccessSession | null;
  readonly skipRestore?: boolean;
}

let inFlightRefresh: Promise<PilotAccessSession | null> | null = null;

/** Single-flight `/v1/auth/refresh` helper so concurrent callers in the same tab never race token rotation (`BE-04`). */
export function refreshPilotSession(
  doFetch: (input: string, init?: RequestInit) => Promise<{
    readonly ok: boolean;
    readonly status: number;
    json(): Promise<unknown>;
  }> = (input, init) => fetch(input, init),
  useSharedFlight = true,
): Promise<PilotAccessSession | null> {
  if (useSharedFlight && inFlightRefresh) return inFlightRefresh;
  const run = (async (): Promise<PilotAccessSession | null> => {
    try {
      const response = await doFetch('/v1/auth/refresh', { method: 'POST', credentials: 'include' });
      if (!response.ok) return null;
      return (await response.json()) as PilotAccessSession;
    } catch {
      return null;
    }
  })();
  if (!useSharedFlight) return run;
  const p = run.finally(() => {
    if (inFlightRefresh === p) inFlightRefresh = null;
  });
  inFlightRefresh = p;
  return p;
}

function ensureDialogStyles(): void {
  if (typeof document === 'undefined' || document.getElementById('pilot-dialog-css')) return;
  const style = document.createElement('style');
  style.id = 'pilot-dialog-css';
  style.textContent = PILOT_DIALOG_CSS;
  document.head.appendChild(style);
}

/** Shared landing/orbit/profile/trade sign-in, sign-up & sign-out control (NEAR Testnet). */
export class PilotAccess {
  readonly el = document.createElement('div');
  private popup: Window | null = null;
  private disposed = false;
  private busy = false;
  private bearer = '';
  private session: PilotAccessSession | null = null;
  private loginEpoch = 0;

  constructor(
    parent: HTMLElement,
    private readonly opts: PilotAccessOptions = {},
  ) {
    ensureDialogStyles();
    this.el.className = 'plate-sm pilot-access-bar';
    this.el.dataset.testid = 'pilot-access';
    parent.append(this.el);
    this.guest();
    window.addEventListener('message', this.onMessage);
    window.addEventListener('storage', this.onStorage);
    const walletHit = consumeNearWalletCallback();
    const redirectErr = consumePendingOAuthError();
    if (walletHit) {
      this.triggerLogin(walletHit);
    } else if (redirectErr) {
      this.guest(redirectErr.message);
    } else if (opts.initialSession && opts.initialSession.player.isGuest === false) {
      this.linked(opts.initialSession, false);
    } else if (!opts.skipRestore) {
      void this.restore();
    }
  }

  hasLinkedPilot(): boolean {
    return Boolean(this.session && this.session.player.isGuest === false);
  }

  getSession(): PilotAccessSession | null {
    return this.session;
  }

  resolveUpgradeBearer(nowMs = Date.now()): string {
    if (this.bearer && !jwtStillValid(this.bearer, nowMs)) this.bearer = '';
    if (this.hasLinkedPilot()) return '';
    return this.bearer || readStoredGuestUpgradeBearer(nowMs);
  }

  openSignInDialog(): void {
    const dialog = this.el.querySelector<HTMLDialogElement>('[data-testid="pilot-provider-dialog"]');
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  private guest(errorMessage = ''): void {
    this.el.replaceChildren();
    if (errorMessage) {
      const status = document.createElement('span');
      status.className = 'pilot-status';
      status.setAttribute('role', 'status');
      status.textContent = errorMessage;
      this.el.append(status);
    }

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'btn btn-ghost btn-sm';
    trigger.dataset.testid = 'pilot-sign-in';
    trigger.textContent = this.opts.triggerLabel ?? 'Sign in';

    const dialog = this.buildDialog();
    trigger.onclick = () => {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    };

    this.el.append(trigger, dialog);
  }

  private buildDialog(): HTMLDialogElement {
    let mode: 'signin' | 'signup' = 'signin';
    const dialog = document.createElement('dialog');
    dialog.className = 'plate pilot-dialog';
    dialog.setAttribute('closedby', 'any');
    dialog.setAttribute('aria-labelledby', 'pilot-dialog-title');
    dialog.dataset.testid = 'pilot-provider-dialog';

    const head = document.createElement('div');
    head.className = 'pilot-dialog-head';
    const title = document.createElement('span');
    title.id = 'pilot-dialog-title';
    title.className = 'label';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn btn-ghost btn-sm';
    closeBtn.dataset.testid = 'pilot-dialog-close';
    closeBtn.textContent = '✕';
    closeBtn.onclick = () => this.closeDialog(dialog);
    head.append(title, closeBtn);

    const tabs = document.createElement('div');
    tabs.className = 'pilot-dialog-tabs';
    const signInTab = document.createElement('button');
    signInTab.type = 'button';
    signInTab.dataset.testid = 'pilot-mode-signin';
    signInTab.textContent = 'Sign In';
    const signUpTab = document.createElement('button');
    signUpTab.type = 'button';
    signUpTab.dataset.testid = 'pilot-mode-signup';
    signUpTab.textContent = 'Sign Up · Testnet';
    tabs.append(signInTab, signUpTab);

    const sub = document.createElement('p');
    sub.className = 'pilot-dialog-sub';
    const list = this.buildProviderButtons(dialog, () => mode);

    const syncMode = (): void => {
      title.textContent = mode === 'signup' ? 'CREATE PILOT · NEAR TESTNET' : 'SIGN IN · NEAR TESTNET';
      signInTab.className = mode === 'signin' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm';
      signUpTab.className = mode === 'signup' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm';
      sub.textContent =
        mode === 'signup'
          ? 'Mint a gasless *.terraagent.testnet Pilot with Google, X, or Email/Passkey, or create & link a NEAR Testnet wallet.'
          : 'Sign in with NEAR FastAuth (Google, X, Email/Passkey) or verify your NEAR Testnet wallet via NEP-413.';
    };
    signInTab.onclick = () => {
      mode = 'signin';
      syncMode();
    };
    signUpTab.onclick = () => {
      mode = 'signup';
      syncMode();
    };
    syncMode();

    dialog.onclick = (e) => {
      if (e.target === dialog) this.closeDialog(dialog);
    };
    dialog.append(head, tabs, sub, list);
    return dialog;
  }

  private buildProviderButtons(dialog: HTMLDialogElement, getMode: () => 'signin' | 'signup'): HTMLElement {
    const list = document.createElement('div');
    list.className = 'pilot-dialog-list';

    for (const p of PROVIDERS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = p.id === 'fastauth' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm';
      btn.dataset.testid = p.testId;
      btn.textContent = p.label;
      btn.onclick = () => {
        if (this.busy) return;
        const mode = getMode();
        this.closeDialog(dialog);
        const returnPath = location.pathname + location.search;
        if (p.id === 'fastauth') {
          openNearWalletSelectorModal({
            initialMode: mode,
            onPopupOpened: (pop) => {
              this.popup = pop;
            },
            onDirectToken: (hit) => {
              this.triggerLogin(hit);
            },
          });
          return;
        }
        this.popup = window.open(
          buildFastAuthLoginUrl(location.origin, returnPath, p.id, { mode }),
          'terra-fastauth-oauth',
          'popup,width=500,height=680',
        );
      };
      list.append(btn);
    }

    list.append(this.buildEmailFastAuthBox(dialog, getMode));
    return list;
  }

  private buildEmailFastAuthBox(dialog: HTMLDialogElement, getMode: () => 'signin' | 'signup'): HTMLElement {
    const box = document.createElement('div');
    box.className = 'pilot-email-box';
    const emailInput = document.createElement('input');
    emailInput.type = 'email';
    emailInput.className = 'input';
    emailInput.placeholder = 'pilot@terraagent.fun';
    emailInput.dataset.testid = 'pilot-email-input';
    const inlineErr = document.createElement('span');
    inlineErr.className = 'pilot-status';
    inlineErr.style.display = 'none';

    const emailBtn = document.createElement('button');
    emailBtn.type = 'button';
    emailBtn.className = 'btn btn-ghost btn-sm';
    emailBtn.dataset.testid = 'continue-email';
    emailBtn.textContent = 'Email / Passkey (FastAuth)';

    const startEmailAuth = (): void => {
      if (this.busy) return;
      const clean = emailInput.value.trim().toLowerCase();
      if (!EMAIL_RE.test(clean)) {
        inlineErr.textContent = 'Enter a valid email address.';
        inlineErr.style.display = 'block';
        return;
      }
      inlineErr.style.display = 'none';
      const mode = getMode();
      this.closeDialog(dialog);
      void authenticateFastAuthEmailPopup({ email: clean, mode })
        .then((res) => {
          this.triggerLogin({ provider: 'email', token: res.idToken });
        })
        .catch((err: unknown) => {
          if (this.disposed) return;
          if (isFastAuthPopupCancelled(err)) {
            this.guest('Sign-in was cancelled.');
            return;
          }
          this.guest(err instanceof Error && err.message ? err.message : 'FastAuth Email sign-in could not be completed.');
        });
    };

    emailInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') startEmailAuth();
    });
    emailBtn.onclick = startEmailAuth;
    box.append(emailInput, inlineErr, emailBtn);
    return box;
  }

  private closeDialog(dialog: HTMLDialogElement): void {
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
  }

  private linked(body: PilotAccessSession, notify = false): void {
    if (this.disposed) return;
    this.bearer = body.accessToken;
    const isGuest = body.player.isGuest !== false;
    this.session = isGuest ? null : body;
    if (body.accessToken && !body.accessToken.startsWith('dev:') && !body.accessToken.startsWith('player:')) {
      try {
        localStorage.setItem(
          'ta_active_pilot',
          JSON.stringify({
            playerId: body.player.id,
            accessToken: body.accessToken,
            updatedAt: Date.now(),
            isGuest,
            handle: body.player.handle,
            ...(body.accountId ? { accountId: body.accountId } : {}),
          }),
        );
        if (!isGuest) {
          localStorage.setItem('ta_trade_token', body.accessToken);
        } else {
          localStorage.removeItem('ta_trade_token');
        }
      } catch {
        /* Refresh cookie remains usable when storage is unavailable. */
      }
    }
    if (isGuest) return;
    const link = document.createElement('a');
    link.className = 'btn btn-primary btn-sm';
    link.textContent = `${body.player.handle} · PILOT / ME ↗`;
    link.href = '/me.html';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';

    const signOutBtn = document.createElement('button');
    signOutBtn.type = 'button';
    signOutBtn.className = 'btn btn-ghost btn-sm';
    signOutBtn.dataset.testid = 'pilot-sign-out';
    signOutBtn.textContent = 'Sign out';
    signOutBtn.onclick = () => {
      void this.signOut();
    };

    this.el.replaceChildren(link, signOutBtn);
    if (notify) this.opts.onAuthChange?.(body);
  }

  async signOut(): Promise<void> {
    this.loginEpoch += 1;
    this.bearer = '';
    this.session = null;
    try {
      localStorage.removeItem('ta_active_pilot');
      localStorage.removeItem('ta_trade_token');
      localStorage.removeItem(OAUTH_CALLBACK_STORAGE_KEY);
      localStorage.removeItem(OAUTH_ERROR_STORAGE_KEY);
      localStorage.removeItem(PKCE_STATE_STORAGE_KEY);
      localStorage.removeItem(PENDING_NEP413_STORAGE_KEY);
      localStorage.removeItem(RECENT_NEP413_POPUP_KEY);
    } catch { /* ignore */ }
    try {
      sessionStorage.removeItem(PENDING_NEP413_STORAGE_KEY);
      sessionStorage.removeItem(RECENT_NEP413_POPUP_KEY);
    } catch { /* ignore */ }
    await signOutNearWalletSelector();
    try {
      await fetch('/v1/auth/logout', { method: 'POST', credentials: 'include' });
    } catch { /* ignore network errors on logout */ }
    if (!this.disposed) {
      this.guest();
      this.opts.onAuthChange?.(null);
    }
  }

  private async restore(): Promise<void> {
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('host') === 'local') {
      return;
    }
    const epoch = this.loginEpoch;
    const body = await refreshPilotSession();
    if (body && epoch === this.loginEpoch) {
      this.linked(body);
    }
  }

  private triggerLogin(hit: { provider: string; token: string }): void {
    if (this.busy) return;
    this.busy = true;
    this.loginEpoch += 1;
    void this.login(hit).finally(() => {
      this.busy = false;
    });
  }

  private onMessage = (event: MessageEvent): void => {
    const hit = readMockToken(event, this.popup, location.origin);
    if (hit) {
      this.triggerLogin(hit);
      return;
    }
    const err = readOAuthError(event, this.popup, location.origin);
    if (err && !this.disposed) {
      this.popup = null;
      this.guest(err.message);
    }
  };

  private onStorage = (event: StorageEvent): void => {
    const hit = readOAuthStorageEvent(event, Boolean(this.popup));
    if (hit) {
      this.popup = null;
      this.triggerLogin(hit);
      return;
    }
    const err = readOAuthErrorStorageEvent(event, Boolean(this.popup));
    if (err && !this.disposed) {
      this.popup = null;
      this.guest(err.message);
    }
  };

  private async login(hit: { provider: string; token: string }): Promise<void> {
    try {
      const nep413Payload = decodeNep413SocialToken(hit.token);
      const endpoint = nep413Payload ? '/v1/auth/near/verify' : '/v1/auth/social';
      const reqBody = nep413Payload ?? hit;
      const upgradeBearer = this.resolveUpgradeBearer();
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(upgradeBearer ? { Authorization: `Bearer ${upgradeBearer}` } : {}),
        },
        body: JSON.stringify(reqBody),
      });
      if (!response.ok) {
        const errBody = await response.json().catch(() => null);
        throw new Error(extractAuthApiErrorMessage(errBody, 'Sign-in failed. Please try again.'));
      }
      this.linked(SocialAuthResponseSchema.parse(await response.json()), true);
    } catch (err) {
      if (!this.disposed) {
        this.guest(err instanceof Error && err.message ? err.message : 'Sign-in failed. Please try again.');
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('message', this.onMessage);
    window.removeEventListener('storage', this.onStorage);
    this.el.remove();
  }
}
