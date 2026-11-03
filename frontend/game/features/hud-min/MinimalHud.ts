import { capsOf, TICKS_PER_SECOND, type CompiledDataLike, type ViewColony } from '@terra/sim';
import type { Transport } from '../../net/types';
import type { GameView } from '../../core/registry/types';
import { viewColony } from '../shared/colony';
import { clampPct, makeDiv, makeSpan } from '../shared/dom';
import { extractHqFromView } from '../shared/hqView';
import { readDaytime } from '../shared/daytime';
import { readColonyPower } from '../shared/power';
import { createHudIcon, type HudIconKind } from './hudIcons';
import { readColonySupply } from '../shared/supply';
import { formatRejectToast } from './rejectText';
import { formatSupplyValue, renderSupplyBreakdown, supplyTitle } from './supplyBreakdown';
import {
  bindHoverPopover,
  computeResourceFlow,
  renderFamilyBreakdown,
  renderPowerBreakdown,
  type FamilyKey,
  type ResourceFlowSummary,
} from './resourceBreakdown';

export { formatRejectToast };

export interface StoreLike {
  readonly latest?: unknown;
  onView?(fn: (v: unknown) => void): () => void;
  onCommandRejected?(fn: (r: { id: string; kind: string; code: string }) => void): () => void;
  /** The host's live balance data (costs of a reject's shortfall line). */
  simData?(): CompiledDataLike | null;
}

export interface MinimalHudOptions {
  store?: StoreLike;
  transport?: Pick<Transport, 'onMessage'>;
  ownerColonyIndex?: number;
  getOwnerColonyIndex?: () => number | undefined;
  /**
   * Whether wave `wave` is on (the live client flags). The planet time of day and the grid supply / demand lines are
   * W02 (power-core, environment): with W02 off (`?waves=..01`) they are hidden. Default: every wave on.
   */
  isWaveOn?: (wave: string) => boolean;
}

/** Shown in place of a number until the first view arrives. */
export const NO_DATA = '—';

export function formatClock(tick: number): string {
  const totalSeconds = Math.max(0, Math.floor(tick / TICKS_PER_SECOND));
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  return `${mm}:${ss}`;
}

/**
 * Colony resources are whole units (the sim ledger); flooring at this one read boundary guarantees the HUD and its
 * toasts never show a fraction even if a stale or malformed view carries one.
 */
export function wholeStock(stock: Record<string, number> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, v] of Object.entries(stock ?? {})) {
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = Math.floor(v);
  }
  return out;
}

interface StockSlot {
  el: HTMLElement;
  val: HTMLElement;
  breakdown: HTMLElement;
}

function stockSlot(kind: HudIconKind, testid: string, name: string, family: FamilyKey | 'supply'): StockSlot {
  const el = makeDiv(`ta-hud-min__stock ta-hud-min__stock--${kind} ta-res-chip`, testid);
  el.setAttribute('data-family', family);
  el.title = name;
  const val = makeSpan('ta-hud-min__stock-val', undefined, NO_DATA);
  el.append(createHudIcon(kind), makeSpan('ta-hud-min__sr-only', undefined, `${name}: `), val);

  el.setAttribute('data-capped', 'false');
  const breakdown = makeDiv('ta-res-chip__breakdown plate-sm', `res-breakdown-${family}`);
  if (family === 'supply') {
    el.setAttribute('data-level', 'ok');
    renderSupplyBreakdown(breakdown, null);
  } else {
    renderFamilyBreakdown(breakdown, family, {}, computeResourceFlow(undefined, undefined, 0));
  }
  el.appendChild(breakdown);
  bindHoverPopover(el);
  return { el, val, breakdown };
}

/**
 * Compact top HUD header: icon-only Metals/Minerals/Bio stocks with hover tier & flow breakdowns, unit Supply
 * `used / cap` with its sources breakdown,
 * inline HQ power cell bar with hover power breakdown, planet time of day, game clock, and reject/resource waiting toasts.
 */
