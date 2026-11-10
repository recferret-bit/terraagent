import type { AwayDigestV1 } from '@terra/contracts';
import { digestFromWelcome } from '../../store/awayWelcome';
import { awayIdentity } from './format';
import { renderAwayDigest } from './render';

/** Survives a feature remount in the same page. A reload is a new return. */
const dismissedAwayIds = new Set<string>();

export function resetAwayDismissMemory(): void {
  dismissedAwayIds.clear();
}

/**
 * "While you were away" plate. A dismissed `colonyId` + `awayFrom` is not shown again.
 * Rendering keeps running behind the plate; this does not pause the session.
 */
export class AwayDigestModal {
  private root: HTMLElement | null = null;
  private openId: string | null = null;
  private onKey: ((e: KeyboardEvent) => void) | null = null;

  constructor(private readonly parent: HTMLElement) {}

  showWelcome(welcome: { reason?: string; away?: AwayDigestV1 }): void {
    const away = digestFromWelcome(welcome);
    if (away) this.show(away);
  }

  show(digest: AwayDigestV1): void {
    const id = awayIdentity(digest);
    if (dismissedAwayIds.has(id)) return;
    if (this.openId === id && this.root) return;
    this.remove();
    this.openId = id;
    this.root = renderAwayDigest(digest, () => this.dismiss());
    this.parent.appendChild(this.root);
    this.listen();
  }

  dismiss(): void {
    if (this.openId) dismissedAwayIds.add(this.openId);
    this.openId = null;
    this.remove();
  }

  dispose(): void {
    this.openId = null;
    this.remove();
  }

  private remove(): void {
    this.root?.remove();
    this.root = null;
    this.unlisten();
  }

  private listen(): void {
    if (this.onKey || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
    this.onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !this.root) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.dismiss();
    };
    document.addEventListener('keydown', this.onKey);
  }

  private unlisten(): void {
    if (!this.onKey || typeof document === 'undefined') return;
    document.removeEventListener('keydown', this.onKey);
    this.onKey = null;
  }
}
