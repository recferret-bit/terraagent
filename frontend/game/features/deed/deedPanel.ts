import type { DeedUpdatedPayload, DeedView } from '@terra/contracts';
import type { Disposable, FeatureContext, GameView } from '../../core/registry/types';
import { createDeedCardArtElement } from './deedCardArt';
import {
  buildDeedHistorySection,
  buildDeedPanelHeader,
  buildDeedReceiptAndActions,
  defaultFallbackDeed,
  renderDeedHistoryList,
  renderDeedStatsGrid,
} from './deedPanelParts';
import { createDeedTracker } from './deedTracker';
import { StakingPanel, type StakingPanelOptions } from './stakingPanel';

export interface DeedPanelOptions extends StakingPanelOptions {
  readonly openWindow?: (url: string) => void;
  readonly onDeedChanged?: (deed: DeedView) => void;
}

/**
 * W20-10: Colony Deed Card UI panel (`Colony menu -> Deed`).
 * Thin orchestrator composing `deedPanelParts` and `deedCardArt`, with live `deed.updated` WS refresh.
 * Uses `createElement` + `textContent` only (never `innerHTML`).
 */
export class DeedPanel implements Disposable {
  readonly triggerBtn: HTMLButtonElement;
  readonly triggerStatusEl: HTMLSpanElement;
  readonly root: HTMLElement;
  readonly stakingSlotEl: HTMLElement;
  readonly stakingPanel: StakingPanel;

  private readonly versionBadgeEl: HTMLSpanElement;
  private readonly statusChipEl: HTMLSpanElement;
  private readonly pendingBadgeEl: HTMLSpanElement;
  private readonly previewWrapEl: HTMLElement;
  private readonly statsGridEl: HTMLElement;
  private readonly receiptLinkEl: HTMLAnchorElement;
  private readonly shareLinkEl: HTMLAnchorElement;
  private readonly settleBtnEl: HTMLButtonElement;
  private readonly historyListEl: HTMLUListElement;

  private isOpen = false;
  private currentDeed: DeedView | null = null;
  private readonly offs: Array<() => void> = [];
  private readonly fetchFn: typeof fetch;
  private readonly onDeedListeners = new Set<(deed: DeedView) => void>();