export class MinimalHud {
  readonly el: HTMLElement;
  readonly toastContainer: HTMLElement;
  private readonly toastedRejects = new Set<string>();
  private readonly toastTimers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
  private readonly colonyEl: HTMLElement;
  private readonly clockEl: HTMLElement;
  private readonly metals: StockSlot;
  private readonly minerals: StockSlot;
  private readonly bio: StockSlot;
  private readonly bioSub: HTMLElement;
  private readonly supply: StockSlot;
  private readonly cellVal: HTMLElement;
  private readonly cellFill: HTMLElement;
  private readonly cellBreakdown: HTMLElement;
  private readonly daytimeEl: HTMLElement;
  private readonly daytimeIcon: HTMLElement;
  private readonly daytimeClock: HTMLElement;
  private readonly daytimeLight: HTMLElement;
  private cleanups: Array<() => void> = [];

  constructor(parent: HTMLElement, private readonly opts: MinimalHudOptions = {}) {
    this.el = makeDiv('plate-sm ta-hud-min ta-resources-hud', 'hud-min');

    const brand = makeDiv('ta-hud-min__brand');
    this.colonyEl = makeSpan('ta-hud-min__colony ta-hud-min__sr-only', 'hud-colony-name', 'Colony');
    this.clockEl = makeSpan('ta-hud-min__clock', 'hud-clock', '00:00');
    brand.append(this.colonyEl, createHudIcon('clock'), this.clockEl);

    const stocks = makeDiv('ta-hud-min__stocks');
    this.metals = stockSlot('metals', 'hud-stock-metals', 'Metals', 'metals');
    this.minerals = stockSlot('minerals', 'hud-stock-minerals', 'Minerals', 'minerals');
    this.bio = stockSlot('bio', 'hud-stock-bio', 'Bio', 'bio');
    this.bioSub = makeSpan('ta-hud-min__stock-sub ta-hud-min__sr-only');
    this.bio.el.insertBefore(this.bioSub, this.bio.breakdown ?? null);
    this.supply = stockSlot('supply', 'hud-supply', 'Supply', 'supply');
    stocks.append(this.metals.el, this.minerals.el, this.bio.el, this.supply.el);

    const cellEl = makeDiv('ta-hud-min__cell ta-res-chip', 'hud-hq-cell');
    cellEl.setAttribute('data-family', 'energy');
    cellEl.title = 'HQ Power Cell';
    const cellBar = makeDiv('ta-hud-min__cell-bar');
    this.cellFill = makeDiv('ta-hud-min__cell-fill', 'hud-hq-cell-bar');
    this.cellFill.style.width = '0%';
    cellBar.appendChild(this.cellFill);
    this.cellVal = makeSpan('ta-hud-min__cell-val', undefined, `${NO_DATA} E`);
    this.cellBreakdown = makeDiv('ta-res-chip__breakdown plate-sm', 'res-breakdown-energy');
    renderPowerBreakdown(this.cellBreakdown, undefined, null, true);
    cellEl.append(
      createHudIcon('cell'),
      makeSpan('ta-hud-min__sr-only', undefined, 'HQ power cell: '),
      cellBar,
      this.cellVal,
      this.cellBreakdown,
    );
    bindHoverPopover(cellEl);

    // Planet time of day (the sim's solar clock), right after energy: solar output follows the daylight %.
    this.daytimeEl = makeDiv('ta-hud-min__daytime', 'hud-daytime');
    this.daytimeEl.setAttribute('data-phase', 'day');
    this.daytimeEl.title = 'Local time · daylight (solar output)';
    this.daytimeIcon = makeSpan('ta-hud-min__daytime-icon', undefined, '☀');
    this.daytimeIcon.setAttribute('aria-hidden', 'true');
    this.daytimeClock = makeSpan('ta-hud-min__daytime-clock', 'hud-daytime-clock', NO_DATA);
    this.daytimeLight = makeSpan('ta-hud-min__daytime-light', 'hud-daytime-light', '');
    this.daytimeEl.append(this.daytimeIcon, this.daytimeClock, this.daytimeLight);
    this.daytimeEl.hidden = !this.gridOn();

    this.toastContainer = makeDiv('ta-hud-toasts', 'hud-toast-container');
    this.toastContainer.setAttribute('role', 'status');
    this.toastContainer.setAttribute('aria-live', 'polite');

    this.el.append(stocks, cellEl, this.daytimeEl, brand, this.toastContainer);
    parent.appendChild(this.el);
    this.initListeners();
  }

