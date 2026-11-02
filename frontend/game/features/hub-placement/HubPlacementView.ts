import type { ConstructionOrder } from '@terra/sim';
import { makeBtn, makeDiv, makeSpan, setDataAttr } from '../shared/dom';
import type { HubGhostBill, HubGhostState } from './GhostEvaluator';

export function formatGhostYields(yields: HubGhostBill['yields']): string {
  const parts: string[] = [];
  if (yields['metals.t1'] > 0) parts.push(`+${yields['metals.t1']} Metals`);
  if (yields['bio.biomass'] > 0) parts.push(`+${yields['bio.biomass']} Biomass`);
  return parts.length > 0 ? parts.join(' · ') : '0 yields';
}

export function formatGhostOps(ops: HubGhostBill['ops']): string {
  return `Grade ${ops.grade} · Clear ${ops.clear} · Break ${ops.break}`;
}

/** Everything the construction card shows, computed by `HubPlacementMenu`. */
export interface HubPlacementModel {
  active: boolean;
  ghost: HubGhostState;
  /** `200 Metals · 100 Minerals · …` from the live `hub.t1.cost`. */
  costText: string;
  /** The HQ work rate from the live `hq.t1.workRate` (the bill's speed label). */
  hqWorkRate: number;
  /** The colony's open (not completed, not cancelled) construction order, if any. */
  order: ConstructionOrder | undefined;
}

export interface HubPlacementActions {
  startPlacement(): void;
  confirmPlacement(): void;
  cancelPlacement(): void;
  cancelOrder(): void;
}

/** The construction card's DOM: the Command Hub button, the ghost card with its prep bill and the order row. */
export class HubPlacementView {
  readonly el: HTMLElement;
  readonly ghostEl: HTMLElement;
  private readonly buildHubBtn: HTMLButtonElement;
  private readonly buildCostEl: HTMLElement;
  private readonly reasonEl: HTMLElement;
  private readonly gridEl: HTMLElement;
  private readonly billTilesEl: HTMLElement;
  private readonly billOpsEl: HTMLElement;
  private readonly billTimeEl: HTMLElement;
  private readonly billEnergyEl: HTMLElement;
  private readonly billYieldsEl: HTMLElement;
  private readonly confirmBtn: HTMLButtonElement;
  private readonly orderStatusEl: HTMLElement;
  private readonly cancelOrderBtn: HTMLButtonElement;
  private gridKey = '';

  constructor(parent: HTMLElement, actions: HubPlacementActions) {
    this.el = makeDiv('ta-hub-menu plate', 'construction-menu');
    const header = makeDiv('ta-hub-menu__header');
    header.appendChild(makeSpan('eyebrow', undefined, 'CONSTRUCTION'));

    this.buildHubBtn = makeBtn('btn btn-sm btn-ghost ta-hub-menu__build-btn', 'build-command-hub', '', () => actions.startPlacement());
    setDataAttr(this.buildHubBtn, 'building', 'commandHub');
    this.buildCostEl = makeSpan('ta-hub-menu__build-cost mono', 'hub-build-cost');
    this.buildHubBtn.replaceChildren(makeSpan('ta-hub-menu__build-title', undefined, 'Command Hub [H]'), ' · ', this.buildCostEl);

    this.ghostEl = makeDiv('ta-hub-ghost plate-sm ghost-valid', 'hub-placement-ghost');
    setDataAttr(this.ghostEl, 'active', 'false');
    this.ghostEl.hidden = true;
    this.reasonEl = makeDiv('ta-hub-ghost__reason mono', 'hub-ghost-reason');
    this.gridEl = makeDiv('ta-hub-ghost__grid', 'hub-ghost-grid');
    const billEl = makeDiv('ta-hub-bill', 'hub-prep-bill');
    this.billTilesEl = makeDiv('ta-hub-bill__row mono', 'hub-bill-tiles');
    this.billOpsEl = makeDiv('ta-hub-bill__row mono', 'hub-bill-ops');
    this.billTimeEl = makeDiv('ta-hub-bill__row mono', 'hub-bill-time');
    this.billEnergyEl = makeDiv('ta-hub-bill__row mono', 'hub-bill-energy');
    this.billYieldsEl = makeDiv('ta-hub-bill__row mono', 'hub-bill-yields');
    billEl.append(this.billTilesEl, this.billOpsEl, this.billTimeEl, this.billEnergyEl, this.billYieldsEl);
    const actionsRow = makeDiv('ta-hub-ghost__actions');
    this.confirmBtn = makeBtn('btn btn-sm btn-primary', 'hub-confirm', 'CONFIRM', () => actions.confirmPlacement());
    const cancelBtn = makeBtn('btn btn-sm btn-ghost', 'hub-cancel', 'CANCEL [ESC]', () => actions.cancelPlacement());
    actionsRow.append(this.confirmBtn, cancelBtn);
    this.ghostEl.append(this.reasonEl, this.gridEl, billEl, actionsRow);

    const orderRow = makeDiv('ta-hub-menu__order-row');
    this.orderStatusEl = makeSpan('ta-hub-menu__order-status mono', 'hub-order-status', 'No active Hub order');
    this.cancelOrderBtn = makeBtn('btn btn-sm btn-danger', 'hub-cancel-order', 'CANCEL ORDER', () => actions.cancelOrder());
    orderRow.append(this.orderStatusEl, this.cancelOrderBtn);

    this.el.append(header, this.buildHubBtn, this.ghostEl, orderRow);
    parent.appendChild(this.el);
  }

