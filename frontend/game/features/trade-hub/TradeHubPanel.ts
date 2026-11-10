import {
  type CargoStatusPayload,
  type ResourceFamily,
  type ResourceKey,
} from '@terra/contracts';
import { ENTITY_KIND, ENTITY_STATE } from '@terra/sim';
import type { Disposable, FeatureContext, GameView } from '../../core/registry/types';
import { ownColonyIndex, viewColony } from '../shared/colony';
import { makeDiv } from '../shared/dom';
import { normalizeKindCode, normalizeStateCode } from '../shared/selectionMeta';
import {
  computeTransferBounds,
  formatCargoCount,
  ORBIT_FAMILY_GROUPS,
  resolveTradeHubCargoView,
  scanColonyTradeHubs,
  SUB_RESOURCE_LABELS,
  type OrbitFamilyGroupDef,
  type OrbitSubResourceDef,
  type ResolvedTradeHubCargoView,
  type TradeHubTab,
  type TransferBounds,
} from './cargoView';
import {
  CARGO_ERROR_MESSAGES,
  CargoToastController,
  buildOrbitBalancesSection,
} from './cargoUx';
import {
  buildTradeHubHeader,
  buildTradeHubMetersRow,
  buildTradeHubPendingSection,
  buildTradeHubTabsRow,
  buildTradeHubToastSection,
  renderTradeHubStatusAndMeters,
} from './parts/tradeHubDom';
import { TabExtensions } from './tabExtensions';
import { formatTransferPreview, syncMockTreeText, TradeHubForms } from './TradeHubForms';

export {
  computeTransferBounds, formatCargoCount, formatTransferPreview, ORBIT_FAMILY_GROUPS,
  resolveTradeHubCargoView, SUB_RESOURCE_LABELS, TradeHubForms,
  type OrbitFamilyGroupDef, type OrbitSubResourceDef, type ResolvedTradeHubCargoView,
  type TradeHubTab, type TransferBounds,
};

export class TradeHubPanel implements Disposable {
  readonly root: HTMLElement;
  readonly tabBodyEl: HTMLElement;
  readonly forms: TradeHubForms;
  readonly extensions: TabExtensions;
  private readonly tierBadgeEl: HTMLElement;
  private readonly statusBadgeEl: HTMLElement;
  private readonly closeBtn: HTMLButtonElement;
  private readonly offlineBannerEl: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly floatingToastEl: HTMLElement;
  private readonly toastController: CargoToastController;
  private readonly pendingContainerEl: HTMLElement;
  private readonly pendingExportChipEl: HTMLElement;
  private readonly pendingImportChipEl: HTMLElement;
  private readonly throughputValEl: HTMLElement;
  private readonly throughputFillEl: HTMLElement;
  private readonly dailyCapValEl: HTMLElement;
  private readonly dailyCapFillEl: HTMLElement;
  private readonly exportTabBtn: HTMLButtonElement;
  private readonly importTabBtn: HTMLButtonElement;
  private readonly orbitBalancesEl: HTMLElement;
  private readonly orbitRows: Map<ResourceKey, { row: HTMLElement; valEl: HTMLElement }>;

  private isOpen = false;
  private activeTab: TradeHubTab = 'export';
  private view?: GameView;
  private cargoStatus: CargoStatusPayload | null = null;
  private selectedHubId: number | null = null;
  private closedForEntityId: number | null = null;
  private offSelection: (() => void) | null = null;
  private offStoreReject: (() => void) | null = null;
  private offStoreEvents: (() => void) | null = null;
  private offStoreCargo: (() => void) | null = null;
  private lastSeenRefundRef: string | null = null;

