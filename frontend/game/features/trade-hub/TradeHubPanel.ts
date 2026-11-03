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
import { formatTransferPreview, syncMockTreeText, TradeHubForms } from './TradeHubForms';

export {
  computeTransferBounds,
  formatCargoCount,
  formatTransferPreview,
  ORBIT_FAMILY_GROUPS,
  resolveTradeHubCargoView,
  SUB_RESOURCE_LABELS,
  TradeHubForms,
  type OrbitFamilyGroupDef,
  type OrbitSubResourceDef,
  type ResolvedTradeHubCargoView,
  type TradeHubTab,
  type TransferBounds,
};

export class TradeHubPanel implements Disposable {
  readonly root: HTMLElement;
  readonly tabBodyEl: HTMLElement;
  readonly forms: TradeHubForms;
  private readonly tierBadgeEl: HTMLElement;
  private readonly statusBadgeEl: HTMLElement;
  private readonly closeBtn: HTMLButtonElement;
  private readonly offlineBannerEl: HTMLElement;
  private readonly throughputValEl: HTMLElement;
  private readonly throughputFillEl: HTMLElement;
  private readonly dailyCapValEl: HTMLElement;
  private readonly dailyCapFillEl: HTMLElement;
  private readonly exportTabBtn: HTMLButtonElement;
  private readonly importTabBtn: HTMLButtonElement;
  private readonly orbitBalancesEl: HTMLElement;
  private readonly orbitRows = new Map<ResourceKey, { row: HTMLElement; valEl: HTMLElement }>();

  private isOpen = false;
  private activeTab: TradeHubTab = 'export';
  private view?: GameView;
  private cargoStatus: CargoStatusPayload | null = null;
  private selectedHubId: number | null = null;
  private closedForEntityId: number | null = null;
  private offSelection: (() => void) | null = null;

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

    this.offlineBannerEl = document.createElement('div');
    this.offlineBannerEl.className = 'ta-trade-hub__offline-banner plate-sm';
    this.offlineBannerEl.setAttribute('data-testid', 'trade-hub-offline-banner');
    this.offlineBannerEl.textContent = 'OFFLINE — UNPOWERED';
    this.offlineBannerEl.hidden = true;

    const metersBuild = this.buildMetersRow();
    this.throughputValEl = metersBuild.throughputVal;
    this.throughputFillEl = metersBuild.throughputFill;
    this.dailyCapValEl = metersBuild.dailyCapVal;
    this.dailyCapFillEl = metersBuild.dailyCapFill;

    const tabsBuild = this.buildTabsRow();
    this.exportTabBtn = tabsBuild.exportBtn;
    this.importTabBtn = tabsBuild.importBtn;

    this.orbitBalancesEl = this.buildOrbitBalancesSection();

    this.tabBodyEl = document.createElement('div');
    this.tabBodyEl.className = 'ta-trade-hub__tab-body plate-sm';
    this.tabBodyEl.setAttribute('data-testid', 'trade-hub-tab-body');

    this.forms = new TradeHubForms(this.tabBodyEl, {
      getTab: () => this.activeTab,
      getResolvedCargoView: () => this.getResolvedCargoView(),
      getContext: () => this.ctx,
      onResourceSelected: () => this.syncOrbitRowSelection(),
      onRenderRoot: () => syncMockTreeText(this.root),
    });

    this.root.append(
      headerBuild.header,
      this.offlineBannerEl,
      metersBuild.metersRow,
      tabsBuild.tabsRow,
      this.orbitBalancesEl,
      this.tabBodyEl,
    );
    this.parent.appendChild(this.root);

