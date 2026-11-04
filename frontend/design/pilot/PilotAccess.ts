import { SocialAuthResponseSchema } from '@terra/contracts';
import { readMockToken } from './mockToken';

/** Shared landing/orbit sign-in. Refresh verifies the session before exposing the profile. */
export class PilotAccess {
  readonly el = document.createElement('div');
  private popup: Window | null = null;
  private disposed = false;
  private busy = false;
  private bearer = '';
  private loginEpoch = 0;

  constructor(parent: HTMLElement) {
    this.el.className = 'plate-sm';
    this.el.dataset.testid = 'pilot-access';
    parent.append(this.el);
    this.guest();
    window.addEventListener('message', this.onMessage);
    void this.restore();
  }

  private guest(message = 'Guest pilot'): void {
    const label = document.createElement('span');
    label.textContent = message;
    this.el.replaceChildren(label);
    for (const provider of ['google', 'x'] as const) {
      const button = document.createElement('button');
      button.className = 'btn btn-ghost btn-sm';
      button.textContent = `Continue with ${provider === 'google' ? 'Google' : 'X'} (mock)`;
      button.onclick = () => {
        if (this.busy) return;
        this.popup = window.open(
          `/dev/mock-oauth?provider=${provider}&return=${encodeURIComponent(location.pathname + location.search)}`,
          'terra-mock-oauth',
          'popup,width=480,height=640',
        );
      };
      this.el.append(button);
    }
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