  constructor(
    private readonly parent: HTMLElement,
    private readonly ctx?: FeatureContext,
    initialView?: GameView,
  ) {
    this.view = initialView;
    this.cargoStatus = ctx?.services.cargoStatus ?? null;

    this.root = document.createElement('section');
    this.root.className = 'ta-trade-hub plate';
    this.root.setAttribute('data-testid', 'trade-hub-panel');
    this.root.setAttribute('data-open', 'false');
    this.root.setAttribute('data-tab', 'export');
    this.root.setAttribute('data-online', 'true');

    const headerBuild = buildTradeHubHeader(() => {
      this.closedForEntityId = this.selectedHubId;
      this.setOpen(false);
    });
    this.tierBadgeEl = headerBuild.tierBadge;
    this.statusBadgeEl = headerBuild.statusBadge;
    this.closeBtn = headerBuild.closeBtn;

    this.offlineBannerEl = makeDiv('ta-trade-hub__offline-banner plate-sm', 'trade-hub-offline-banner', 'Trade Hub is unpowered.');
    this.offlineBannerEl.hidden = true;

    const toastBuild = buildTradeHubToastSection(this.parent, this.ctx);
    this.toastEl = toastBuild.toastEl;
    this.floatingToastEl = toastBuild.floatingToastEl;
    this.toastController = toastBuild.controller;

    const pendingBuild = buildTradeHubPendingSection();
    this.pendingContainerEl = pendingBuild.container;
    this.pendingExportChipEl = pendingBuild.exportChip;
    this.pendingImportChipEl = pendingBuild.importChip;

    const metersBuild = buildTradeHubMetersRow();
    this.throughputValEl = metersBuild.throughputVal;
    this.throughputFillEl = metersBuild.throughputFill;
    this.dailyCapValEl = metersBuild.dailyCapVal;
    this.dailyCapFillEl = metersBuild.dailyCapFill;

    const tabsBuild = buildTradeHubTabsRow((t) => this.setTab(t));
    this.exportTabBtn = tabsBuild.exportBtn;
    this.importTabBtn = tabsBuild.importBtn;

    const orbitBuild = buildOrbitBalancesSection((k) => this.selectResource(k));
    this.orbitBalancesEl = orbitBuild.section;
    this.orbitRows = orbitBuild.orbitRows;

    this.tabBodyEl = makeDiv('ta-trade-hub__tab-body plate-sm', 'trade-hub-tab-body');
    this.forms = new TradeHubForms(this.tabBodyEl, {
      getTab: () => this.activeTab,
      getResolvedCargoView: () => this.getResolvedCargoView(),
      getContext: () => this.ctx,
      onResourceSelected: () => this.syncOrbitRowSelection(),
      onRenderRoot: () => syncMockTreeText(this.root),
      onError: (code, detail, retryInS) => this.notifyError(code, detail, retryInS),
    });

    this.extensions = new TabExtensions(tabsBuild.tabsRow, this.tabBodyEl, ctx, (id) => this.root.setAttribute('data-tab', id ? `ext:${id}` : this.activeTab));
    const content = makeDiv('ta-trade-hub__content');
    const balances = makeDiv('ta-trade-hub__column');
    const transfer = makeDiv('ta-trade-hub__column');
    balances.append(metersBuild.metersRow, this.orbitBalancesEl);
    transfer.append(tabsBuild.tabsRow, this.tabBodyEl);
    content.append(balances, transfer);
    this.root.append(headerBuild.header, this.offlineBannerEl, this.toastEl, this.pendingContainerEl, content);
    this.parent.appendChild(this.root);

    this.bindSelection();
    this.bindStore();
    this.render();
  }

  private syncOrbitRowSelection(): void {
    const selected = this.forms.getSelectedResource();
    for (const [key, entry] of this.orbitRows.entries()) {
      entry.row.setAttribute('data-selected', String(key === selected));
    }
  }

  private bindSelection(): void {
    const landfall = this.ctx?.services.landfall;
    if (this.offSelection || typeof landfall?.onChange !== 'function') return;
    this.offSelection = landfall.onChange(({ selectedEntity }) => {
      if (selectedEntity && selectedEntity.kind === ENTITY_KIND.tradeHub) {
        const isConstructing =
          selectedEntity.state === ENTITY_STATE.constructing || selectedEntity.currentJob === 'constructing';
        if (this.selectedHubId !== selectedEntity.entityId) this.closedForEntityId = null;
        this.selectedHubId = selectedEntity.entityId;
        if (!isConstructing && this.closedForEntityId !== this.selectedHubId) {
          this.setOpen(true);
        }
        this.render();
      } else if (this.selectedHubId !== null) {
        this.selectedHubId = null;
        this.closedForEntityId = null;
        this.setOpen(false);
      }
    });
  }

  setOpen(open: boolean): void {
    this.isOpen = open;
    this.closedForEntityId = open ? null : this.selectedHubId;
    this.root.setAttribute('data-open', String(open));
    this.render();
  }

  isOpenState(): boolean {
    return this.isOpen;
  }