  private initListeners(): void {
    if (this.opts.store?.onCommandRejected) {
      this.cleanups.push(
        this.opts.store.onCommandRejected((rej) => {
          if (this.firstRejectOf(rej.id)) this.handleReject(rej.code, undefined, { kind: rej.kind });
        }),
      );
    }
    if (this.opts.transport?.onMessage) {
      this.cleanups.push(
        this.opts.transport.onMessage((m) => {
          if (m.t === 'cmd.reject' && this.firstRejectOf(m.d.id)) {
            this.handleReject(m.d.code, m.d.detail);
          }
        }),
      );
    }
  }

  /** W02 grid power and solar clock are on (read per call: the flags are live). */
  private gridOn(): boolean {
    return this.opts.isWaveOn?.('W02') ?? true;
  }

  private colonyIndex(): number {
    return this.opts.getOwnerColonyIndex?.() ?? this.opts.ownerColonyIndex ?? 0;
  }

  update(view: GameView): void {
    const v = view as { tick?: number };
    this.clockEl.textContent = formatClock(v.tick ?? 0);

    const colonyIdx = this.colonyIndex();
    const col = viewColony(view, colonyIdx);
    this.colonyEl.textContent = col?.name ?? `Colony ${colonyIdx}`;
    this.renderStocks(col, view as unknown as Record<string, unknown>, colonyIdx);

    const hqCell = extractHqFromView(view, colonyIdx, this.opts.store?.simData?.() ?? undefined);
    this.cellVal.textContent = hqCell ? `${Math.round(hqCell.cell)} / ${Math.round(hqCell.cellMax)} E` : `${NO_DATA} E`;
    this.cellFill.style.width = `${(hqCell ? clampPct(hqCell.cell, hqCell.cellMax) : 0).toFixed(1)}%`;

    const grid = this.gridOn();
    renderPowerBreakdown(this.cellBreakdown, readColonyPower(view, colonyIdx), hqCell, true, grid);
    this.daytimeEl.hidden = !grid;
    if (grid) this.renderDaytime(view, colonyIdx);
  }

  private renderDaytime(view: GameView, colonyIdx: number): void {
    const t = readDaytime(view, colonyIdx);
    this.daytimeEl.setAttribute('data-phase', t?.phase ?? 'day');
    this.daytimeIcon.textContent = t?.phase === 'night' ? '☾' : '☀';
    this.daytimeClock.textContent = t?.clockText ?? NO_DATA;
    this.daytimeLight.textContent = t ? `${Math.round(t.daylight * 100)}%` : '';
  }

  private setFamilyStatus(
    slot: StockSlot,
    family: FamilyKey,
    total: number,
    cap: number,
    stock: Record<string, number>,
    flow: ResourceFlowSummary,
    textOverride?: string,
  ): void {
    const isCapped = cap > 0 && total >= cap - 1e-6;
    slot.el.setAttribute('data-capped', String(isCapped));
    slot.el.classList.toggle('ta-res-chip--capped', isCapped);
    slot.val.textContent = textOverride ?? `${total} / ${cap}`;
    if (slot.breakdown) {
      renderFamilyBreakdown(slot.breakdown, family, stock, flow);
    }
  }

