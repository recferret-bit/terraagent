import { RESOURCE_KEYS, type CargoStatusPayload, type ResourceKey } from '@terra/contracts';
import { ENTITY_KIND, ENTITY_STATE } from '@terra/sim';
import type { Disposable, FeatureContext, GameView } from '../../core/registry/types';
import { normalizeKindCode, normalizeStateCode } from '../landfall/selectionHelpers';
import { ownColonyIndex, viewColony } from '../shared/colony';
import { clampPct } from '../shared/dom';
import {
  formatCargoCount,
  ORBIT_FAMILY_GROUPS,
  resolveTradeHubCargoView,
  scanColonyTradeHubs,
  SUB_RESOURCE_LABELS,
  type OrbitFamilyGroupDef,
  type OrbitSubResourceDef,
  type ResolvedTradeHubCargoView,
  type TradeHubTab,
} from './cargoView';

export {
  formatCargoCount,
  ORBIT_FAMILY_GROUPS,
  resolveTradeHubCargoView,
  SUB_RESOURCE_LABELS,
  type OrbitFamilyGroupDef,
  type OrbitSubResourceDef,
  type ResolvedTradeHubCargoView,
  type TradeHubTab,
};

function syncMockTreeText(root: HTMLElement): void {
  if ('nodeType' in root) return;
  const walk = (el: HTMLElement): string => {
    const children = (el as unknown as { children?: HTMLElement[] }).children;
    if (!children || children.length === 0) {
      return el.textContent ?? '';
    }
    const joined = children.map(walk).filter(Boolean).join(' ');
    (el as { textContent: string }).textContent = joined;
    return joined;
  };
  walk(root);
}

export class TradeHubPanel implements Disposable {
  readonly root: HTMLElement;
  readonly tabBodyEl: HTMLElement;
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
  private readonly tabPlaceholderEl: HTMLElement;
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
    this.tabPlaceholderEl = document.createElement('div');
    this.tabPlaceholderEl.className = 'ta-trade-hub__tab-placeholder';
    this.tabPlaceholderEl.textContent = 'Select cargo to export to orbit';
    this.tabBodyEl.appendChild(this.tabPlaceholderEl);

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
    const header = document.createElement('div');
    header.className = 'ta-trade-hub__header';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'ta-trade-hub__title-group';

    const title = document.createElement('span');
    title.className = 'ta-trade-hub__title';
    title.setAttribute('data-testid', 'trade-hub-title');
    title.textContent = 'INTER-COLONY TRADE HUB';

    const badges = document.createElement('div');
    badges.className = 'ta-trade-hub__badges';

    const tierBadge = document.createElement('span');
    tierBadge.className = 'ta-trade-hub__badge ta-trade-hub__badge--tier plate-sm';
    tierBadge.setAttribute('data-testid', 'trade-hub-tier');
    tierBadge.textContent = 'TIER 1';

    const statusBadge = document.createElement('span');
    statusBadge.className = 'ta-trade-hub__badge ta-trade-hub__badge--status plate-sm';
    statusBadge.setAttribute('data-testid', 'trade-hub-status');
    statusBadge.setAttribute('data-online', 'true');
    statusBadge.textContent = 'ONLINE';

    badges.append(tierBadge, statusBadge);
    titleGroup.append(title, badges);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'ta-trade-hub__close btn-sm plate-sm';
    closeBtn.setAttribute('data-testid', 'trade-hub-close');
    closeBtn.setAttribute('aria-label', 'Close Trade Hub panel');
    closeBtn.textContent = 'CLOSE';
    closeBtn.onclick = () => {
      this.closedForEntityId = this.selectedHubId;
      this.setOpen(false);
    };

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
    const metersRow = document.createElement('div');
    metersRow.className = 'ta-trade-hub__meters';

    const tpCard = document.createElement('div');
    tpCard.className = 'ta-trade-hub__meter-card plate-sm';
    const tpLabel = document.createElement('span');
    tpLabel.className = 'ta-trade-hub__meter-label';
    tpLabel.textContent = 'Throughput';
    const tpMeter = document.createElement('div');
    tpMeter.className = 'ta-trade-hub__meter';
    tpMeter.setAttribute('data-testid', 'trade-hub-throughput');
    const throughputVal = document.createElement('span');
    throughputVal.className = 'ta-trade-hub__meter-val';
    throughputVal.setAttribute('data-testid', 'trade-hub-throughput-val');
    throughputVal.textContent = '0 / 250 / min';
    const tpBar = document.createElement('div');
    tpBar.className = 'ta-trade-hub__meter-bar';
    const throughputFill = document.createElement('div');
    throughputFill.className = 'ta-trade-hub__meter-fill';
    throughputFill.setAttribute('data-testid', 'trade-hub-throughput-fill');
    throughputFill.style.width = '0%';
    tpBar.appendChild(throughputFill);
    tpMeter.append(throughputVal, tpBar);
    tpCard.append(tpLabel, tpMeter);