  setTab(tab: TradeHubTab): void {
    this.extensions.show(null);
    this.activeTab = tab;
    this.root.setAttribute('data-tab', tab);
    const isExport = tab === 'export';
    this.exportTabBtn.setAttribute('data-active', String(isExport));
    this.exportTabBtn.setAttribute('aria-selected', String(isExport));
    this.importTabBtn.setAttribute('data-active', String(!isExport));
    this.importTabBtn.setAttribute('aria-selected', String(!isExport));
    this.forms.onTabChanged();
    syncMockTreeText(this.root);
  }

  getTab(): TradeHubTab {
    return this.activeTab;
  }

  selectFamily(family: ResourceFamily): void { this.forms.selectFamily(family); }
  getSelectedFamily(): ResourceFamily { return this.forms.getSelectedFamily(); }
  selectResource(resource: ResourceKey): void { this.forms.selectResource(resource); }
  getSelectedResource(): ResourceKey { return this.forms.getSelectedResource(); }
  setAmount(amount: number): void { this.forms.setAmount(amount); }
  getAmount(): number { return this.forms.getAmount(); }
  getTransferBounds(): TransferBounds { return this.forms.getTransferBounds(); }
  confirm(): boolean { return this.forms.confirm(); }
  submitTransfer(amountOverride?: number): boolean { return this.forms.confirm(amountOverride); }

  setCargoStatus(status: CargoStatusPayload | null): void {
    this.cargoStatus = status;
    this.render();
  }

  getCargoStatus(): CargoStatusPayload | null {
    return this.cargoStatus ?? this.ctx?.services.cargoStatus ?? null;
  }

  selectEntity(entityId: number | null): void {
    this.selectedHubId = entityId;
    this.closedForEntityId = null;
    this.setOpen(entityId !== null);
  }

  getTabBodyElement(): HTMLElement {
    return this.tabBodyEl;
  }

  getResolvedCargoView(): ResolvedTradeHubCargoView {
    const colonyIdx = ownColonyIndex(this.ctx?.services);
    const status = this.cargoStatus ?? this.ctx?.services.cargoStatus ?? null;
    return resolveTradeHubCargoView(this.view, status, colonyIdx, this.selectedHubId);
  }

  private bindStore(): void {
    const store = this.ctx?.services.store;
    if (!this.offStoreReject && typeof store?.onCommandRejected === 'function') {
      this.offStoreReject = store.onCommandRejected((rej: { id?: string; kind?: string; code?: string; detail?: string }) => {
        const isCargo = rej.kind === 'cargo.export' || rej.kind === 'cargo.import' || (rej.code && rej.code in CARGO_ERROR_MESSAGES);
        if (isCargo) {
          const fallbackRetry = rej.code === 'mint_cap' && !rej.detail ? 60 : undefined;
          this.notifyError(rej.code ?? 'mint_cap', rej.detail, fallbackRetry);
        }
      });
    }
    const storeEvents = store as {
      cargoStatus?: CargoStatusPayload | null;
      onCargoStatus?(fn: (s: CargoStatusPayload) => void): () => void;
      onServerEvents?(fn: (e: readonly { kind: string; data?: Record<string, unknown> }[]) => void): () => void;
    } | undefined;
    if (!this.offStoreEvents && typeof storeEvents?.onServerEvents === 'function') {
      this.offStoreEvents = storeEvents.onServerEvents((events) => {
        for (const e of events) {
          if (e.kind === 'cargoRefunded' && e.data) {
            this.notifyRefund(Number(e.data.amount ?? 0), e.data.resource as ResourceKey, (e.data.direction ?? 'export') as 'export' | 'import');
          }
        }
      });
    }
    if (!this.offStoreCargo && typeof storeEvents?.onCargoStatus === 'function') {
      if (storeEvents.cargoStatus && !this.cargoStatus) this.cargoStatus = storeEvents.cargoStatus;
      this.offStoreCargo = storeEvents.onCargoStatus((s) => {
        if (this.ctx?.services) this.ctx.services.cargoStatus = s;
        this.setCargoStatus(s);
      });
    }
  }

