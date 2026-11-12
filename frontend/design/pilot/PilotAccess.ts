import { SocialAuthResponseSchema } from '@terra/contracts';
import { buildNearWalletLoginUrl, consumeNearWalletCallback, readMockToken } from './mockToken';

const PILOT_DIALOG_CSS = `
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

function ensureDialogStyles(): void {
  if (typeof document === 'undefined' || document.getElementById('pilot-dialog-css')) return;
  const style = document.createElement('style');
  style.id = 'pilot-dialog-css';
  style.textContent = PILOT_DIALOG_CSS;
  document.head.appendChild(style);
}

/** Shared landing/orbit sign-in. Refresh verifies the session before exposing the profile. */
export class PilotAccess {
  readonly el = document.createElement('div');
  private popup: Window | null = null;
  private disposed = false;
  private busy = false;
  private bearer = '';
  private loginEpoch = 0;

  constructor(parent: HTMLElement) {
    ensureDialogStyles();
    this.el.className = 'plate-sm';
    this.el.dataset.testid = 'pilot-access';
    parent.append(this.el);
    this.guest();
    window.addEventListener('message', this.onMessage);
    const walletHit = consumeNearWalletCallback();
    if (walletHit) {
      this.busy = true;
      this.loginEpoch += 1;
      void this.login(walletHit).finally(() => {
        this.busy = false;
      });
    } else {
      void this.restore();
    }
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
    trigger.textContent = 'Sign in';

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
          this.popup = window.open(
            buildNearWalletLoginUrl(location.origin, returnPath),
            'terra-near-wallet',
            'popup,width=500,height=680',
          );
          return;
        }
        this.popup = window.open(
          `/dev/mock-oauth?provider=${p.id}&return=${encodeURIComponent(returnPath)}`,
          'terra-mock-oauth',
          'popup,width=480,height=640',
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

  private linked(body: { accessToken: string; player: { id: string; isGuest?: boolean; handle: string } }): void {
    if (this.disposed) return;
    this.bearer = body.accessToken;
    try {
      localStorage.setItem(
        'ta_active_pilot',
        JSON.stringify({ playerId: body.player.id, accessToken: body.accessToken, updatedAt: Date.now() }),
      );
    } catch {
      /* Refresh cookie remains usable when storage is unavailable. */
    }
    if (body.player.isGuest !== false) return;
    const link = document.createElement('a');
    link.className = 'btn btn-primary btn-sm';
    link.textContent = `${body.player.handle} · PILOT / ME ↗`;
    link.href = '/me.html';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    this.el.replaceChildren(link);
  }

  private async restore(): Promise<void> {
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('host') === 'local') {
      return;
    }
    const epoch = this.loginEpoch;
    try {
      const response = await fetch('/v1/auth/refresh', { method: 'POST', credentials: 'include' });
      if (response.ok) {
        const body = await response.json();
        if (epoch === this.loginEpoch) this.linked(body);
      }
    } catch {
      /* Guest controls remain available. */
    }
  }

  private onMessage = (event: MessageEvent): void => {
    const hit = readMockToken(event, this.popup, location.origin);
    if (!hit || this.busy) return;
    this.busy = true;
    this.loginEpoch += 1;
    void this.login(hit).finally(() => {
      this.busy = false;
    });
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
      this.linked(SocialAuthResponseSchema.parse(await response.json()));
    } catch {
      if (!this.disposed) this.guest('Sign-in failed. Please try again.');
    }
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('message', this.onMessage);
    this.el.remove();
  }
}
