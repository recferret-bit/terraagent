import { nearPlayerText } from './copy';

/** One player-facing NEAR plate. The next code replaces it; a click dismisses it. */
export class NearErrorToasts {
  private current: HTMLButtonElement | null = null;

  constructor(private readonly host: HTMLElement) {
    this.host.hidden = true;
    this.host.setAttribute('role', 'status');
    this.host.setAttribute('aria-live', 'polite');
  }

  /** Shows the sentence for a known code. Unknown codes are ignored. Returns whether a plate is up. */
  show(code: string): boolean {
    const text = nearPlayerText(code);
    if (!text) return false;
    this.dismiss();
    const toast = document.createElement('button');
    toast.type = 'button';
    toast.className = 'plate-sm ta-near-toast';
    toast.dataset.testid = 'near-toast';
    toast.dataset.code = code;
    toast.textContent = text;
    toast.onclick = () => this.dismiss();
    this.host.appendChild(toast);
    this.host.hidden = false;
    this.current = toast;
    return true;
  }

  dismiss(): void {
    this.current?.remove();
    this.current = null;
    this.host.hidden = true;
  }

  dispose(): void {
    this.dismiss();
  }
}
