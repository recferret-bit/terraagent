import {
  cancelConstructionOrder,
  placeBuildingOrder,
  spawnHqUnit,
  type ConstructionOrder,
  type PlanetState,
} from '@terra/sim';
import type { GameView } from '../../core/registry/types';
import type { ClientTiles } from '../../store/replica/viewCodec';
import { ensureDom, makeBtn, makeDiv, setDataAttr } from './dom';
import {
  evaluateHubGhost,
  extractColonyConstructionOrders,
  type GhostSource,
  type HubGhostBill,
  type HubGhostState,
} from './GhostEvaluator';

export type TilePickerFn = (
  clientX: number,
  clientY: number,
  target?: EventTarget | null,
) => { q: number; r: number } | null;

export interface HubPlacementCommandSink {
  sendCommand?: (kind: string, args?: unknown) => unknown;
  store?: {
    latest?: GameView | null;
    latestTiles?: ClientTiles | null;
    sendCommand?: (cmdOrKind: unknown, args?: unknown) => unknown;
  };
  host?: {
    readonly state: PlanetState;
    readonly pending: number;
    view(): GameView;
  };
  state?: PlanetState;
  colonyId?: number;
  requireHq?: boolean;
  onChange?: () => void;
}

const HUB_COST_TEXT = '200 Metals · 100 Minerals · 50 Biomass · 50 Water';

export function formatGhostYields(yields: HubGhostBill['yields']): string {
  const parts: string[] = [];
  if (yields['metals.t1'] > 0) parts.push(`+${yields['metals.t1']} Metals`);
  if (yields['bio.biomass'] > 0) parts.push(`+${yields['bio.biomass']} Biomass`);
  return parts.length > 0 ? parts.join(' · ') : '0 yields';
}

export function formatGhostOps(ops: HubGhostBill['ops']): string {
  return `Grade ${ops.grade} · Clear ${ops.clear} · Break ${ops.break}`;
}

let orderSeq = 0;

export class HubPlacementMenu {
  readonly el: HTMLElement;
  readonly ghostEl: HTMLElement;
  private readonly buildHubBtn: HTMLButtonElement;
  private readonly reasonEl: HTMLElement;
  private readonly gridEl: HTMLElement;
  private readonly billEl: HTMLElement;
  private readonly billTilesEl: HTMLElement;
  private readonly billOpsEl: HTMLElement;
  private readonly billTimeEl: HTMLElement;
  private readonly billEnergyEl: HTMLElement;
  private readonly billYieldsEl: HTMLElement;
  private readonly confirmBtn: HTMLButtonElement;
  private readonly cancelBtn: HTMLButtonElement;
  private readonly orderStatusEl: HTMLElement;
  private readonly cancelOrderBtn: HTMLButtonElement;

  private active = false;
  private hoveredQ = 0;
  private hoveredR = 0;
  private lastOrderId: string | null = null;
  private currentView: GhostSource = null;
  private cachedTiles: ClientTiles | null = null;
  private ghostState: HubGhostState;
  private readonly cleanups: Array<() => void> = [];

  constructor(
    parent: HTMLElement,
    private readonly sink: HubPlacementCommandSink = {},
  ) {
    ensureDom();
    this.el = makeDiv('ta-hub-menu plate', 'construction-menu');

    const menuParts = this.createMenuHeaderAndButtons();
    this.buildHubBtn = menuParts.buildHubBtn;
    this.orderStatusEl = menuParts.orderStatusEl;
    this.cancelOrderBtn = menuParts.cancelOrderBtn;

    const ghostParts = this.createGhostCard();
    this.ghostEl = ghostParts.ghostEl;
    this.reasonEl = ghostParts.reasonEl;
    this.gridEl = ghostParts.gridEl;
    this.billEl = ghostParts.billEl;
    this.billTilesEl = ghostParts.billTilesEl;
    this.billOpsEl = ghostParts.billOpsEl;
    this.billTimeEl = ghostParts.billTimeEl;
    this.billEnergyEl = ghostParts.billEnergyEl;
    this.billYieldsEl = ghostParts.billYieldsEl;
    this.confirmBtn = ghostParts.confirmBtn;
    this.cancelBtn = ghostParts.cancelBtn;

    this.el.append(menuParts.header, this.buildHubBtn, this.ghostEl, menuParts.orderRow);
    parent.appendChild(this.el);

    this.bindKeyboard();
    this.ghostState = this.evaluateCurrent(false);
    this.render();
  }

