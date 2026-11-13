import { pushNotification } from '../notifications/notificationStore';
import { nearPlayerText } from './copy';

export const DEFAULT_NEAR_TOAST_DURATION_MS = 6000;

/** One player-facing NEAR plate. The next code replaces it; a click or timeout dismisses it. */
export class NearErrorToasts {
  private current: HTMLElement | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly durationMs = DEFAULT_NEAR_TOAST_DURATION_MS,
  ) {
    this.host.hidden = true;
    this.host.setAttribute('role', 'status');
    this.host.setAttribute('aria-live', 'polite');
  }

  /** Shows the sentence for a known code. Unknown codes are ignored. Returns whether a plate is up. */
  show(code: string): boolean {
    const text = nearPlayerText(code);
    if (!text) return false;
    this.dismiss();
    const row = document.createElement('div');
    row.className = 'plate-sm ta-near-toast-row';
    const toast = document.createElement('button');
    toast.type = 'button';
    toast.className = 'ta-near-toast';
    toast.dataset.testid = 'near-toast';
    toast.dataset.code = code;
    toast.textContent = text;
    toast.onclick = () => this.dismiss();
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'ta-near-toast__close';
    closeBtn.dataset.testid = 'near-toast-close';
    closeBtn.setAttribute('aria-label', 'Dismiss NEAR notification');
    closeBtn.textContent = '×';
    closeBtn.onclick = () => this.dismiss();
    row.append(toast, closeBtn);
    this.host.appendChild(row);
    this.host.hidden = false;
    this.current = row;
    if (this.durationMs > 0) {
      this.timer = setTimeout(() => this.dismiss(), this.durationMs);
    }
    pushNotification({
      category: 'system',
      title: 'NEAR Status',
      message: text,
    });
    return true;
  }

  dismiss(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.current?.remove();
    this.current = null;
    this.host.hidden = true;
  }

  dispose(): void {
    this.dismiss();
  }
}
