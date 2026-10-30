import type { ViewColony } from '@terra/sim';
import { checkBuildingAffordability } from '@terra/sim';
import type { CommandResult, SendCommand } from '../../net/commandBus';
import type { Transport } from '../../net/types';
import type { GameView } from '../../core/registry/types';

export interface StoreLike {
  readonly latest?: unknown;
  onView?(fn: (v: unknown) => void): () => void;
  onCommandRejected?(fn: (r: { id: string; kind: string; code: string }) => void): () => void;
}

export interface MinimalHudOptions {
  sendCommand?: SendCommand;
  store?: StoreLike;
  transport?: Pick<Transport, 'onMessage'>;
  ownerColonyIndex?: number;
}

export function formatClock(tick: number): string {
  const totalSeconds = Math.max(0, Math.floor(tick / 5));
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  return `${mm}:${ss}`;
}

const DEFAULT_HUB_COST: Record<string, number> = {
  'metals.t1': 200,
  'minerals.t1': 100,
  'bio.biomass': 50,
  'bio.water': 50,
};

export function formatRejectToast(
  code: string,
  detail?: string,
  stock?: Record<string, number>,
  buildingCost: Record<string, number> = DEFAULT_HUB_COST,
): string {
  if (code === 'insufficient_resources') {
    if (stock) {
      const afford = checkBuildingAffordability(buildingCost, stock);
      if (!afford.ok && afford.shortResource) {
        const res = afford.shortResource;
        const have = Math.floor(afford.have);
        const need = Math.floor(afford.need);
        if (res.startsWith('metals')) return `Waiting: Metals ${have}/${need}`;
        if (res.startsWith('minerals')) return `Waiting: Minerals ${have}/${need}`;
        if (res.includes('biomass')) return `Waiting: Biomass ${have}/${need}`;
        if (res.includes('water')) return `Waiting: Water ${have}/${need}`;
        return `Waiting: ${res} ${have}/${need}`;
      }
    }
    return 'Waiting: Insufficient resources';
  }

  const KNOWN: Record<string, string> = {
    not_own_territory: 'Rejected: Not your territory',
    site_blocked: 'Rejected: Site blocked',
    worker_tier_locked: 'Rejected: Requires HQ',
    tier_locked: 'Rejected: Tier locked',
    unknown_entity: 'Rejected: Unknown entity',
    invalid_args: 'Rejected: Invalid placement',
    colony_inactive: 'Rejected: Colony inactive',
    supply_cap: 'Rejected: Supply cap reached',
    terrain_unbuildable: 'Rejected: Terrain unbuildable',
    no_trade_hub: 'Rejected: Requires Trade Hub',
    truce_active: 'Rejected: Truce active',
    wave_disabled: 'Rejected: Wave disabled',
    timeout: 'Not confirmed: Timeout',
    not_connected: 'Not connected',
  };

  if (KNOWN[code]) return KNOWN[code];
  if (detail) return `Rejected: ${detail}`;
  const clean = code.replace(/_/g, ' ');
  return `Rejected: ${clean.charAt(0).toUpperCase() + clean.slice(1)}`;
}

function extractHqCell(view: GameView, colonyIndex = 0): { cell: number; cellMax: number } {
  const v = view as {
    colonies?: ViewColony[];
    blobs?: Record<string, unknown>;
  };
  const col = v.colonies?.find((c) => c.index === colonyIndex) ?? v.colonies?.[colonyIndex];
  const hq = col?.hq as { cell?: number; cellMax?: number } | undefined;
  if (hq && typeof hq.cell === 'number' && typeof hq.cellMax === 'number') {
    return { cell: hq.cell, cellMax: hq.cellMax };
  }
  const blobHq = v.blobs?.hq as
    | { cell?: number; cellMax?: number; byColony?: Record<number, { cell?: number; cellMax?: number }> }
    | undefined;
  const byCol = blobHq?.byColony?.[colonyIndex];
  if (byCol && typeof byCol.cell === 'number') {
    return { cell: byCol.cell, cellMax: byCol.cellMax ?? 800 };
  }
  if (blobHq && typeof blobHq.cell === 'number') {
    return { cell: blobHq.cell, cellMax: blobHq.cellMax ?? 800 };
  }
  return { cell: 800, cellMax: 800 };
}

/**
 * Minimal HUD bar: colony name, game clock, Metals/Minerals/Bio stock + family caps,
 * HQ power cell bar, and reject/resource waiting toasts.
 */