  constructor(
    private readonly parent: HTMLElement,
    private readonly ctx: FeatureContext,
    opts: DeedPanelOptions = {},
  ) {
    this.fetchFn = opts.fetchFn ?? ((input, init) => fetch(input, init));
    if (opts.onDeedChanged) this.onDeedListeners.add(opts.onDeedChanged);

    this.triggerBtn = document.createElement('button');
    this.triggerBtn.type = 'button';
    this.triggerBtn.className = 'ta-deed-hud-trigger plate-sm';
    this.triggerBtn.dataset.testid = 'colony-deed-btn';
    this.triggerBtn.dataset.settled = 'false';

    const triggerLabel = document.createElement('span');
    triggerLabel.textContent = 'COLONY · DEED';
    this.triggerStatusEl = document.createElement('span');
    this.triggerStatusEl.className = 'ta-deed-hud-trigger__status';
    this.triggerStatusEl.textContent = 'ACTIVE';

    this.triggerBtn.appendChild(triggerLabel);
    this.triggerBtn.appendChild(this.triggerStatusEl);
    this.triggerBtn.onclick = () => this.setOpen(!this.isOpen);

    this.root = document.createElement('section');
    this.root.className = 'ta-deed-panel plate';
    this.root.dataset.testid = 'deed-panel';
    this.root.dataset.open = 'false';
    this.root.dataset.settled = 'false';

    const header = buildDeedPanelHeader(() => this.setOpen(false));
    this.versionBadgeEl = header.versionBadge;
    this.statusChipEl = header.statusChip;
    this.pendingBadgeEl = header.pendingBadge;

    const body = document.createElement('div');
    body.className = 'ta-deed-panel__body';

    this.previewWrapEl = document.createElement('div');
    this.previewWrapEl.className = 'ta-deed-panel__preview-wrap';
    this.previewWrapEl.dataset.testid = 'deed-card-preview';

    const details = document.createElement('div');
    details.className = 'ta-deed-panel__details';

    this.statsGridEl = document.createElement('div');
    this.statsGridEl.className = 'ta-deed-panel__stats';
    this.statsGridEl.dataset.testid = 'deed-stats';

    const receiptRow = buildDeedReceiptAndActions({
      getCurrentDeed: () => this.currentDeed,
      onSettle: () => {
        void this.sealSettledDeed();
      },
      ctx: this.ctx,
      openWindow: opts.openWindow,
    });
    this.receiptLinkEl = receiptRow.receiptLink;
    this.shareLinkEl = receiptRow.shareLink;
    this.settleBtnEl = receiptRow.settleBtn;

    const historyBox = buildDeedHistorySection();
    this.historyListEl = historyBox.list;

    details.appendChild(this.statsGridEl);
    details.appendChild(receiptRow.receiptWrap);
    details.appendChild(receiptRow.actionsWrap);
    details.appendChild(historyBox.section);

    body.appendChild(this.previewWrapEl);
    body.appendChild(details);

    this.stakingSlotEl = document.createElement('div');
    this.stakingSlotEl.className = 'ta-deed-panel__staking-slot';
    this.stakingSlotEl.dataset.testid = 'deed-staking-slot';
    this.stakingPanel = new StakingPanel(this.stakingSlotEl, this.ctx, {
      fetchFn: this.fetchFn,
      openSigner: opts.openSigner,
    });
    this.onDeedListeners.add((d) => this.stakingPanel.syncDeed(d));

    this.root.appendChild(header.headerEl);
    this.root.appendChild(body);
    this.root.appendChild(this.stakingSlotEl);

    this.parent.appendChild(this.triggerBtn);
    this.parent.appendChild(this.root);

    this.bindRealtimeUpdates();
    this.renderDeed(defaultFallbackDeed(this.resolvePlanetId(), 'col_0'));
  }

  onDeedChanged(fn: (deed: DeedView) => void): () => void {
    this.onDeedListeners.add(fn);
    if (this.currentDeed) fn(this.currentDeed);
    return () => this.onDeedListeners.delete(fn);
  }

  getDeed(): DeedView | null {
    return this.currentDeed;
  }

  isOpenState(): boolean {
    return this.isOpen;
  }

  setOpen(open: boolean): void {
    this.isOpen = open;
    this.root.dataset.open = open ? 'true' : 'false';
    if (open) {
      void this.refreshFromServer(true);
      void this.stakingPanel.refreshFromServer();
    }
  }

  async refreshFromServer(trackView = false): Promise<DeedView | null> {
    try {
      const planetId = this.resolvePlanetId();
      const qs = new URLSearchParams({ colonyId: 'col_0' });
      if (planetId) qs.set('planetId', planetId);
      const res = await this.fetchFn(`/v1/near/deed?${qs.toString()}`);
      if (res.ok) {
        const body = (await res.json()) as { deeds?: DeedView[] };
        const first = body.deeds?.[0];
        if (first) {
          this.renderDeed(first);
          if (trackView) this.trackViewed(first);
          return first;
        }
      }
    } catch {
      // Keep fallback or existing deed view when offline
    }
    if (trackView && this.currentDeed) {
      this.trackViewed(this.currentDeed);
    }
    return this.currentDeed;
  }

