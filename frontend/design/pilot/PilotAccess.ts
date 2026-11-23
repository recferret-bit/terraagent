import { SocialAuthResponseSchema } from '@terra/contracts';
import {
  consentedAuthHeaders, failAuthHttp, failAuthThrown, failOAuthMessage, rememberAuthProvider, stopProviderWatch, succeedAuth, trackProviderPopup,
} from '../analytics/auth';
import { buildLocalMockPilotBox, isLocalMockAuthEnabled, type LocalMockFetchFn } from './localMockPilot';
import { ensurePilotDialogStyles } from './pilotDialogCss';
import { buildPilotEmailFastAuthBox } from './pilotEmailBox';
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
  persistActivePilotSession,
  readStoredGuestUpgradeBearer,
  RECENT_NEP413_POPUP_KEY,
} from './nearAuthApi';
import { openNearWalletSelectorModal } from './nearWalletModal';
import { signOutNearWalletSelector } from './walletSelectorRuntime';

export { jwtStillValid };

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
  readonly fetch?: LocalMockFetchFn;
  readonly profileHref?: string;
  readonly allowOfflineLocalAuth?: boolean;
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
    ensurePilotDialogStyles();
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

  setHandle(nextHandle: string): void {
    const clean = nextHandle.trim();
    if (!clean || !this.session) return;
    this.session = { ...this.session, player: { ...this.session.player, handle: clean } };
    const link = this.el.querySelector<HTMLAnchorElement>('a');
    if (link) link.textContent = `${clean} · PILOT / ME ↗`;
  }

  private doFetch(input: string, init?: RequestInit) {
    return this.opts.fetch ? this.opts.fetch(input, init) : fetch(input, init);
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
    const showLocalMock = isLocalMockAuthEnabled() || Boolean(this.opts.allowOfflineLocalAuth && this.opts.fetch);
    const localMock = showLocalMock
      ? buildLocalMockPilotBox({
          initialMode: mode,
          getMode: () => mode,
          getUpgradeBearer: () => this.resolveUpgradeBearer(),
          isBusy: () => this.busy,
          fetchImpl: this.opts.fetch,
          allowOfflineLocalAuth: this.opts.allowOfflineLocalAuth,
          onAuthenticated: (session) => {
            this.closeDialog(dialog);
            this.loginEpoch += 1;
            this.linked(session, true);
          },
        })
      : null;

    const syncMode = (): void => {
      title.textContent = mode === 'signup' ? 'CREATE PILOT · NEAR TESTNET' : 'SIGN IN · NEAR TESTNET';
      signInTab.className = mode === 'signin' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm';
      signUpTab.className = mode === 'signup' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm';
      sub.textContent =
        mode === 'signup'
          ? 'Mint a gasless *.terraagent.testnet Pilot with Google, X, or Email/Passkey, or create & link a NEAR Testnet wallet.'
          : 'Sign in with NEAR FastAuth (Google, X, Email/Passkey) or verify your NEAR Testnet wallet via NEP-413.';
      localMock?.syncMode(mode);
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
    dialog.append(head, tabs, sub, list, ...(localMock ? [localMock.el] : []));
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
            allowOfflineLocalAuth: this.opts.allowOfflineLocalAuth,
            localAuthFetch: this.opts.fetch,
            getUpgradeBearer: () => this.resolveUpgradeBearer(),
            onPopupOpened: (pop) => {
              this.popup = pop;
            },
            onDirectToken: (hit) => {
              this.triggerLogin(hit);
            },
            onLocalMockSession: (session) => {
              this.loginEpoch += 1;
              this.linked(session, true);
            },
          });
          return;
        }
        if (this.opts.allowOfflineLocalAuth) {
          this.triggerLogin({ provider: p.id, token: `local-${p.id}` });
          return;
        }
        this.popup = trackProviderPopup(p.id, window.open(
          buildFastAuthLoginUrl(location.origin, returnPath, p.id, { mode }),
          'terra-fastauth-oauth',
          'popup,width=500,height=680',
        ));
      };
      list.append(btn);
    }

    list.append(
      buildPilotEmailFastAuthBox({
        isBusy: () => this.busy,
        isDisposed: () => this.disposed,
        getMode,
        allowOfflineLocalAuth: this.opts.allowOfflineLocalAuth,
        onCloseDialog: () => this.closeDialog(dialog),
        onToken: (hit) => this.triggerLogin(hit),
        onGuestError: (msg) => this.guest(msg),
      }),
    );
    return list;
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
    persistActivePilotSession(body, this.opts.allowOfflineLocalAuth);
    if (isGuest) return;
    const link = document.createElement('a');
    link.className = 'btn btn-primary btn-sm';
    link.textContent = `${body.player.handle} · PILOT / ME ↗`;
    link.href = this.opts.profileHref ?? '/me.html';
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
      const keepServerPilot =
        this.opts.allowOfflineLocalAuth &&
        (() => {
          const raw = localStorage.getItem('ta_active_pilot');
          return Boolean(raw && (JSON.parse(raw) as { accessToken?: unknown }).accessToken !== 'local-mode-token');
        })();
      if (!keepServerPilot) {
        localStorage.removeItem('ta_active_pilot');
        localStorage.removeItem('ta_trade_token');
      }
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
    if (!this.opts.allowOfflineLocalAuth) {
      await signOutNearWalletSelector();
    }
    try {
      await this.doFetch('/v1/auth/logout', { method: 'POST', credentials: 'include' });
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
    stopProviderWatch();
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
      failOAuthMessage();
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
      failOAuthMessage();
      this.guest(err.message);
    }
  };

  private async login(hit: { provider: string; token: string }): Promise<void> {
    const nep413Payload = decodeNep413SocialToken(hit.token);
    rememberAuthProvider(hit.provider, nep413Payload?.walletId);
    try {
      const endpoint = nep413Payload ? '/v1/auth/near/verify' : '/v1/auth/social';
      const reqBody = nep413Payload ?? hit;
      const upgradeBearer = this.resolveUpgradeBearer();
      const response = await this.doFetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...consentedAuthHeaders(),
          ...(upgradeBearer ? { Authorization: `Bearer ${upgradeBearer}` } : {}),
        },
        body: JSON.stringify(reqBody),
      });
      if (!response.ok) {
        failAuthHttp(response.status);
        const errBody = await response.json().catch(() => null);
        throw new Error(extractAuthApiErrorMessage(errBody, 'Sign-in failed. Please try again.'));
      }
      const body = SocialAuthResponseSchema.parse(await response.json());
      succeedAuth();
      this.linked(body, true);
    } catch (err) {
      failAuthThrown(err);
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