  private renderStocks(col: ViewColony | undefined, view: Record<string, unknown>, colonyIdx: number): void {
    const stock = wholeStock(col?.stock);
    const caps = capsOf(col?.caps); // the sim's caps, INITIAL_CAPS for a family the view does not carry
    const flow = computeResourceFlow(col as unknown as Record<string, unknown> | undefined, view, colonyIdx);

    const metalsT1 = stock['metals.t1'] ?? 0;
    const metalsTotal = metalsT1 + (stock['metals.t2'] ?? 0) + (stock['metals.t3'] ?? 0);
    const mineralsT1 = stock['minerals.t1'] ?? 0;
    const mineralsTotal = mineralsT1 + (stock['minerals.t2'] ?? 0) + (stock['minerals.t3'] ?? 0);
    const biomass = stock['bio.biomass'] ?? 0;
    const water = stock['bio.water'] ?? 0;
    const bioTotal = biomass + water + (stock['bio.t2'] ?? 0) + (stock['bio.t3'] ?? 0);

    this.setFamilyStatus(this.metals, 'metals', metalsTotal, caps.metals, stock, flow);
    this.metals.el.title = `Iron (T1): ${metalsT1} · Cap: ${caps.metals}`;
    this.setFamilyStatus(this.minerals, 'minerals', mineralsTotal, caps.minerals, stock, flow);
    this.minerals.el.title = `Silica (T1): ${mineralsT1} · Cap: ${caps.minerals}`;
    this.setFamilyStatus(this.bio, 'bio', bioTotal, caps.bio, stock, flow, `${bioTotal} / ${caps.bio} `);
    this.bioSub.textContent = `(Biomass ${biomass} · Water ${water})`;
    this.bio.el.title = `Biomass: ${biomass} · Water: ${water} · Cap: ${caps.bio}`;

    this.renderSupply(view, colonyIdx);
  }

  /** Unit supply `used / cap` from the host's `colony.supply`: warn colour near the cap, alert colour at it. */
  private renderSupply(view: Record<string, unknown>, colonyIdx: number): void {
    const supply = readColonySupply(view, colonyIdx);
    const level = renderSupplyBreakdown(this.supply.breakdown, supply);
    this.supply.val.textContent = formatSupplyValue(supply);
    this.supply.el.title = supplyTitle(supply);
    this.supply.el.setAttribute('data-level', level);
    this.supply.el.setAttribute('data-capped', String(level === 'full'));
  }

  /** One reject reaches the HUD twice (the transport's `cmd.reject` and the store's rollback): toast it once. */
  private firstRejectOf(id: string | undefined): boolean {
    if (!id) return true;
    if (this.toastedRejects.has(id)) return false;
    this.toastedRejects.add(id);
    if (this.toastedRejects.size > 64) this.toastedRejects.delete(this.toastedRejects.values().next().value as string);
    return true;
  }

  private armTimer(toast: HTMLElement, durationMs: number): void {
    clearTimeout(this.toastTimers.get(toast));
    this.toastTimers.set(toast, setTimeout(() => this.dismissToast(toast), durationMs));
  }

  private dismissToast(toast: HTMLElement): void {
    clearTimeout(this.toastTimers.get(toast));
    this.toastTimers.delete(toast);
    toast.remove();
  }

  /**
   * Shows `message`. A toast with the same `key` (e.g. one reject cause), or else the same text, already on screen is
   * updated and its timer restarted instead of stacking a second one. Toasts are buttons: click or Enter dismisses.
   */
  showToast(message: string, severity: 'warning' | 'error' | 'info' = 'warning', durationMs = 4000, key?: string): HTMLElement {
    const existing = [...this.toastContainer.children].find(
      (el) => el instanceof HTMLElement && el.dataset.severity === severity && (key ? el.dataset.key === key : el.textContent === message),
    ) as HTMLElement | undefined;
    if (existing) {
      existing.textContent = message;
      this.armTimer(existing, durationMs);
      return existing;
    }
    const toast = document.createElement('button');
    toast.type = 'button';
    toast.className = `plate-sm ta-hud-toast ta-hud-toast--${severity}`;
    toast.dataset.testid = 'hud-toast';
    toast.dataset.severity = severity;
    if (key) toast.dataset.key = key;
    toast.textContent = message;
    toast.onclick = () => this.dismissToast(toast);
    this.armTimer(toast, durationMs);
    this.toastContainer.appendChild(toast);
    return toast;
  }

  /** Toast for a rejected command. The shortfall line uses the command's real cost when its kind is known. */
  handleReject(code: string, detail?: string, cmd?: { kind: string; args?: unknown }): HTMLElement {
    const msg = formatRejectToast(code, detail, cmd?.kind);
    return this.showToast(msg, 'warning', 4000, `reject:${code}`);
  }

  dispose(): void {
    for (const off of this.cleanups) off();
    this.cleanups = [];
    for (const t of this.toastTimers.values()) clearTimeout(t);
    this.toastTimers.clear();
    this.el.remove();
  }
}