  private createMenuHeaderAndButtons() {
    const header = makeDiv('ta-hub-menu__header');
    const title = document.createElement('span');
    title.className = 'eyebrow';
    title.textContent = 'CONSTRUCTION';
    header.appendChild(title);

    const buildHubBtn = makeBtn('btn btn-sm btn-ghost ta-hub-menu__build-btn', 'build-command-hub', '', () =>
      this.startPlacement(),
    );
    setDataAttr(buildHubBtn, 'building', 'commandHub');
    setDataAttr(buildHubBtn, 'cost', HUB_COST_TEXT);

    const btnLabel = document.createElement('span');
    btnLabel.className = 'ta-hub-menu__build-title';
    btnLabel.textContent = 'Command Hub [H]';
    const btnCost = document.createElement('span');
    btnCost.className = 'ta-hub-menu__build-cost mono';
    setDataAttr(btnCost, 'testid', 'hub-build-cost');
    btnCost.textContent = HUB_COST_TEXT;
    buildHubBtn.replaceChildren(btnLabel, ' · ', btnCost);

    const orderRow = makeDiv('ta-hub-menu__order-row');
    const orderStatusEl = document.createElement('span');
    orderStatusEl.className = 'ta-hub-menu__order-status mono';
    setDataAttr(orderStatusEl, 'testid', 'hub-order-status');
    orderStatusEl.textContent = 'No active Hub order';

    const cancelOrderBtn = makeBtn('btn btn-sm btn-danger', 'hub-cancel-order', 'CANCEL ORDER', () =>
      this.cancelOrder(),
    );
    orderRow.append(orderStatusEl, cancelOrderBtn);

    return { header, buildHubBtn, orderRow, orderStatusEl, cancelOrderBtn };
  }

  private createGhostCard() {
    const ghostEl = makeDiv('ta-hub-ghost plate-sm ghost-valid', 'hub-placement-ghost');
    setDataAttr(ghostEl, 'tint', 'valid');
    setDataAttr(ghostEl, 'active', 'false');
    ghostEl.hidden = true;

    const reasonEl = makeDiv('ta-hub-ghost__reason mono', 'hub-ghost-reason');
    const gridEl = makeDiv('ta-hub-ghost__grid', 'hub-ghost-grid');
    const billEl = makeDiv('ta-hub-bill', 'hub-prep-bill');
    const billTilesEl = makeDiv('ta-hub-bill__row mono', 'hub-bill-tiles');
    const billOpsEl = makeDiv('ta-hub-bill__row mono', 'hub-bill-ops');
    const billTimeEl = makeDiv('ta-hub-bill__row mono', 'hub-bill-time');
    const billEnergyEl = makeDiv('ta-hub-bill__row mono', 'hub-bill-energy');
    const billYieldsEl = makeDiv('ta-hub-bill__row mono', 'hub-bill-yields');
    billEl.append(billTilesEl, billOpsEl, billTimeEl, billEnergyEl, billYieldsEl);

    const actionsRow = makeDiv('ta-hub-ghost__actions');
    const confirmBtn = makeBtn('btn btn-sm btn-primary', 'hub-confirm', 'CONFIRM', () =>
      this.confirmPlacement(),
    );
    const cancelBtn = makeBtn('btn btn-sm btn-ghost', 'hub-cancel', 'CANCEL [ESC]', () =>
      this.cancelPlacement(),
    );
    actionsRow.append(confirmBtn, cancelBtn);
    ghostEl.append(reasonEl, gridEl, billEl, actionsRow);

    return {
      ghostEl,
      reasonEl,
      gridEl,
      billEl,
      billTilesEl,
      billOpsEl,
      billTimeEl,
      billEnergyEl,
      billYieldsEl,
      confirmBtn,
      cancelBtn,
    };
  }