export class MinimalHud {
  readonly el: HTMLElement;
  readonly toastContainer: HTMLElement;
  private readonly colonyEl: HTMLElement;
  private readonly clockEl: HTMLElement;
  private readonly metalsEl: HTMLElement;
  private readonly metalsVal: HTMLElement;
  private readonly mineralsEl: HTMLElement;
  private readonly mineralsVal: HTMLElement;
  private readonly bioEl: HTMLElement;
  private readonly bioVal: HTMLElement;
  private readonly bioSub: HTMLElement;
  private readonly supplyEl: HTMLElement;
  private readonly supplyVal: HTMLElement;
  private readonly cellEl: HTMLElement;
  private readonly cellVal: HTMLElement;
  private readonly cellFill: HTMLElement;
  private latestView: GameView | null = null;
  private latestTick = 0;
  private cleanups: Array<() => void> = [];

  constructor(parent: HTMLElement, private readonly opts: MinimalHudOptions = {}) {
    this.el = document.createElement('div');
    this.el.className = 'plate ta-hud-min';
    this.el.dataset.testid = 'hud-min';

    const { brand, colonyEl, clockEl } = this.createBrand();
    this.colonyEl = colonyEl;
    this.clockEl = clockEl;

    const { stocks, metalsEl, metalsVal, mineralsEl, mineralsVal, bioEl, bioVal, bioSub, supplyEl, supplyVal } =
      this.createStocks();
    this.metalsEl = metalsEl;
    this.metalsVal = metalsVal;
    this.mineralsEl = mineralsEl;
    this.mineralsVal = mineralsVal;
    this.bioEl = bioEl;
    this.bioVal = bioVal;
    this.bioSub = bioSub;
    this.supplyEl = supplyEl;
    this.supplyVal = supplyVal;

    const { cellEl, cellVal, cellFill } = this.createCell();
    this.cellEl = cellEl;
    this.cellVal = cellVal;
    this.cellFill = cellFill;

    this.toastContainer = document.createElement('div');
    this.toastContainer.className = 'ta-hud-toasts';
    this.toastContainer.dataset.testid = 'hud-toast-container';

    this.el.append(brand, stocks, this.cellEl, this.toastContainer);
    parent.appendChild(this.el);

    this.initListeners();
  }

  private createBrand(): { brand: HTMLElement; colonyEl: HTMLElement; clockEl: HTMLElement } {
    const brand = document.createElement('div');
    brand.className = 'ta-hud-min__brand';
    const colonyEl = document.createElement('span');
    colonyEl.className = 'ta-hud-min__colony';
    colonyEl.dataset.testid = 'hud-colony-name';
    colonyEl.textContent = 'Colony 0';

    const clockEl = document.createElement('span');
    clockEl.className = 'ta-hud-min__clock';
    clockEl.dataset.testid = 'hud-clock';
    clockEl.textContent = '00:00';
    brand.append(colonyEl, clockEl);
    return { brand, colonyEl, clockEl };
  }

  private createStocks(): {
    stocks: HTMLElement;
    metalsEl: HTMLElement;
    metalsVal: HTMLElement;
    mineralsEl: HTMLElement;
    mineralsVal: HTMLElement;
    bioEl: HTMLElement;
    bioVal: HTMLElement;
    bioSub: HTMLElement;
    supplyEl: HTMLElement;
    supplyVal: HTMLElement;
  } {
    const stocks = document.createElement('div');
    stocks.className = 'ta-hud-min__stocks';

    const metalsEl = document.createElement('div');
    metalsEl.className = 'ta-hud-min__stock ta-hud-min__stock--metals';
    metalsEl.dataset.testid = 'hud-stock-metals';
    const metalsLbl = document.createElement('span');
    metalsLbl.className = 'ta-hud-min__stock-label';
    metalsLbl.textContent = 'Metals ';
    const metalsVal = document.createElement('span');
    metalsVal.className = 'ta-hud-min__stock-val';
    metalsVal.textContent = '0 / 500';
    metalsEl.append(metalsLbl, metalsVal);

    const mineralsEl = document.createElement('div');
    mineralsEl.className = 'ta-hud-min__stock ta-hud-min__stock--minerals';
    mineralsEl.dataset.testid = 'hud-stock-minerals';
    const minLbl = document.createElement('span');
    minLbl.className = 'ta-hud-min__stock-label';
    minLbl.textContent = 'Minerals ';
    const mineralsVal = document.createElement('span');
    mineralsVal.className = 'ta-hud-min__stock-val';
    mineralsVal.textContent = '0 / 500';
    mineralsEl.append(minLbl, mineralsVal);

    const bioEl = document.createElement('div');
    bioEl.className = 'ta-hud-min__stock ta-hud-min__stock--bio';
    bioEl.dataset.testid = 'hud-stock-bio';
    const bioLbl = document.createElement('span');
    bioLbl.className = 'ta-hud-min__stock-label';
    bioLbl.textContent = 'Bio ';
    const bioVal = document.createElement('span');
    bioVal.className = 'ta-hud-min__stock-val';
    bioVal.textContent = '0 / 500 ';
    const bioSub = document.createElement('span');
    bioSub.className = 'ta-hud-min__stock-sub';
    bioSub.textContent = '(Biomass 0 · Water 0)';
    bioEl.append(bioLbl, bioVal, bioSub);

    const supplyEl = document.createElement('div');
    supplyEl.className = 'ta-hud-min__stock ta-hud-min__stock--supply';
    supplyEl.dataset.testid = 'hud-supply';
    const supplyLbl = document.createElement('span');
    supplyLbl.className = 'ta-hud-min__stock-label';
    supplyLbl.textContent = 'Supply ';
    const supplyVal = document.createElement('span');
    supplyVal.className = 'ta-hud-min__stock-val';
    supplyVal.textContent = '0 / 0';
    supplyEl.append(supplyLbl, supplyVal);

    stocks.append(metalsEl, mineralsEl, bioEl, supplyEl);

    return { stocks, metalsEl, metalsVal, mineralsEl, mineralsVal, bioEl, bioVal, bioSub, supplyEl, supplyVal };
  }