    this.bindSelection();
    this.render();
  }

  private buildHeader(): {
    header: HTMLElement;
    tierBadge: HTMLElement;
    statusBadge: HTMLElement;
    closeBtn: HTMLButtonElement;
  } {
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

  private buildMetersRow(): {
    metersRow: HTMLElement;
    throughputVal: HTMLElement;
    throughputFill: HTMLElement;
    dailyCapVal: HTMLElement;
    dailyCapFill: HTMLElement;
  } {
    const metersRow = makeDiv('ta-trade-hub__meters');

    const tpCard = makeDiv('ta-trade-hub__meter-card plate-sm');
    const tpLabel = makeSpan('ta-trade-hub__meter-label', undefined, 'Throughput');
    const tpMeter = makeDiv('ta-trade-hub__meter', 'trade-hub-throughput');
    const throughputVal = makeSpan('ta-trade-hub__meter-val', 'trade-hub-throughput-val', '0 / 250 / min');
    const tpBar = makeDiv('ta-trade-hub__meter-bar');
    const throughputFill = makeDiv('ta-trade-hub__meter-fill', 'trade-hub-throughput-fill');
    throughputFill.style.width = '0%';
    tpBar.appendChild(throughputFill);
    tpMeter.append(throughputVal, tpBar);
    tpCard.append(tpLabel, tpMeter);

    const dcCard = makeDiv('ta-trade-hub__meter-card plate-sm');
    const dcLabel = makeSpan('ta-trade-hub__meter-label', undefined, 'Daily Export Limit');
    const dcMeter = makeDiv('ta-trade-hub__meter', 'trade-hub-daily-cap');
    const dailyCapVal = makeSpan('ta-trade-hub__meter-val', 'trade-hub-daily-cap-val', '0 / 20,000 / day');
    const dcBar = makeDiv('ta-trade-hub__meter-bar');
    const dailyCapFill = makeDiv('ta-trade-hub__meter-fill ta-trade-hub__meter-fill--daily', 'trade-hub-daily-cap-fill');
    dailyCapFill.style.width = '0%';
    dcBar.appendChild(dailyCapFill);
    dcMeter.append(dailyCapVal, dcBar);
    dcCard.append(dcLabel, dcMeter);

    metersRow.append(tpCard, dcCard);
    return { metersRow, throughputVal, throughputFill, dailyCapVal, dailyCapFill };
  }

  private buildTabsRow(): {
    tabsRow: HTMLElement;
    exportBtn: HTMLButtonElement;
    importBtn: HTMLButtonElement;
  } {
    const tabsRow = makeDiv('ta-trade-hub__tabs');
    tabsRow.setAttribute('role', 'tablist');

    const exportBtn = makeBtn('ta-trade-hub__tab btn-sm plate-sm', 'trade-hub-tab-export', 'EXPORT TO ORBIT', () =>
      this.setTab('export'),
    );
    exportBtn.setAttribute('role', 'tab');
    exportBtn.setAttribute('data-active', 'true');
    exportBtn.setAttribute('aria-selected', 'true');

    const importBtn = makeBtn('ta-trade-hub__tab btn-sm plate-sm', 'trade-hub-tab-import', 'IMPORT TO COLONY', () =>
      this.setTab('import'),
    );
    importBtn.setAttribute('role', 'tab');
    importBtn.setAttribute('data-active', 'false');
    importBtn.setAttribute('aria-selected', 'false');

    tabsRow.append(exportBtn, importBtn);
    return { tabsRow, exportBtn, importBtn };
  }

  private buildOrbitBalancesSection(): HTMLElement {
    const section = makeDiv('ta-trade-hub__orbit-section plate-sm', 'trade-hub-orbit-balances');
    section.appendChild(makeDiv('ta-trade-hub__section-title', undefined, 'In Orbit'));

    const familiesContainer = makeDiv('ta-trade-hub__families');
    for (const group of ORBIT_FAMILY_GROUPS) {
      const familyEl = makeDiv('ta-trade-hub__family plate-sm', `orbit-family-${group.family}`);
      familyEl.setAttribute('data-family', group.family);
      familyEl.appendChild(makeDiv('ta-trade-hub__family-header', `orbit-family-header-${group.family}`, group.label));

      for (const sub of group.resources) {
        const row = makeDiv('ta-trade-hub__orbit-row', `orbit-balance-${sub.key}`);
        row.setAttribute('data-resource', sub.key);
        row.setAttribute('data-family', group.family);
        row.setAttribute('data-balance', '0');
        row.setAttribute('data-empty', 'true');
        row.onclick = () => this.selectResource(sub.key);

        const labelEl = makeSpan('ta-trade-hub__orbit-label', `orbit-label-${sub.key}`, sub.label);
        const valEl = makeSpan('ta-trade-hub__orbit-value', `orbit-value-${sub.key}`, '0');
        row.append(labelEl, valEl);
        familyEl.appendChild(row);
        this.orbitRows.set(sub.key, { row, valEl });
      }
      familiesContainer.appendChild(familyEl);
    }

    section.appendChild(familiesContainer);
    return section;
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

  selectFamily(family: ResourceFamily): void {
    this.forms.selectFamily(family);
  }

  getSelectedFamily(): ResourceFamily {
    return this.forms.getSelectedFamily();
  }

  selectResource(resource: ResourceKey): void {
    this.forms.selectResource(resource);
  }

  getSelectedResource(): ResourceKey {
    return this.forms.getSelectedResource();
  }

  setAmount(amount: number): void {
    this.forms.setAmount(amount);
  }

  getAmount(): number {
    return this.forms.getAmount();
  }

  getTransferBounds(): TransferBounds {
    return this.forms.getTransferBounds();
  }

  confirm(): boolean {
    return this.forms.confirm();
  }

  submitTransfer(amountOverride?: number): boolean {
    return this.forms.confirm(amountOverride);
  }

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

  update(view: GameView): void {
    this.bindSelection();
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
      : 'OFFLINE — UNPOWERED';

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
    this.orbitRows.clear();
    this.root.remove();
  }
}
