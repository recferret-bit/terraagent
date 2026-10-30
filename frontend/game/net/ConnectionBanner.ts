import { STILL_TRYING_AFTER_MS } from './backoff';
import { TERMINAL_TEXT } from './closeCodes';
import type { ConnectionState, Transport } from './types';
import './banner.css';

/** Banner text for a connection state, or null when nothing should show (CLIENT §6). */
export function bannerText(s: ConnectionState, nowMs: number): string | null {
  if (s.phase === 'terminal') return TERMINAL_TEXT[s.code ?? 0] ?? 'Disconnected';
  if (s.downSinceMs === null) return s.phase === 'connecting' || s.phase === 'resolving' ? 'Connecting…' : null;
  if (s.phase === 'welcomed' || s.phase === 'streaming') return null;
  return nowMs - s.downSinceMs >= STILL_TRYING_AFTER_MS ? 'Reconnecting… still trying' : 'Reconnecting…';
}

/** Top-centre plate that shows "Connecting…", "Reconnecting…", "still trying" or a terminal message. */
export class ConnectionBanner {
  readonly el = document.createElement('div');
  private readonly off: () => void;
  private readonly tick = window.setInterval(() => this.render(), 1000);

  constructor(parent: HTMLElement, private readonly transport: Transport, private readonly onRetry?: () => void) {
    this.el.className = 'ta-net-banner plate';
    this.el.setAttribute('role', 'status');
    this.el.dataset.testid = 'net-banner';
    parent.appendChild(this.el);
    this.off = transport.onState(() => this.render());
    this.render();
  }

  private render(): void {
    const s = this.transport.state;
    const text = bannerText(s, Date.now());
    this.el.hidden = text === null;
    this.el.dataset.phase = s.phase;
    this.el.replaceChildren(document.createTextNode(text ?? ''));
    if (s.phase === 'terminal' && this.onRetry) {
      const b = document.createElement('button');
      b.className = 'btn btn-sm';
      b.textContent = 'Retry';
      b.onclick = () => this.onRetry?.();
      this.el.append(' ', b);
    }
  }

  dispose(): void {
    this.off();
    window.clearInterval(this.tick);
    this.el.remove();
  }
}
