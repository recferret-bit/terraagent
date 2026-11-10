import { RESOURCE_KEYS, type ResourceKey } from '@terra/contracts';
import type { FeatureContext, GameView } from '../../../core/registry/types';
import { makeBtn, makeDiv, makeSpan } from '../../shared/dom';
import { createProgressBar, setProgress } from '../../shared/progress';
import { formatCargoCount, type ResolvedTradeHubCargoView, type TradeHubTab } from '../cargoView';
import {
  CargoToastController,
  extractPendingTransfers,
  formatPendingExportChipText,
  formatPendingImportChipText,
} from '../cargoUx';

export function buildTradeHubToastSection(
  parent: HTMLElement,
  ctx?: FeatureContext,
): { toastEl: HTMLElement; floatingToastEl: HTMLElement; controller: CargoToastController } {
  const toastEl = makeDiv('ta-trade-hub__toast plate-sm', 'trade-hub-toast');
  toastEl.setAttribute('role', 'status');
  toastEl.hidden = true;

  const floatingToastEl = makeDiv('ta-cargo-toast plate-sm', 'cargo-toast');
  floatingToastEl.setAttribute('role', 'status');
  floatingToastEl.setAttribute('aria-live', 'polite');
  floatingToastEl.hidden = true;
  (ctx?.services.hudOverlay ?? parent).appendChild(floatingToastEl); // shown while the panel is closed / its tab inactive

  const controller = new CargoToastController(toastEl, floatingToastEl);
  return { toastEl, floatingToastEl, controller };
}