  update(view: GameView): void {
    this.bindSelection();
    this.bindStore();
    this.view = view;
    if (this.ctx?.services.cargoStatus !== undefined) {
      this.cargoStatus = this.ctx.services.cargoStatus;
    }

    const raw = (view ?? {}) as {
      selectedEntityId?: number | null;
      selectedEntity?: { entityId?: number; id?: number; kind?: number | string; state?: number | string } | null;
    };
    const colonyIdx = ownColonyIndex(this.ctx?.services);
    const hubs = scanColonyTradeHubs(view as Record<string, unknown>, viewColony(view, colonyIdx), colonyIdx);

    const rawCol = viewColony(view as Record<string, unknown>, colonyIdx) as Record<string, unknown> | undefined;
    const colCargo = (rawCol?.cargo ?? (view as Record<string, unknown> | undefined)?.cargo) as Record<string, unknown> | undefined;
    const lastEvent = colCargo?.lastEvent as { kind?: string; ref?: string; amount?: number; resource?: ResourceKey; direction?: 'export' | 'import' } | undefined;
    if (lastEvent?.kind === 'refunded' && lastEvent.ref && lastEvent.ref !== this.lastSeenRefundRef) {
      this.lastSeenRefundRef = lastEvent.ref;
      if (typeof lastEvent.amount === 'number' && lastEvent.resource) {
        this.notifyRefund(lastEvent.amount, lastEvent.resource, lastEvent.direction ?? 'export');
      }
    }

    if (raw.selectedEntity && normalizeKindCode(raw.selectedEntity.kind) === ENTITY_KIND.tradeHub) {
      const id = Number(raw.selectedEntity.entityId ?? raw.selectedEntity.id ?? 0);
      const st = normalizeStateCode(raw.selectedEntity.state);
      this.selectedHubId = id;
      if (st !== ENTITY_STATE.constructing && this.closedForEntityId !== id) {
        this.isOpen = true;
        this.root.setAttribute('data-open', 'true');
      }
    } else if (typeof raw.selectedEntityId === 'number') {
      const hit = hubs.find((h) => h.id === raw.selectedEntityId);
      if (hit) {
        this.selectedHubId = hit.id;
        if (!hit.constructing && this.closedForEntityId !== hit.id) {
          this.isOpen = true;
          this.root.setAttribute('data-open', 'true');
        }
      }
    }

    this.render();
  }

  notifyError(code: string, detail?: string, retryInS?: number | null): void {
    this.toastController.notifyError(code, detail, retryInS);
    syncMockTreeText(this.root);
  }

  notifyRefund(amount: number, resource: ResourceKey, direction: 'export' | 'import' = 'export'): void {
    this.toastController.notifyRefund(amount, resource, direction);
    syncMockTreeText(this.root);
  }

  dismissToast(): void {
    this.toastController.dismiss();
    syncMockTreeText(this.root);
  }

  private render(): void {
    const resolved = this.getResolvedCargoView();

    const details = this.ctx?.services.selectionDetails;
    if (this.selectedHubId !== null) details?.show(this.root, this.isOpen, (open) => {
      this.closedForEntityId = open ? null : this.selectedHubId;
      this.setOpen(open);
    });
    else { details?.hide(); if (this.root.parentElement && this.root.parentElement !== this.parent) this.parent.append(this.root); } // back to its HUD tab
    this.toastController.setPanelOpen(this.isOpen);

    renderTradeHubStatusAndMeters(
      {
        root: this.root,
        tierBadgeEl: this.tierBadgeEl,
        statusBadgeEl: this.statusBadgeEl,
        offlineBannerEl: this.offlineBannerEl,
        pendingContainerEl: this.pendingContainerEl,
        pendingExportChipEl: this.pendingExportChipEl,
        pendingImportChipEl: this.pendingImportChipEl,
        throughputValEl: this.throughputValEl,
        throughputFillEl: this.throughputFillEl,
        dailyCapValEl: this.dailyCapValEl,
        dailyCapFillEl: this.dailyCapFillEl,
        orbitRows: this.orbitRows,
      },
      resolved,
      this.view,
      this.isOpen,
      this.activeTab,
    );

    this.forms.render(resolved);
    this.syncOrbitRowSelection();
    syncMockTreeText(this.root);
  }

  dispose(): void {
    this.offSelection?.();
    this.offSelection = null;
    this.offStoreReject?.();
    this.offStoreReject = null;
    this.offStoreEvents?.();
    this.offStoreEvents = null;
    this.offStoreCargo?.();
    this.offStoreCargo = null;
    this.extensions.dispose();
    this.toastController.dispose();
    this.orbitRows.clear();
    this.root.remove();
  }
}
