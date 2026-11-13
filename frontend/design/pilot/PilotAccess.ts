import { SocialAuthResponseSchema } from '@terra/contracts';
import {
  buildFastAuthLoginUrl,
  consumeNearWalletCallback,
  OAUTH_CALLBACK_STORAGE_KEY,
  readMockToken,
  readOAuthStorageEvent,
} from './mockToken';
import { openNearWalletSelectorModal } from './nearWalletModal';

const PILOT_DIALOG_CSS = `
.pilot-access-bar{display:inline-flex;align-items:center;gap:var(--ta-s2);flex-wrap:wrap}
.pilot-dialog{margin:auto;padding:var(--ta-s5);min-width:300px;max-width:360px;background:var(--ta-plate);color:var(--ta-text);border:1px solid var(--ta-seam-2);overscroll-behavior:contain}
.pilot-dialog::backdrop{background:rgba(5,6,8,.74);backdrop-filter:blur(4px)}
.pilot-dialog-head{display:flex;align-items:center;justify-content:space-between;gap:var(--ta-s3);margin-bottom:var(--ta-s4)}
.pilot-dialog-list{display:flex;flex-direction:column;gap:var(--ta-s2)}
.pilot-dialog-list .btn{width:100%;justify-content:center}
.pilot-status{font-family:var(--ta-font-mono);font-size:var(--ta-fs-label);color:var(--ta-fault-text)}
`;

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

/** Shared landing/orbit/profile/trade sign-in & sign-out control. */
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
    if (walletHit) {
      this.triggerLogin(walletHit);
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
    title.textContent = 'SELECT PROVIDER';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn btn-ghost btn-sm';
    closeBtn.dataset.testid = 'pilot-dialog-close';
    closeBtn.textContent = '✕';
    closeBtn.onclick = () => this.closeDialog(dialog);
    head.append(title, closeBtn);

    const list = document.createElement('div');
    list.className = 'pilot-dialog-list';
    for (const p of PROVIDERS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-ghost btn-sm';
      btn.dataset.testid = p.testId;
      btn.textContent = p.label;
      btn.onclick = () => {
        if (this.busy) return;
        this.closeDialog(dialog);
        const returnPath = location.pathname + location.search;
        if (p.id === 'fastauth') {
          openNearWalletSelectorModal({
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
          buildFastAuthLoginUrl(location.origin, returnPath, p.id),
          'terra-fastauth-oauth',
          'popup,width=500,height=680',
        );
      };
      list.append(btn);
    }

    dialog.onclick = (e) => {
      if (e.target === dialog) this.closeDialog(dialog);
    };
    dialog.append(head, list);
    return dialog;
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
    } catch {
      /* ignore */
    }
    try {
      await fetch('/v1/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {
      /* ignore network errors on logout */
    }
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
    if (!hit) return;
    this.triggerLogin(hit);
  };

  private onStorage = (event: StorageEvent): void => {
    const hit = readOAuthStorageEvent(event, Boolean(this.popup));
    if (!hit) return;
    this.popup = null;
    this.triggerLogin(hit);
  };

  private async login(hit: { provider: string; token: string }): Promise<void> {
    try {
      const response = await fetch('/v1/auth/social', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(this.bearer ? { Authorization: `Bearer ${this.bearer}` } : {}),
        },
        body: JSON.stringify(hit),
      });
      if (!response.ok) throw new Error('Sign-in failed. Please try again.');
      this.linked(SocialAuthResponseSchema.parse(await response.json()), true);
    } catch {
      if (!this.disposed) this.guest('Sign-in failed. Please try again.');
    }
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('message', this.onMessage);
    window.removeEventListener('storage', this.onStorage);
    this.el.remove();
  }
}