export function buildTradeHubPendingSection(): {
  container: HTMLElement;
  exportChip: HTMLElement;
  importChip: HTMLElement;
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

export function buildTradeHubHeader(onClose: () => void): {
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
  const closeBtn = makeBtn('ta-trade-hub__close btn-sm plate-sm', 'trade-hub-close', 'CLOSE', onClose);
  closeBtn.setAttribute('aria-label', 'Close Trade Hub panel');
  header.append(titleGroup, closeBtn);
  return { header, tierBadge, statusBadge, closeBtn };
}

function buildMeterCard(
  title: string,
  meterId: string,
  valId: string,
  defaultVal: string,
  fillClass: string,
): { card: HTMLElement; val: HTMLElement; fill: HTMLElement } {
  const card = makeDiv('ta-trade-hub__meter-card plate-sm');
  const meter = makeDiv('ta-trade-hub__meter', meterId);
  const val = makeSpan('ta-trade-hub__meter-val', valId, defaultVal);
  const { bar, fill } = createProgressBar(
    title,
    'ta-trade-hub__meter-bar',
    `ta-trade-hub__meter-fill ${fillClass}`,
    fillClass.split(' ')[0],
  );
  meter.append(val, bar);
  card.append(makeSpan('ta-trade-hub__meter-label', undefined, title), meter);
  return { card, val, fill };
}

export function buildTradeHubMetersRow(): {
  metersRow: HTMLElement;
  throughputVal: HTMLElement;
  throughputFill: HTMLElement;
  dailyCapVal: HTMLElement;
  dailyCapFill: HTMLElement;
} {
  const metersRow = makeDiv('ta-trade-hub__meters');
  const tp = buildMeterCard('Throughput', 'trade-hub-throughput', 'trade-hub-throughput-val', '0 / 250 / min', 'trade-hub-throughput-fill');
  const dc = buildMeterCard('Daily Export Limit', 'trade-hub-daily-cap', 'trade-hub-daily-cap-val', '0 / 20,000 / day', 'trade-hub-daily-cap-fill ta-trade-hub__meter-fill--daily');
  metersRow.append(tp.card, dc.card);
  return { metersRow, throughputVal: tp.val, throughputFill: tp.fill, dailyCapVal: dc.val, dailyCapFill: dc.fill };
}

export function buildTradeHubTabsRow(onSelectTab: (tab: TradeHubTab) => void): {
  tabsRow: HTMLElement;
  exportBtn: HTMLButtonElement;
  importBtn: HTMLButtonElement;
} {
  const tabsRow = makeDiv('ta-trade-hub__tabs');
  tabsRow.setAttribute('role', 'tablist');
  const exportBtn = makeBtn('ta-trade-hub__tab btn-sm plate-sm', 'trade-hub-tab-export', 'EXPORT TO ORBIT', () => onSelectTab('export'));
  exportBtn.setAttribute('role', 'tab');
  exportBtn.setAttribute('data-active', 'true');
  exportBtn.setAttribute('aria-selected', 'true');
  const importBtn = makeBtn('ta-trade-hub__tab btn-sm plate-sm', 'trade-hub-tab-import', 'IMPORT TO COLONY', () => onSelectTab('import'));
  importBtn.setAttribute('role', 'tab');
  importBtn.setAttribute('data-active', 'false');
  importBtn.setAttribute('aria-selected', 'false');
  tabsRow.append(exportBtn, importBtn);
  return { tabsRow, exportBtn, importBtn };
}

export function renderTradeHubStatusAndMeters(
  els: {
    readonly root: HTMLElement;
    readonly tierBadgeEl: HTMLElement;
    readonly statusBadgeEl: HTMLElement;
    readonly offlineBannerEl: HTMLElement;
    readonly pendingContainerEl: HTMLElement;
    readonly pendingExportChipEl: HTMLElement;
    readonly pendingImportChipEl: HTMLElement;
    readonly throughputValEl: HTMLElement;
    readonly throughputFillEl: HTMLElement;
    readonly dailyCapValEl: HTMLElement;
    readonly dailyCapFillEl: HTMLElement;
    readonly orbitRows: ReadonlyMap<ResourceKey, { row: HTMLElement; valEl: HTMLElement }>;
  },
  resolved: ResolvedTradeHubCargoView,
  view: GameView | undefined,
  isOpen: boolean,
  activeTab: TradeHubTab,
): void {
  els.root.setAttribute('data-open', String(isOpen));
  els.root.setAttribute('data-tab', activeTab);
  els.root.setAttribute('data-online', String(resolved.hubOnline));

  els.tierBadgeEl.textContent = `TIER ${resolved.hubTier}`;
  els.statusBadgeEl.textContent = resolved.statusText;
  els.statusBadgeEl.setAttribute('data-online', String(resolved.hubOnline));

  els.offlineBannerEl.hidden = resolved.hubOnline;
  els.offlineBannerEl.textContent = resolved.hubConstructing
    ? 'OFFLINE — CONSTRUCTING'
    : 'Trade Hub is unpowered.';

  const pending = extractPendingTransfers(resolved, view, resolved.colonyIndex);
  const hasExp = pending.exports.length > 0;
  const hasImp = pending.imports.length > 0;
  els.pendingContainerEl.hidden = !hasExp && !hasImp;
  els.pendingExportChipEl.hidden = !hasExp;
  if (hasExp) els.pendingExportChipEl.textContent = formatPendingExportChipText(pending.exports);
  els.pendingImportChipEl.hidden = !hasImp;
  if (hasImp) els.pendingImportChipEl.textContent = formatPendingImportChipText(pending.imports);

  els.throughputValEl.textContent = `${formatCargoCount(resolved.throughputUsedPerMin)} / ${formatCargoCount(resolved.throughputCapPerMin)} / min`;
  setProgress(els.throughputFillEl, resolved.throughputUsedPerMin, resolved.throughputCapPerMin);

  els.dailyCapValEl.textContent = `${formatCargoCount(resolved.todayMinted)} / ${formatCargoCount(resolved.dailyCap)} / day`;
  setProgress(els.dailyCapFillEl, resolved.todayMinted, resolved.dailyCap);

  for (const key of RESOURCE_KEYS) {
    const entry = els.orbitRows.get(key);
    if (!entry) continue;
    const amt = resolved.inOrbit[key] ?? 0;
    entry.valEl.textContent = String(amt);
    entry.row.setAttribute('data-balance', String(amt));
    entry.row.setAttribute('data-empty', String(amt <= 0));
  }
}
