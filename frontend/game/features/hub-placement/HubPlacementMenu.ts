import type { CompiledDataLike, ConstructionOrder, PlanetState, SimCommand } from '@terra/sim';
import type { GameView } from '../../core/registry/types';
import type { ClientTiles } from '../../store/replica/viewCodec';
import { ensureDom, makeBtn, makeDiv, setDataAttr } from './dom';
import {
  evaluateHubGhost,
  extractColonyConstructionOrders,
  findValidHubSiteNearHq,
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
    simData?(): CompiledDataLike | null; // the host's live balance data (WorldStore), so the ghost uses the same numbers
  };
  host?: {
    readonly state: PlanetState;
    readonly pending: number;
    view(): GameView;
    /** Authoritative in-process host (tests / tools): commands go through the same sim handler as on the server. */
    submit?(cmd: SimCommand): void;
  };
  /** Called when the authoritative host rejects a placement the ghost accepted (stale view, race with another player). */
  onReject?: (code: string, detail?: string) => void;
  state?: PlanetState;
  colonyId?: number;
  getColonyId?: () => number | undefined;
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

interface CommandOutcome {
  ok: boolean;
  code?: string;
  detail?: string;
}

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
  private serverReject: { q: number; r: number; code: string; text: string } | null = null;
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
      else if (key.toLowerCase() === 'h' && !this.el.hidden) this.startPlacement();
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

  private resolveColonyId(): number {
    return this.sink.getColonyId?.() ?? this.sink.colonyId ?? 0;
  }

  private evaluateCurrent(active = this.active): HubGhostState {
    const g = evaluateHubGhost(this.resolveSource(), {
      colonyId: this.resolveColonyId(),
      q: this.hoveredQ,
      r: this.hoveredR,
      active, requireHq: this.sink.requireHq, data: this.sink.store?.simData?.() ?? undefined,
      fallbackTiles: this.cachedTiles ?? this.sink.store?.latestTiles ?? null,
    });
    const rej = this.serverReject;
    if (!g.valid || !rej || rej.q !== g.q || rej.r !== g.r) return g;
    return { ...g, valid: false, tint: 'invalid', reasonCode: rej.code, reasonText: rej.text };
  }

  setView(view: GhostSource): void {
    if (view && typeof view === 'object' && 'tiles' in view && view.tiles) {
      this.cachedTiles = view.tiles as ClientTiles;
    }
    this.currentView = view;
    if (this.active) {
      this.ghostState = this.evaluateCurrent(true);
    }
    this.render();
  }

  startPlacement(q?: number, r?: number): HubGhostState {
    this.active = true;
    if (typeof q === 'number' && typeof r === 'number') {
      this.hoveredQ = Math.trunc(q);
      this.hoveredR = Math.trunc(r);
    } else {
      const fallback = this.cachedTiles ?? this.sink.store?.latestTiles ?? null;
      const near = findValidHubSiteNearHq(this.resolveSource(), this.resolveColonyId(), fallback, this.sink.store?.simData?.() ?? undefined);
      if (near) {
        this.hoveredQ = near.q;
        this.hoveredR = near.r;
      }
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

    const { q: siteQ, r: siteR } = this.ghostState;
    const pending = this.dispatch('placeBuilding', { building: 'commandHub', q: siteQ, r: siteR });
    this.lastOrderId = pending.commandId;
    void pending.result.then((res) => {
      // No verdict on timeout / disconnect (the order may have landed): don't paint a red ghost over it.
      if (res && res.ok === false && res.code !== 'timeout' && res.code !== 'not_connected') this.onServerReject(siteQ, siteR, res.code ?? 'site_blocked', res.detail);
    });

    this.active = false;
    this.serverReject = null;
    this.ghostState = this.evaluateCurrent(false);
    this.render();
    this.sink.onChange?.();
    return true;
  }

  /**
   * Sends one command through exactly one channel (the client never mutates world state itself): the session command
   * bus (server or browser-local Worker host, both run the shared sim handler), else the store, else an in-process host.
   */
  private dispatch(kind: string, args: Record<string, unknown>): { commandId: string; result: Promise<CommandOutcome | undefined> } {
    const commandId = `${kind}_${++orderSeq}`;
    let out: unknown;
    if (this.sink.sendCommand) out = this.sink.sendCommand(kind, args);
    else if (this.sink.store?.sendCommand) out = this.sink.store.sendCommand({ kind, commandId, args }, args);
    else if (this.sink.host?.submit) {
      this.sink.host.submit({ colonyIndex: this.resolveColonyId(), source: 'player', commandId, kind, args });
    }
    const result = out && typeof (out as Promise<unknown>).then === 'function' ? (out as Promise<CommandOutcome>) : Promise.resolve(undefined);
    return { commandId, result: result.catch(() => undefined) };
  }

  /** The host disagreed with the ghost (its view was newer): reopen the ghost on that site with the host's reason. */
  private onServerReject(q: number, r: number, code: string, detail?: string): void {
    this.serverReject = { q, r, code, text: detail ?? code.replace(/_/g, ' ') };
    this.active = true;
    this.hoveredQ = q;
    this.hoveredR = r;
    this.ghostState = this.evaluateCurrent(true);
    this.render();
    this.sink.onReject?.(code, detail);
    this.sink.onChange?.();
  }

  cancelPlacement(): void {
    this.active = false;
    this.serverReject = null;
    this.ghostState = this.evaluateCurrent(false);
    this.render();
    this.sink.onChange?.();
  }

  cancelOrder(taskId?: string): void {
    const colonyId = this.resolveColonyId();
    const orders = extractColonyConstructionOrders(this.resolveSource(), colonyId);
    const resolvedId = taskId ?? orders[0]?.orderId ?? 'current'; // host order ids ≠ local command ids
    this.dispatch('cancelTask', { taskId: resolvedId });
    this.lastOrderId = null;
    this.ghostState = this.evaluateCurrent(this.active);
    this.render();
    this.sink.onChange?.();
  }

  isPlacementActive(): boolean { return this.active; }

  /** Cached ghost state (no re-evaluation or DOM work): safe per frame. */
  peekGhostState(): HubGhostState { return this.ghostState; }

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

    if (this.active || this.gridEl.childElementCount === 0) {
      this.renderFootprintGrid(g);
    }

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

    const colonyId = this.resolveColonyId();
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