  async sealSettledDeed(): Promise<DeedView | null> {
    const target = this.currentDeed;
    if (!target) return null;
    try {
      const res = await this.fetchFn('/v1/near/deed/settle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          colonyId: target.colonyId,
          planetId: target.planetId,
        }),
      });
      if (res.ok) {
        const body = (await res.json()) as { deed?: DeedView };
        if (body.deed) {
          this.renderDeed(body.deed);
          return body.deed;
        }
      }
    } catch {
      // ignore network failure in offline tests
    }
    return this.currentDeed;
  }

  renderDeed(deed: DeedView): void {
    this.currentDeed = deed;
    const isSettled = deed.settled || deed.status === 'settled';
    this.root.dataset.settled = isSettled ? 'true' : 'false';
    this.triggerBtn.dataset.settled = isSettled ? 'true' : 'false';
    this.triggerStatusEl.textContent = isSettled ? 'SETTLED' : deed.status.toUpperCase();

    this.versionBadgeEl.textContent = `v${deed.version}`;
    const statusLabel = isSettled
      ? 'Settled'
      : deed.status === 'eliminated'
        ? 'Eliminated'
        : deed.status === 'abandoned'
          ? 'Abandoned'
          : 'Active';
    this.statusChipEl.textContent = statusLabel;
    this.statusChipEl.dataset.status = isSettled ? 'settled' : deed.status;

    const retries = deed.pendingRetries ?? 0;
    const isPendingOrRetrying =
      deed.pendingState === 'PENDING' || deed.pendingState === 'FAILED' || retries > 0;
    this.pendingBadgeEl.dataset.pending = isPendingOrRetrying ? 'true' : 'false';
    this.pendingBadgeEl.textContent =
      retries > 0
        ? `Pending / retrying (retries: ${retries})`
        : isPendingOrRetrying
          ? 'Pending on NEAR'
          : 'Confirmed';

    while (this.previewWrapEl.firstChild) {
      this.previewWrapEl.removeChild(this.previewWrapEl.firstChild);
    }
    this.previewWrapEl.appendChild(
      createDeedCardArtElement(
        {
          ...deed.metadata,
          status: isSettled ? 'settled' : deed.status,
          settled: isSettled,
          version: deed.version,
        },
        {
          tokenId: deed.tokenId,
          ownerAccountId: deed.claimedByAccountId ?? deed.ownerAccountId,
        },
      ),
    );

    renderDeedStatsGrid(this.statsGridEl, deed);

    const encodedToken = encodeURIComponent(deed.tokenId);
    this.receiptLinkEl.href = `/dev/chain/?tab=deeds&tokenId=${encodedToken}`;
    this.receiptLinkEl.textContent = 'Recorded on NEAR (mock)';

    const sharePath = `/deed/${encodedToken}`;
    this.shareLinkEl.href = sharePath;
    this.shareLinkEl.textContent = sharePath;

    this.settleBtnEl.hidden =
      isSettled || deed.status === 'eliminated' || deed.status === 'abandoned';
    renderDeedHistoryList(this.historyListEl, deed);

    for (const listener of this.onDeedListeners) {
      listener(deed);
    }
  }

  update(_view: GameView): void {
    // Live updates arrive via WS `deed.updated` and server events
  }

  dispose(): void {
    for (const off of this.offs.splice(0)) off();
    this.triggerBtn.remove();
    this.root.remove();
  }

  private trackViewed(deed: DeedView): void {
    createDeedTracker(this.ctx.services.track).deedViewed({
      colonyId: deed.colonyId,
      planetId: deed.planetId,
      tokenId: deed.tokenId,
      settled: deed.settled,
    });
  }

  private bindRealtimeUpdates(): void {
    const store = this.ctx.services.store;
    if (store?.onDeedUpdated) {
      this.offs.push(
        store.onDeedUpdated((payload: DeedUpdatedPayload) => {
          if (payload.deed) {
            this.renderDeed(payload.deed);
          } else {
            void this.refreshFromServer(false);
          }
        }),
      );
    }
    if (store?.onServerEvents) {
      this.offs.push(
        store.onServerEvents((events) => {
          for (const ev of events) {
            if (
              ev.kind === 'deedUpdated' ||
              ev.kind === 'deedSettled' ||
              ev.kind === 'deedMinted'
            ) {
              void this.refreshFromServer(false);
            }
          }
        }),
      );
    }
  }

  private resolvePlanetId(): string | undefined {
    return (
      this.ctx.services.session?.planetId() ??
      this.ctx.services.store?.currentPlanetId?.() ??
      undefined
    );
  }
}
