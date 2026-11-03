import {
  RESOURCE_KEYS,
  type CargoStatusPayload,
  type ResourceFamily,
  type ResourceKey,
} from '@terra/contracts';
import { ENTITY_KIND, ENTITY_STATE } from '@terra/sim';
import type { Disposable, FeatureContext, GameView } from '../../core/registry/types';
import { normalizeKindCode, normalizeStateCode } from '../landfall/selectionHelpers';
import { ownColonyIndex, viewColony } from '../shared/colony';
import { clampPct, makeBtn, makeDiv, makeSpan } from '../shared/dom';
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
  extractPendingTransfers,
  formatPendingExportChipText,
  formatPendingImportChipText,
} from './cargoUx';
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

    const headerBuild = this.buildHeader();
    this.tierBadgeEl = headerBuild.tierBadge;
    this.statusBadgeEl = headerBuild.statusBadge;
    this.closeBtn = headerBuild.closeBtn;

    this.offlineBannerEl = makeDiv('ta-trade-hub__offline-banner plate-sm', 'trade-hub-offline-banner', 'Trade Hub is unpowered.');
    this.offlineBannerEl.hidden = true;

    const toastBuild = this.buildToastSection();
    this.toastEl = toastBuild.toastEl;
    this.floatingToastEl = toastBuild.floatingToastEl;
    this.toastController = toastBuild.controller;

    const pendingBuild = this.buildPendingSection();
    this.pendingContainerEl = pendingBuild.container;
    this.pendingExportChipEl = pendingBuild.exportChip;
    this.pendingImportChipEl = pendingBuild.importChip;

    const metersBuild = this.buildMetersRow();
    this.throughputValEl = metersBuild.throughputVal;
    this.throughputFillEl = metersBuild.throughputFill;
    this.dailyCapValEl = metersBuild.dailyCapVal;
    this.dailyCapFillEl = metersBuild.dailyCapFill;

    const tabsBuild = this.buildTabsRow();
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

    this.root.append(
      headerBuild.header,
      this.offlineBannerEl,
      this.toastEl,
      this.pendingContainerEl,
      metersBuild.metersRow,
      tabsBuild.tabsRow,
      this.orbitBalancesEl,
      this.tabBodyEl,
    );
    this.parent.appendChild(this.root);

    this.bindSelection();
    this.bindStore();
    this.render();
  }

  private buildToastSection(): { toastEl: HTMLElement; floatingToastEl: HTMLElement; controller: CargoToastController } {
    const toastEl = makeDiv('ta-trade-hub__toast plate-sm', 'trade-hub-toast');
    toastEl.setAttribute('role', 'status');
    toastEl.hidden = true;

    const floatingToastEl = makeDiv('ta-cargo-toast plate-sm', 'cargo-toast');
    floatingToastEl.setAttribute('role', 'status');
    floatingToastEl.setAttribute('aria-live', 'polite');
    floatingToastEl.hidden = true;
    this.parent.appendChild(floatingToastEl);

    const controller = new CargoToastController(toastEl, floatingToastEl);
    return { toastEl, floatingToastEl, controller };
  }

  private buildPendingSection(): {
    container: HTMLElement; exportChip: HTMLElement; importChip: HTMLElement;
  } {
    const container = makeDiv('ta-trade-hub__pending', 'trade-hub-pending');
    container.hidden = true;
    const exportChip = makeSpan('ta-trade-hub__chip ta-trade-hub__chip--export plate-sm', 'trade-hub-chip-export');
    exportChip.setAttribute('data-direction', 'export');
    exportChip.hidden = true;
    const importChip = makeSpan('ta-trade-hub__chip ta-trade-hub__chip--import plate-sm', 'trade-hub-chip-import');
    importChip.setAttribute('data-direction', 'import');
    importChip.hidden = true;
    container.append(exportChip, importChip);
    return { container, exportChip, importChip };
  }

  private buildHeader(): { header: HTMLElement; tierBadge: HTMLElement; statusBadge: HTMLElement; closeBtn: HTMLButtonElement } {
    const header = makeDiv('ta-trade-hub__header');
    const titleGroup = makeDiv('ta-trade-hub__title-group');
    const title = makeSpan('ta-trade-hub__title', 'trade-hub-title', 'INTER-COLONY TRADE HUB');
    const badges = makeDiv('ta-trade-hub__badges');
    const tierBadge = makeSpan('ta-trade-hub__badge ta-trade-hub__badge--tier plate-sm', 'trade-hub-tier', 'TIER 1');
    const statusBadge = makeSpan('ta-trade-hub__badge ta-trade-hub__badge--status plate-sm', 'trade-hub-status', 'ONLINE');
    statusBadge.setAttribute('data-online', 'true');
    badges.append(tierBadge, statusBadge);
    titleGroup.append(title, badges);
    const closeBtn = makeBtn('ta-trade-hub__close btn-sm plate-sm', 'trade-hub-close', 'CLOSE', () => {
      this.closedForEntityId = this.selectedHubId;
      this.setOpen(false);
    });
    closeBtn.setAttribute('aria-label', 'Close Trade Hub panel');
    header.append(titleGroup, closeBtn);
    return { header, tierBadge, statusBadge, closeBtn };
  }

  private buildMetersRow(): { metersRow: HTMLElement; throughputVal: HTMLElement; throughputFill: HTMLElement; dailyCapVal: HTMLElement; dailyCapFill: HTMLElement } {
    const metersRow = makeDiv('ta-trade-hub__meters');
    const tp = this.buildMeterCard('Throughput', 'trade-hub-throughput', 'trade-hub-throughput-val', '0 / 250 / min', 'trade-hub-throughput-fill');
    const dc = this.buildMeterCard('Daily Export Limit', 'trade-hub-daily-cap', 'trade-hub-daily-cap-val', '0 / 20,000 / day', 'trade-hub-daily-cap-fill ta-trade-hub__meter-fill--daily');
    metersRow.append(tp.card, dc.card);
    return { metersRow, throughputVal: tp.val, throughputFill: tp.fill, dailyCapVal: dc.val, dailyCapFill: dc.fill };
  }

  private buildMeterCard(title: string, meterId: string, valId: string, defaultVal: string, fillClass: string): {
    card: HTMLElement; val: HTMLElement; fill: HTMLElement;
  } {
    const card = makeDiv('ta-trade-hub__meter-card plate-sm');
    const meter = makeDiv('ta-trade-hub__meter', meterId);
    const val = makeSpan('ta-trade-hub__meter-val', valId, defaultVal);
    const bar = makeDiv('ta-trade-hub__meter-bar');
    const fill = makeDiv(`ta-trade-hub__meter-fill ${fillClass}`, fillClass.split(' ')[0]);
    fill.style.width = '0%';
    bar.appendChild(fill);
    meter.append(val, bar);
    card.append(makeSpan('ta-trade-hub__meter-label', undefined, title), meter);
    return { card, val, fill };
  }

  private buildTabsRow(): {
    tabsRow: HTMLElement;
    exportBtn: HTMLButtonElement;
    importBtn: HTMLButtonElement;
  } {
    const tabsRow = makeDiv('ta-trade-hub__tabs');
    tabsRow.setAttribute('role', 'tablist');
    const exportBtn = makeBtn('ta-trade-hub__tab btn-sm plate-sm', 'trade-hub-tab-export', 'EXPORT TO ORBIT', () => this.setTab('export'));
    exportBtn.setAttribute('role', 'tab');
    exportBtn.setAttribute('data-active', 'true');
    exportBtn.setAttribute('aria-selected', 'true');
    const importBtn = makeBtn('ta-trade-hub__tab btn-sm plate-sm', 'trade-hub-tab-import', 'IMPORT TO COLONY', () => this.setTab('import'));
    importBtn.setAttribute('role', 'tab');
    importBtn.setAttribute('data-active', 'false');
    importBtn.setAttribute('aria-selected', 'false');
    tabsRow.append(exportBtn, importBtn);
    return { tabsRow, exportBtn, importBtn };
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
        this.selectedHubId = selectedEntity.entityId;
        this.closedForEntityId = null;
        if (!isConstructing) {
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
    if (open) this.closedForEntityId = null;
    this.root.setAttribute('data-open', String(open));
    this.render();
  }

  isOpenState(): boolean {
    return this.isOpen;
  }

  setTab(tab: TradeHubTab): void {
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
        if (isCargo) this.notifyError(rej.code ?? 'mint_cap', rej.detail);
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

    this.root.setAttribute('data-open', String(this.isOpen));
    this.root.setAttribute('data-tab', this.activeTab);
    this.root.setAttribute('data-online', String(resolved.hubOnline));

    this.tierBadgeEl.textContent = `TIER ${resolved.hubTier}`;
    this.statusBadgeEl.textContent = resolved.statusText;
    this.statusBadgeEl.setAttribute('data-online', String(resolved.hubOnline));

    this.offlineBannerEl.hidden = resolved.hubOnline;
    this.offlineBannerEl.textContent = resolved.hubConstructing
      ? 'OFFLINE — CONSTRUCTING'
      : 'Trade Hub is unpowered.';

    const pending = extractPendingTransfers(resolved, this.view, resolved.colonyIndex);
    const hasExp = pending.exports.length > 0;
    const hasImp = pending.imports.length > 0;
    this.pendingContainerEl.hidden = !hasExp && !hasImp;
    this.pendingExportChipEl.hidden = !hasExp;
    if (hasExp) this.pendingExportChipEl.textContent = formatPendingExportChipText(pending.exports);
    this.pendingImportChipEl.hidden = !hasImp;
    if (hasImp) this.pendingImportChipEl.textContent = formatPendingImportChipText(pending.imports);

    this.throughputValEl.textContent = `${formatCargoCount(resolved.throughputUsedPerMin)} / ${formatCargoCount(resolved.throughputCapPerMin)} / min`;
    const tpPct = clampPct(resolved.throughputUsedPerMin, resolved.throughputCapPerMin || 250);
    this.throughputFillEl.style.width = `${tpPct.toFixed(1)}%`;
    this.throughputFillEl.setAttribute('data-progress', String(Math.round(tpPct)));

    this.dailyCapValEl.textContent = `${formatCargoCount(resolved.todayMinted)} / ${formatCargoCount(resolved.dailyCap)} / day`;
    const dcPct = clampPct(resolved.todayMinted, resolved.dailyCap);
    this.dailyCapFillEl.style.width = `${dcPct.toFixed(1)}%`;
    this.dailyCapFillEl.setAttribute('data-progress', String(Math.round(dcPct)));

    for (const key of RESOURCE_KEYS) {
      const entry = this.orbitRows.get(key);
      if (!entry) continue;
      const amt = resolved.inOrbit[key] ?? 0;
      entry.valEl.textContent = String(amt);
      entry.row.setAttribute('data-balance', String(amt));
      entry.row.setAttribute('data-empty', String(amt <= 0));
    }

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
    this.toastController.dispose();
    this.orbitRows.clear();
    this.root.remove();
  }
}