    const dcCard = document.createElement('div');
    dcCard.className = 'ta-trade-hub__meter-card plate-sm';
    const dcLabel = document.createElement('span');
    dcLabel.className = 'ta-trade-hub__meter-label';
    dcLabel.textContent = 'Daily Export Limit';
    const dcMeter = document.createElement('div');
    dcMeter.className = 'ta-trade-hub__meter';
    dcMeter.setAttribute('data-testid', 'trade-hub-daily-cap');
    const dailyCapVal = document.createElement('span');
    dailyCapVal.className = 'ta-trade-hub__meter-val';
    dailyCapVal.setAttribute('data-testid', 'trade-hub-daily-cap-val');
    dailyCapVal.textContent = '0 / 20,000 / day';
    const dcBar = document.createElement('div');
    dcBar.className = 'ta-trade-hub__meter-bar';
    const dailyCapFill = document.createElement('div');
    dailyCapFill.className = 'ta-trade-hub__meter-fill ta-trade-hub__meter-fill--daily';
    dailyCapFill.setAttribute('data-testid', 'trade-hub-daily-cap-fill');
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
    const tabsRow = document.createElement('div');
    tabsRow.className = 'ta-trade-hub__tabs';
    tabsRow.setAttribute('role', 'tablist');

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'ta-trade-hub__tab btn-sm plate-sm';
    exportBtn.setAttribute('role', 'tab');
    exportBtn.setAttribute('data-testid', 'trade-hub-tab-export');
    exportBtn.setAttribute('data-active', 'true');
    exportBtn.setAttribute('aria-selected', 'true');
    exportBtn.textContent = 'EXPORT TO ORBIT';
    exportBtn.onclick = () => this.setTab('export');

    const importBtn = document.createElement('button');
    importBtn.type = 'button';
    importBtn.className = 'ta-trade-hub__tab btn-sm plate-sm';
    importBtn.setAttribute('role', 'tab');
    importBtn.setAttribute('data-testid', 'trade-hub-tab-import');
    importBtn.setAttribute('data-active', 'false');
    importBtn.setAttribute('aria-selected', 'false');
    importBtn.textContent = 'IMPORT TO COLONY';
    importBtn.onclick = () => this.setTab('import');

    tabsRow.append(exportBtn, importBtn);
    return { tabsRow, exportBtn, importBtn };
  }

  private buildOrbitBalancesSection(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'ta-trade-hub__orbit-section plate-sm';
    section.setAttribute('data-testid', 'trade-hub-orbit-balances');

    const sectionTitle = document.createElement('div');
    sectionTitle.className = 'ta-trade-hub__section-title';
    sectionTitle.textContent = 'In Orbit';
    section.appendChild(sectionTitle);

    const familiesContainer = document.createElement('div');
    familiesContainer.className = 'ta-trade-hub__families';

    for (const group of ORBIT_FAMILY_GROUPS) {
      const familyEl = document.createElement('div');
      familyEl.className = 'ta-trade-hub__family plate-sm';
      familyEl.setAttribute('data-family', group.family);
      familyEl.setAttribute('data-testid', `orbit-family-${group.family}`);

      const familyHeader = document.createElement('div');
      familyHeader.className = 'ta-trade-hub__family-header';
      familyHeader.setAttribute('data-testid', `orbit-family-header-${group.family}`);
      familyHeader.textContent = group.label;
      familyEl.appendChild(familyHeader);

      for (const sub of group.resources) {
        const row = document.createElement('div');
        row.className = 'ta-trade-hub__orbit-row';
        row.setAttribute('data-testid', `orbit-balance-${sub.key}`);
        row.setAttribute('data-resource', sub.key);
        row.setAttribute('data-family', group.family);
        row.setAttribute('data-balance', '0');
        row.setAttribute('data-empty', 'true');

        const labelEl = document.createElement('span');
        labelEl.className = 'ta-trade-hub__orbit-label';
        labelEl.setAttribute('data-testid', `orbit-label-${sub.key}`);
        labelEl.textContent = sub.label;

        const valEl = document.createElement('span');
        valEl.className = 'ta-trade-hub__orbit-value';
        valEl.setAttribute('data-testid', `orbit-value-${sub.key}`);
        valEl.textContent = '0';

        row.append(labelEl, valEl);
        familyEl.appendChild(row);
        this.orbitRows.set(sub.key, { row, valEl });
      }

      familiesContainer.appendChild(familyEl);
    }

    section.appendChild(familiesContainer);
    return section;
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
    this.tabPlaceholderEl.textContent = isExport
      ? 'Select cargo to export to orbit'
      : 'Select orbital cargo to import to colony';
    syncMockTreeText(this.root);
  }

  getTab(): TradeHubTab {
    return this.activeTab;
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
    if (entityId !== null) {
      this.setOpen(true);
    } else {
      this.setOpen(false);
    }
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

    syncMockTreeText(this.root);
  }

  dispose(): void {
    this.offSelection?.();
    this.offSelection = null;
    this.orbitRows.clear();
    this.root.remove();
  }
}