  private bindKeyboard(): void {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      const key = e.key ?? '';
      if (key === 'Escape' && this.active) this.cancelPlacement();
      else if (key.toLowerCase() === 'h') this.startPlacement();
    };
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('keydown', onKey);
      this.cleanups.push(() => window.removeEventListener('keydown', onKey));
    }
  }

  private resolveSource(): GhostSource {
    if (this.sink.state) return this.sink.state;
    if (this.sink.host?.state) return this.sink.host.state;
    if (this.currentView) return this.currentView;
    if (this.sink.store?.latest) return this.sink.store.latest;
    if (this.sink.host) return this.sink.host.view();
    return null;
  }

  private evaluateCurrent(active = this.active): HubGhostState {
    return evaluateHubGhost(this.resolveSource(), {
      colonyId: this.sink.colonyId ?? 0,
      q: this.hoveredQ,
      r: this.hoveredR,
      active,
      requireHq: this.sink.requireHq,
      fallbackTiles: this.cachedTiles ?? this.sink.store?.latestTiles ?? null,
    });
  }

  setView(view: GhostSource): void {
    if (view && typeof view === 'object' && 'tiles' in view && view.tiles) {
      this.cachedTiles = view.tiles as ClientTiles;
    }
    this.currentView = view;
    this.ghostState = this.evaluateCurrent(this.active);
    this.render();
  }

  startPlacement(q?: number, r?: number): HubGhostState {
    this.active = true;
    if (typeof q === 'number' && typeof r === 'number') {
      this.hoveredQ = Math.trunc(q);
      this.hoveredR = Math.trunc(r);
    }
    this.ghostState = this.evaluateCurrent(true);
    this.render();
    this.sink.onChange?.();
    return this.ghostState;
  }

  hoverTile(q: number, r: number): HubGhostState {
    this.hoveredQ = Math.trunc(q);
    this.hoveredR = Math.trunc(r);
    this.ghostState = this.evaluateCurrent(this.active);
    this.render();
    this.sink.onChange?.();
    return this.ghostState;
  }

  confirmPlacement(q?: number, r?: number): boolean {
    if (typeof q === 'number' && typeof r === 'number') {
      this.hoveredQ = Math.trunc(q);
      this.hoveredR = Math.trunc(r);
    }
    this.ghostState = this.evaluateCurrent(true);
    if (!this.ghostState.valid) {
      this.render();
      return false;
    }

    const targetQ = this.ghostState.q;
    const targetR = this.ghostState.r;
    const colonyId = this.sink.colonyId ?? 0;
    const commandId = `hub_order_${++orderSeq}`;
    const cmdArgs = { building: 'commandHub', q: targetQ, r: targetR };

    const pendingBefore = this.sink.host?.pending ?? 0;
    if (this.sink.sendCommand) void this.sink.sendCommand('placeBuilding', cmdArgs);
    if (this.sink.store?.sendCommand && this.sink.store.sendCommand !== this.sink.sendCommand) {
      this.sink.store.sendCommand(
        { type: 'placeBuilding', kind: 'placeBuilding', commandId, ...cmdArgs, args: cmdArgs },
        cmdArgs,
      );
    }

    const targetState = this.sink.state ?? this.sink.host?.state;
    const pendingAfter = this.sink.host?.pending ?? 0;
    if (targetState && pendingAfter === pendingBefore) {
      if (targetState.entities.count === 0 && this.sink.requireHq !== true) {
        spawnHqUnit(targetState, { owner: colonyId, q: 0, r: 0 });
      }
      const res = placeBuildingOrder(targetState, {
        colonyId,
        q: targetQ,
        r: targetR,
        buildingKind: 'commandHub',
        orderId: commandId,
      });
      if (res.order) this.lastOrderId = res.order.orderId;
    } else {
      this.lastOrderId = commandId;
    }

    this.active = false;
    this.ghostState = this.evaluateCurrent(false);
    this.render();
    this.sink.onChange?.();
    return true;
  }

  cancelPlacement(): void {
    this.active = false;
    this.ghostState = this.evaluateCurrent(false);
    this.render();
    this.sink.onChange?.();
  }

  cancelOrder(taskId?: string): void {
    const colonyId = this.sink.colonyId ?? 0;
    const orders = extractColonyConstructionOrders(this.resolveSource(), colonyId);
    const resolvedId = taskId ?? orders[0]?.orderId ?? this.lastOrderId ?? 'current';
    const cmdArgs = { taskId: resolvedId };

    const pendingBefore = this.sink.host?.pending ?? 0;
    if (this.sink.sendCommand) void this.sink.sendCommand('cancelTask', cmdArgs);
    if (this.sink.store?.sendCommand && this.sink.store.sendCommand !== this.sink.sendCommand) {
      this.sink.store.sendCommand(
        { type: 'cancelTask', kind: 'cancelTask', taskId: resolvedId, args: cmdArgs },
        cmdArgs,
      );
    }
    const targetState = this.sink.state ?? this.sink.host?.state;
    const pendingAfter = this.sink.host?.pending ?? 0;
    if (targetState && pendingAfter === pendingBefore) {
      cancelConstructionOrder(targetState, colonyId, taskId ?? orders[0]?.orderId ?? this.lastOrderId);
    }
    this.lastOrderId = null;
    this.ghostState = this.evaluateCurrent(this.active);
    this.render();
    this.sink.onChange?.();
  }

  isPlacementActive(): boolean {
    return this.active;
  }

  getGhostState(): HubGhostState {
    this.ghostState = this.evaluateCurrent(this.active);
    this.render();
    return this.ghostState;
  }

  bindSurface(surface: HTMLElement, pickTile?: TilePickerFn): () => void {
    const resolveCoord = (ev: unknown): { q: number; r: number } | null => {
      const e = ev as { clientX?: number; clientY?: number; target?: EventTarget | null; detail?: { q?: number; r?: number } };
      if (e.detail && typeof e.detail.q === 'number' && typeof e.detail.r === 'number') {
        return { q: e.detail.q, r: e.detail.r };
      }
      if (pickTile) {
        const picked = pickTile(e.clientX ?? 0, e.clientY ?? 0, e.target);
        if (picked) return picked;
      }
      const el = e.target as HTMLElement | null;
      const qAttr = el?.dataset?.q ?? el?.getAttribute?.('data-q');
      const rAttr = el?.dataset?.r ?? el?.getAttribute?.('data-r');
      if (qAttr !== undefined && qAttr !== null && rAttr !== undefined && rAttr !== null) {
        const q = Number(qAttr);
        const r = Number(rAttr);
        if (Number.isFinite(q) && Number.isFinite(r)) return { q, r };
      }
      return null;
    };

    const onMove = (ev: unknown) => {
      if (!this.active) return;
      const coord = resolveCoord(ev);
      if (coord) this.hoverTile(coord.q, coord.r);
    };

    const onUp = (ev: unknown) => {
      if (!this.active) return;
      const e = ev as { button?: number };
      if (e.button === 2) {
        this.cancelPlacement();
        return;
      }
      if (e.button !== undefined && e.button !== 0) return;
      const coord = resolveCoord(ev);
      if (coord) {
        this.hoverTile(coord.q, coord.r);
        this.confirmPlacement(coord.q, coord.r);
      }
    };

    const onContext = (ev: unknown) => {
      if (!this.active) return;
      (ev as { preventDefault?: () => void }).preventDefault?.();
      this.cancelPlacement();
    };

    surface.addEventListener('pointermove', onMove as EventListener);
    surface.addEventListener('pointerup', onUp as EventListener);
    surface.addEventListener('contextmenu', onContext as EventListener);
    const cleanup = () => {
      surface.removeEventListener('pointermove', onMove as EventListener);
      surface.removeEventListener('pointerup', onUp as EventListener);
      surface.removeEventListener('contextmenu', onContext as EventListener);
    };
    this.cleanups.push(cleanup);
    return cleanup;
  }

  render(): void {
    const g = this.ghostState;
    const { bill } = g;

    this.buildHubBtn.setAttribute('aria-pressed', String(this.active));
    this.buildHubBtn.className = this.active
      ? 'btn btn-sm btn-primary ta-hub-menu__build-btn'
      : 'btn btn-sm btn-ghost ta-hub-menu__build-btn';

    this.ghostEl.hidden = !this.active;
    setDataAttr(this.ghostEl, 'active', String(this.active));
    setDataAttr(this.ghostEl, 'tint', g.tint);
    setDataAttr(this.ghostEl, 'valid', String(g.valid));
    setDataAttr(this.ghostEl, 'q', String(g.q));
    setDataAttr(this.ghostEl, 'r', String(g.r));
    this.ghostEl.className = `ta-hub-ghost plate-sm ${g.valid ? 'ghost-valid' : 'ghost-invalid'}`;

    this.reasonEl.textContent = g.valid ? 'Valid site (3×3)' : (g.reasonText ?? 'site blocked');
    if (g.reasonCode) setDataAttr(this.reasonEl, 'reason-code', g.reasonCode);
    else this.reasonEl.removeAttribute?.('data-reason-code');

    this.renderFootprintGrid(g);

    setDataAttr(this.billTilesEl, 'tiles-to-prepare', String(bill.tilesToPrepare));
    setDataAttr(this.billTilesEl, 'total-tiles', String(bill.totalTiles));
    this.billTilesEl.textContent = `${bill.tilesToPrepare}/${bill.totalTiles} tiles to prepare`;
    this.billOpsEl.textContent = formatGhostOps(bill.ops);

    setDataAttr(this.billTimeEl, 'hq-seconds', String(bill.hqSeconds));
    setDataAttr(this.billTimeEl, 'base-seconds', String(bill.baseSeconds));
    this.billTimeEl.textContent = `${bill.hqSeconds.toFixed(1)}s (HQ 1.5×)`;

    setDataAttr(this.billEnergyEl, 'energy', String(bill.totalEnergyE));
    this.billEnergyEl.textContent = `${bill.totalEnergyE} E`;

    setDataAttr(this.billYieldsEl, 'metals', String(bill.yields['metals.t1']));
    setDataAttr(this.billYieldsEl, 'biomass', String(bill.yields['bio.biomass']));
    this.billYieldsEl.textContent = formatGhostYields(bill.yields);

    this.confirmBtn.disabled = !g.valid;

    const colonyId = this.sink.colonyId ?? 0;
    const orders: ConstructionOrder[] = extractColonyConstructionOrders(this.resolveSource(), colonyId);
    const activeOrder = orders[0];
    this.orderStatusEl.textContent = activeOrder
      ? `${activeOrder.building}: ${activeOrder.statusText || activeOrder.status}`
      : 'No active Hub order';
    this.cancelOrderBtn.disabled = !activeOrder && !this.lastOrderId;
  }

  private renderFootprintGrid(g: HubGhostState): void {
    this.gridEl.replaceChildren();
    for (const tile of g.footprintTiles) {
      const cell = makeDiv(
        `ta-hub-ghost__tile mono ${tile.valid ? 'is-valid' : 'is-invalid'}`,
        'hub-ghost-tile',
        `${tile.q},${tile.r}`,
      );
      setDataAttr(cell, 'q', String(tile.q));
      setDataAttr(cell, 'r', String(tile.r));
      setDataAttr(cell, 'valid', String(tile.valid));
      this.gridEl.appendChild(cell);
    }
  }

  dispose(): void {
    for (const fn of this.cleanups) fn();
    this.cleanups.length = 0;
    this.el.remove();
  }
}
