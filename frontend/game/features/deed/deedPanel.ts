import type { DeedUpdatedPayload, DeedView } from '@terra/contracts';
import type { Disposable, FeatureContext, GameView } from '../../core/registry/types';
import { createDeedCardArtElement } from './deedCardArt';
import { createDeedTracker } from './deedTracker';
import {
  applyDeedHeaderBadges,
  buildDeedPanelDom,
  defaultFallbackDeed,
  renderDeedHistoryList,
  renderDeedStatsGrid,
} from './parts/deedPanelParts';
import { StakingPanel, type StakingPanelOptions } from './stakingPanel';

export interface DeedPanelOptions extends StakingPanelOptions {
  readonly openWindow?: (url: string) => void;
  readonly onDeedChanged?: (deed: DeedView) => void;
}

/**
 * W20-10: Colony Deed Card UI panel (`Colony menu -> Deed`).
 * Thin orchestrator composing `parts/deedPanelParts` and `deedCardArt`, with live `deed.updated` WS refresh.
 * Uses `createElement` + `textContent` only (never `innerHTML`).
 */
export class DeedPanel implements Disposable {
  readonly triggerBtn: HTMLButtonElement;
  readonly triggerStatusEl: HTMLSpanElement;
  /** One-line hint under the trigger; shown only inside the Colony book's Deed tab (deedPanel.css). */
  private readonly hintEl: HTMLParagraphElement;
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
  private lastWarp: number | undefined;
  private readonly warpTimers = new Set< ReturnType<typeof setTimeout> >();
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

    const offCloser = ctx.services.registerHudCloser?.(() => { if (this.isOpen) this.setOpen(false); });
    if (offCloser) this.offs.push(offCloser);

    const dom = buildDeedPanelDom({
      parent: this.parent,
      ctx: this.ctx,
      onToggle: () => this.setOpen(!this.isOpen),
      onClose: () => this.setOpen(false),
      getCurrentDeed: () => this.currentDeed,
      onSettle: () => { void this.sealSettledDeed(); },
      openWindow: opts.openWindow,
    });
    this.triggerBtn = dom.triggerBtn;
    this.triggerStatusEl = dom.triggerStatusEl;
    this.hintEl = dom.hintEl;
    this.root = dom.root;
    this.stakingSlotEl = dom.stakingSlotEl;
    this.versionBadgeEl = dom.versionBadgeEl;
    this.statusChipEl = dom.statusChipEl;
    this.pendingBadgeEl = dom.pendingBadgeEl;
    this.previewWrapEl = dom.previewWrapEl;
    this.statsGridEl = dom.statsGridEl;
    this.receiptLinkEl = dom.receiptLinkEl;
    this.shareLinkEl = dom.shareLinkEl;
    this.settleBtnEl = dom.settleBtnEl;
    this.historyListEl = dom.historyListEl;

    this.stakingPanel = new StakingPanel(this.stakingSlotEl, this.ctx, {
      fetchFn: this.fetchFn,
      openSigner: opts.openSigner,
    });
    this.onDeedListeners.add((d) => this.stakingPanel.syncDeed(d));

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
    const wasSettled = Boolean(this.currentDeed?.settled || this.currentDeed?.status === 'settled');
    this.currentDeed = deed;
    const isSettled = deed.settled || deed.status === 'settled';
    if (isSettled && !wasSettled && this.ctx.flags.has('W12')) {
      this.ctx.services.achievementToasts?.show({
        achievementId: 'settler',
        familyId: 'settler',
        familyName: 'Settler',
        tierName: 'Bronze',
        xp: 50,
      });
    }
    applyDeedHeaderBadges(
      {
        root: this.root,
        triggerBtn: this.triggerBtn,
        triggerStatusEl: this.triggerStatusEl,
        versionBadgeEl: this.versionBadgeEl,
        statusChipEl: this.statusChipEl,
        pendingBadgeEl: this.pendingBadgeEl,
      },
      deed,
      isSettled,
    );

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

    if (deed.version > 1) {
      const latest = [...deed.history].sort((a, b) => b.version - a.version)[0];
      const latestChange = latest?.change;
      if (latestChange) {
        this.ctx.services.deedToasts?.handleUpdate({
          colonyId: deed.colonyId,
          tokenId: deed.tokenId,
          version: deed.version,
          change: latestChange,
          settled: isSettled,
        });
      }
    }

    for (const listener of this.onDeedListeners) {
      listener(deed);
    }
  }

  update(view: GameView): void {
    if (view.warp !== this.lastWarp) {
      const prev = this.lastWarp;
      this.lastWarp = view.warp;
      if (prev !== undefined && view.warp && view.warp > 1) {
        void this.refreshFromServer(false);
        void this.stakingPanel.refreshFromServer();
        for (const delayMs of [600, 1500]) {
          const timer = setTimeout(() => {
            this.warpTimers.delete(timer);
            void this.refreshFromServer(false);
            void this.stakingPanel.refreshFromServer();
          }, delayMs);
          this.warpTimers.add(timer);
        }
      }
    }
  }

  dispose(): void {
    for (const timer of this.warpTimers) clearTimeout(timer);
    this.warpTimers.clear();
    for (const off of this.offs.splice(0)) off();
    this.triggerBtn.remove();
    this.hintEl.remove();
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