  private createCell(): { cellEl: HTMLElement; cellVal: HTMLElement; cellFill: HTMLElement } {
    const cellEl = document.createElement('div');
    cellEl.className = 'ta-hud-min__cell';
    cellEl.dataset.testid = 'hud-hq-cell';

    const cellHead = document.createElement('div');
    cellHead.className = 'ta-hud-min__cell-head';
    const cellLbl = document.createElement('span');
    cellLbl.className = 'ta-hud-min__cell-label';
    cellLbl.textContent = 'HQ CELL ';
    const cellVal = document.createElement('span');
    cellVal.className = 'ta-hud-min__cell-val';
    cellVal.textContent = '800 / 800 E';
    cellHead.append(cellLbl, cellVal);

    const cellBar = document.createElement('div');
    cellBar.className = 'ta-hud-min__cell-bar';
    const cellFill = document.createElement('div');
    cellFill.className = 'ta-hud-min__cell-fill';
    cellFill.dataset.testid = 'hud-hq-cell-bar';
    cellFill.style.width = '100%';
    cellBar.appendChild(cellFill);
    cellEl.append(cellHead, cellBar);

    return { cellEl, cellVal, cellFill };
  }

  private initListeners(): void {
    if (this.opts.store?.onCommandRejected) {
      this.cleanups.push(
        this.opts.store.onCommandRejected((rej) => {
          this.handleReject(rej.code, undefined, { kind: rej.kind });
        }),
      );
    }
    if (this.opts.transport?.onMessage) {
      this.cleanups.push(
        this.opts.transport.onMessage((m) => {
          if (m.t === 'cmd.reject') {
            this.handleReject(m.d.code, m.d.detail);
          }
        }),
      );
    }
  }

  update(view: GameView): void {
    this.latestView = view;
    const v = view as {
      tick?: number;
      colonies?: ViewColony[];
      blobs?: Record<string, unknown>;
    };
    const tick = v.tick ?? 0;
    this.latestTick = tick;
    this.clockEl.textContent = formatClock(tick);

    const colonyIdx = this.opts.ownerColonyIndex ?? 0;
    const col = v.colonies?.find((c) => c.index === colonyIdx) ?? v.colonies?.[colonyIdx];
    this.colonyEl.textContent = col?.name ?? `Colony ${colonyIdx}`;

    const stock = this.getColonyStock();
    const caps = (col?.caps ?? {}) as Record<string, number>;
    const capMetals = caps.metals ?? 500;
    const capMinerals = caps.minerals ?? 500;
    const capBio = caps.bio ?? 500;

    const metalsT1 = stock['metals.t1'] ?? 0;
    const metalsTotal = metalsT1 + (stock['metals.t2'] ?? 0) + (stock['metals.t3'] ?? 0);
    const mineralsT1 = stock['minerals.t1'] ?? 0;
    const mineralsTotal = mineralsT1 + (stock['minerals.t2'] ?? 0) + (stock['minerals.t3'] ?? 0);
    const biomass = stock['bio.biomass'] ?? 0;
    const water = stock['bio.water'] ?? 0;
    const bioTotal = biomass + water + (stock['bio.t2'] ?? 0) + (stock['bio.t3'] ?? 0);

    this.metalsVal.textContent = `${metalsTotal} / ${capMetals}`;
    this.metalsEl.title = `Iron (T1): ${metalsT1} · Cap: ${capMetals}`;

    this.mineralsVal.textContent = `${mineralsTotal} / ${capMinerals}`;
    this.mineralsEl.title = `Silica (T1): ${mineralsT1} · Cap: ${capMinerals}`;

    this.bioVal.textContent = `${bioTotal} / ${capBio} `;
    this.bioSub.textContent = `(Biomass ${biomass} · Water ${water})`;
    this.bioEl.title = `Biomass: ${biomass} · Water: ${water} · Cap: ${capBio}`;

    const supplyUsed = (col as { supplyUsed?: number } | undefined)?.supplyUsed ?? 0;
    const supplyCap = (col as { supplyCap?: number } | undefined)?.supplyCap ?? 0;
    this.supplyVal.textContent = `${supplyUsed} / ${supplyCap}`;
    this.supplyEl.title = `Supply: ${supplyUsed} / ${supplyCap}`;

    const { cell, cellMax } = extractHqCell(view, colonyIdx);
    this.cellVal.textContent = `${Math.round(cell)} / ${Math.round(cellMax)} E`;
    const pct = cellMax > 0 ? Math.max(0, Math.min(100, (cell / cellMax) * 100)) : 0;
    this.cellFill.style.width = `${pct.toFixed(1)}%`;
  }

