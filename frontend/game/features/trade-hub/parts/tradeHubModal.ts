import { mockLabel, type MarketTokenKey } from '@terra/contracts';
import type { FeatureContext } from '../../../core/registry/types';
import { makeDiv, makeSpan } from '../../shared/dom';

interface ContractsLogLike {
  readonly list: readonly {
    readonly id: string;
    readonly kind: 'history.trade' | 'history.trade.failed';
    readonly text: string;
    readonly quote?: MarketTokenKey;
  }[];
  onChange(fn: () => void): () => void;
}

/**
 * Manages Trade Hub modal chrome: dark backdrop in `hudOverlay` (mounted only while modal is open so idle/disposed
 * overlay child count stays exact), `Escape` key dismissal, dynamic `?planet=` Trading Terminal URL, and live Recent
 * Signed Contracts summary synced from `ctx.services.contractsLog`.
 */
export class TradeHubModalBridge {
  readonly contractsSection: HTMLElement;
  private readonly contractsListEl: HTMLElement;
  private readonly backdropEl: HTMLElement;
  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private boundLog: ContractsLogLike | null = null;
  private offContracts: (() => void) | null = null;
  private modalActive = false;

  constructor(
    private readonly panelRoot: HTMLElement,
    private readonly ctx: FeatureContext | undefined,
    private readonly onClose: () => void,
  ) {
    this.backdropEl = makeDiv('ta-trade-hub-backdrop', 'trade-hub-backdrop');
    this.backdropEl.addEventListener('click', () => this.onClose());

    this.contractsSection = makeDiv('ta-trade-hub__contracts plate-sm', 'trade-hub-contracts-summary');
    const title = makeSpan('ta-trade-hub__section-title', undefined, 'RECENT TRADE CONTRACTS');
    this.contractsListEl = document.createElement('ul');
    this.contractsListEl.className = 'ta-trade-hub__contracts-list';
    this.contractsSection.append(title, this.contractsListEl);
    this.contractsSection.hidden = true;

    this.onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.modalActive) {
        e.preventDefault();
        e.stopPropagation();
        this.onClose();
      }
    };
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('keydown', this.onKeyDown);
    }
  }

  sync(isModalOpen: boolean, overlay: HTMLElement | undefined): void {
    this.modalActive = isModalOpen;
    if (isModalOpen && overlay) {
      if (this.backdropEl.parentElement !== overlay) {
        if (typeof overlay.insertBefore === 'function') {
          overlay.insertBefore(this.backdropEl, this.panelRoot.parentElement === overlay ? this.panelRoot : null);
        } else {
          overlay.appendChild(this.backdropEl);
        }
      }
      this.backdropEl.setAttribute('data-open', 'true');
    } else {
      this.backdropEl.removeAttribute('data-open');
      this.backdropEl.remove();
    }

    const termLink = this.panelRoot.querySelector<HTMLAnchorElement>('[data-testid="trade-hub-open-terminal"]');
    if (termLink) {
      const planetId = this.ctx?.services.session?.planetId?.() ?? null;
      termLink.href = planetId ? `/trade.html?planet=${encodeURIComponent(planetId)}` : '/trade.html';
    }

    this.syncContractsBinding();
  }

  private syncContractsBinding(): void {
    const nextLog = (this.ctx?.services as { contractsLog?: ContractsLogLike } | undefined)?.contractsLog ?? null;
    if (nextLog === this.boundLog) return;
    this.offContracts?.();
    this.offContracts = null;
    this.boundLog = nextLog;
    if (!nextLog) {
      this.contractsSection.hidden = true;
      return;
    }
    this.contractsSection.hidden = false;
    this.offContracts = nextLog.onChange(() => this.renderContracts());
    this.renderContracts();
  }

  private renderContracts(): void {
    const rows = this.boundLog?.list ?? [];
    if (rows.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'ta-trade-hub__contracts-empty';
      empty.textContent = 'No settled contracts yet. Signed market trades appear here.';
      this.contractsListEl.replaceChildren(empty);
      return;
    }
    this.contractsListEl.replaceChildren(...rows.map((row) => {
      const li = document.createElement('li');
      li.className = `ta-trade-hub__contract-row ta-trade-hub__contract-row--${row.kind === 'history.trade' ? 'signed' : 'failed'}`;
      const text = makeSpan('ta-trade-hub__contract-text', undefined, row.text);
      li.appendChild(text);
      if (row.quote) {
        li.appendChild(makeSpan('ta-trade-hub__contract-badge', undefined, mockLabel(row.quote).toUpperCase()));
      }
      return li;
    }));
  }

  dispose(): void {
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('keydown', this.onKeyDown);
    }
    this.offContracts?.();
    this.offContracts = null;
    this.boundLog = null;
    this.backdropEl.remove();
    this.contractsSection.remove();
  }
}