  render(m: HubPlacementModel): void {
    const g = m.ghost;
    this.buildHubBtn.setAttribute('aria-pressed', String(m.active));
    this.buildHubBtn.className = `btn btn-sm ${m.active ? 'btn-primary' : 'btn-ghost'} ta-hub-menu__build-btn`;
    setDataAttr(this.buildHubBtn, 'cost', m.costText);
    this.buildCostEl.textContent = m.costText;

    this.ghostEl.hidden = !m.active;
    setDataAttr(this.ghostEl, 'active', String(m.active));
    setDataAttr(this.ghostEl, 'tint', g.tint);
    setDataAttr(this.ghostEl, 'valid', String(g.valid));
    setDataAttr(this.ghostEl, 'q', String(g.q));
    setDataAttr(this.ghostEl, 'r', String(g.r));
    this.ghostEl.className = `ta-hub-ghost plate-sm ${g.valid ? 'ghost-valid' : 'ghost-invalid'}`;

    this.reasonEl.textContent = g.valid ? 'Valid site (3×3)' : (g.reasonText ?? 'site blocked');
    if (g.reasonCode) setDataAttr(this.reasonEl, 'reason-code', g.reasonCode);
    else this.reasonEl.removeAttribute('data-reason-code');
    if (m.active) this.renderFootprintGrid(g);
    this.renderBill(g.bill, m.hqWorkRate);
    this.confirmBtn.disabled = !g.valid;

    this.orderStatusEl.textContent = m.order ? `${m.order.building}: ${m.order.statusText || m.order.status}` : 'No active Hub order';
    this.cancelOrderBtn.disabled = !m.order;
  }

  private renderBill(bill: HubGhostBill, hqWorkRate: number): void {
    setDataAttr(this.billTilesEl, 'tiles-to-prepare', String(bill.tilesToPrepare));
    setDataAttr(this.billTilesEl, 'total-tiles', String(bill.totalTiles));
    this.billTilesEl.textContent = `${bill.tilesToPrepare}/${bill.totalTiles} tiles to prepare`;
    this.billOpsEl.textContent = formatGhostOps(bill.ops);
    setDataAttr(this.billTimeEl, 'hq-seconds', String(bill.hqSeconds));
    setDataAttr(this.billTimeEl, 'base-seconds', String(bill.baseSeconds));
    this.billTimeEl.textContent = `${bill.hqSeconds.toFixed(1)}s (HQ ${hqWorkRate}×)`;
    setDataAttr(this.billEnergyEl, 'energy', String(bill.totalEnergyE));
    this.billEnergyEl.textContent = `${bill.totalEnergyE} E`;
    setDataAttr(this.billYieldsEl, 'metals', String(bill.yields['metals.t1']));
    setDataAttr(this.billYieldsEl, 'biomass', String(bill.yields['bio.biomass']));
    this.billYieldsEl.textContent = formatGhostYields(bill.yields);
  }

  /** Rebuilds the 9 footprint cells only when the site or a cell's validity changed. */
  private renderFootprintGrid(g: HubGhostState): void {
    const key = g.footprintTiles.map((t) => `${t.q},${t.r},${t.valid ? 1 : 0}`).join(';');
    if (key === this.gridKey) return;
    this.gridKey = key;
    this.gridEl.replaceChildren();
    for (const tile of g.footprintTiles) {
      const cell = makeDiv(`ta-hub-ghost__tile mono ${tile.valid ? 'is-valid' : 'is-invalid'}`, 'hub-ghost-tile', `${tile.q},${tile.r}`);
      setDataAttr(cell, 'q', String(tile.q));
      setDataAttr(cell, 'r', String(tile.r));
      setDataAttr(cell, 'valid', String(tile.valid));
      this.gridEl.appendChild(cell);
    }
  }

  dispose(): void {
    this.el.remove();
  }
}