  showToast(message: string, severity: 'warning' | 'error' | 'info' = 'warning', durationMs = 4000): HTMLElement {
    const toast = document.createElement('div');
    toast.className = `plate-sm ta-hud-toast ta-hud-toast--${severity}`;
    toast.dataset.testid = 'hud-toast';
    toast.dataset.severity = severity;
    toast.textContent = message;

    const timer = setTimeout(() => {
      toast.remove();
    }, durationMs);

    toast.onclick = () => {
      clearTimeout(timer);
      toast.remove();
    };

    this.toastContainer.appendChild(toast);
    return toast;
  }

  handleReject(code: string, detail?: string, cmd?: { kind: string; args?: unknown }): HTMLElement {
    const stock = this.getColonyStock();
    const isHub = cmd?.kind === 'placeBuilding' || !cmd;
    const cost = isHub ? DEFAULT_HUB_COST : undefined;
    const msg = formatRejectToast(code, detail, stock, cost);
    return this.showToast(msg, 'warning');
  }

  onCommandOutcome(
    cmd: { kind: string; args?: unknown },
    outcome: { ok: boolean; code?: string; detail?: string },
    view?: GameView,
  ): void {
    if (view) this.update(view);
    if (!outcome.ok && outcome.code) {
      this.handleReject(outcome.code, outcome.detail, cmd);
    }
  }

  notifyCommandResult(kind: string, args: unknown, result: CommandResult): void {
    if (!result.ok) {
      this.handleReject(result.code, result.detail, { kind, args });
    }
  }

  async checkOrSendPlaceBuilding(building: string, q: number, r: number): Promise<CommandResult> {
    const isHub = building.toLowerCase().includes('hub');
    const cost = isHub ? DEFAULT_HUB_COST : {};
    const stock = this.getColonyStock();
    const afford = checkBuildingAffordability(cost, stock);
    if (!afford.ok) {
      const msg = formatRejectToast('insufficient_resources', undefined, stock, cost);
      this.showToast(msg, 'warning');
      return { ok: false, code: 'insufficient_resources', detail: msg };
    }
    if (this.opts.sendCommand) {
      const res = await this.opts.sendCommand('placeBuilding', { building, q, r });
      if (!res.ok) {
        this.handleReject(res.code, res.detail, { kind: 'placeBuilding', args: { building, q, r } });
      }
      return res;
    }
    return { ok: true, appliedAtTick: this.latestTick };
  }

  getColonyStock(): Record<string, number> {
    const view = this.latestView as {
      colonies?: ViewColony[];
      blobs?: Record<string, unknown>;
    } | null;
    const idx = this.opts.ownerColonyIndex ?? 0;
    const col = view?.colonies?.find((c) => c.index === idx) ?? view?.colonies?.[idx];
    const fromCol = col?.stock as Record<string, number> | undefined;
    const rawBlob = view?.blobs?.colonyStock;
    const blobStock = (
      rawBlob && typeof rawBlob === 'object' && 'value' in rawBlob
        ? (rawBlob as { value: unknown }).value
        : rawBlob
    ) as Record<string | number, Record<string, number>> | undefined;
    const fromBlob = blobStock?.[idx] ?? blobStock?.[String(idx)];
    return { ...(fromCol ?? {}), ...(fromBlob ?? {}) };
  }

  dispose(): void {
    for (const off of this.cleanups) off();
    this.cleanups = [];
    this.el.remove();
  }
}
