import type { MarketSnapshotResponse, ResourceKey } from '@terra/contracts';
import type { BuyLine, SellLine, SupplyTradeView } from '@terra/sim';
import { makeBtn, makeDiv } from '../../shared/dom';
import { resourceLabel } from '../tab/pairs';
import { buyText, logisticsLines, remedyRows, sellText } from './supplyModel';

export interface SupplyActions {
  /** Prefills the market order form; never submits. */
  buy(resource: ResourceKey, qty: number): void;
  sell(resource: ResourceKey, qty: number): void;
  /** Market snapshot for the remedy quote (null when unavailable). */
  snapshot(): Promise<MarketSnapshotResponse | null>;
  /** Launchers of the other W13 market panels (price board, contracts list, trade hub); absent → no button. */
  openBoard?(): void;
  openContracts?(): void;
  openTradeHub?(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const section = (title: string, testid: string, ...body: HTMLElement[]): HTMLElement => {
  const s = makeDiv('ta-supply__section', testid);
  s.append(el('div', 'ta-supply__title', title), ...body);
  return s;
};

/**
 * "Supply & trade" (W13-55): why to buy or sell (regional badges, the shopping basket naming the job that needs each unit,
 * the surplus), the logistics bill (load, congestion, distance, reserve, bottleneck, remedies) and the four remedies
 * side by side. Everything is read from the colony's `supplyTrade` view (sim data); the buttons only prefill the market tab.
 */
export class SupplyPanel {
  readonly el = makeDiv('ta-supply plate', 'supply-panel');
  private readonly body = makeDiv('ta-supply__body', 'supply-body');
  private view: SupplyTradeView | null = null;
  private open = false;
  private compare: BuyLine | null = null;
  private remedies: HTMLElement | null = null;
  private lastKey = '';

  constructor(private readonly actions: SupplyActions) {
    const head = makeDiv('ta-supply__head');
    head.append(el('span', 'ta-supply__heading', 'COLONY SUPPLY & LOGISTICS'), makeBtn('ta-supply__toggle ta-supply__showhide btn-sm plate-sm', 'supply-toggle', 'SHOW', () => this.setOpen(!this.open)));
    if (actions.openTradeHub) head.append(makeBtn('ta-supply__toggle ta-supply__trade-btn btn-sm plate-sm', 'supply-open-trade', 'TRADE HUB →', () => actions.openTradeHub?.()));
    // Legacy standalone launchers (hidden inside the Colony book where the TRADE dialog owns market board & contracts).
    if (actions.openBoard) head.append(makeBtn('ta-supply__toggle btn-sm plate-sm', 'market-open-board', 'BOARD', () => actions.openBoard?.()));
    if (actions.openContracts) head.append(makeBtn('ta-supply__toggle btn-sm plate-sm', 'market-open-contracts', 'CONTRACTS', () => actions.openContracts?.()));
    this.el.append(head, this.body);
    this.setOpen(false);
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.el.dataset.open = String(open);
    this.body.hidden = !open;
    (this.el.querySelector('[data-testid=supply-toggle]') as HTMLElement).textContent = open ? 'HIDE' : 'SHOW';
    if (open) this.render();
  }

  isOpen(): boolean {
    return this.open;
  }

  update(v: SupplyTradeView | undefined): void {
    this.view = v ?? null;
    this.el.hidden = !v;
    if (!this.open) return;
    const key = JSON.stringify(v);
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.render();
  }

  private render(): void {
    const v = this.view;
    this.body.replaceChildren();
    if (!v) return;
    this.body.append(this.badges(v), this.basket(v), this.logistics(v));
    this.remedies = section('Options for the selected need', 'supply-remedies');
    this.body.append(this.remedies);
    if (this.compare) void this.showRemedies(this.compare);
  }

  private badges(v: SupplyTradeView): HTMLElement {
    const chips = v.badges.filter((b) => b.level !== 'normal').map((b) => {
      const c = el('span', `ta-supply__chip ta-supply__chip--${b.level} plate-sm`, `${resourceLabel(b.resource)} ${b.level.toUpperCase()}`);
      c.dataset.testid = `supply-badge-${b.resource}`;
      return c;
    });
    const s = section('Regional abundance', 'supply-badges', ...(chips.length ? chips : [el('div', 'ta-supply__empty', 'No region data for this planet.')]));
    s.classList.add('ta-supply__section--chips');
    return s;
  }

  private basket(v: SupplyTradeView): HTMLElement {
    const rows: HTMLElement[] = [];
    for (const l of v.basket.buy) rows.push(this.row(buyText(l), 'BUY', 'supply-buy', () => this.actions.buy(l.resource, l.qty), () => { this.compare = l; void this.showRemedies(l); }));
    for (const l of v.basket.sell) rows.push(this.row(sellText(l), 'SELL', 'supply-sell', () => this.actions.sell(l.resource, l.qty)));
    return section('Shopping basket and surplus', 'supply-basket', ...(rows.length ? rows : [el('div', 'ta-supply__empty', 'Nothing to buy; nothing spare to sell.')]));
  }

  private row(text: string, label: string, testid: string, act: () => void, compare?: () => void): HTMLElement {
    const r = makeDiv('ta-supply__row', testid);
    r.append(el('span', 'ta-supply__text', text));
    if (compare) r.append(makeBtn('ta-supply__btn btn-sm plate-sm', `${testid}-compare`, 'COMPARE', compare));
    r.append(makeBtn('ta-supply__btn ta-supply__btn--act btn-sm plate-sm', `${testid}-act`, label, act));
    return r;
  }

  private logistics(v: SupplyTradeView): HTMLElement {
    const l = logisticsLines(v);
    if (!l) return section('Logistics', 'supply-logistics', el('div', 'ta-supply__empty', 'No supply window yet.'));
    const lines = [l.load, l.congestion, l.distance, l.reserve, l.bottleneck, `Next window bill: ${l.bill.length ? l.bill.join(', ') : 'none'}`].map((t) => el('div', 'ta-supply__line', t));
    return section('Logistics', 'supply-logistics', ...lines, ...l.remedies.map((t) => { const e = el('div', 'ta-supply__remedy', t); e.dataset.testid = 'supply-remedy'; return e; }));
  }

  private async showRemedies(line: BuyLine | SellLine): Promise<void> {
    if (!this.remedies || !this.view || !('reason' in line) || line.reason === 'surplus') return;
    const snap = await this.actions.snapshot().catch(() => null);
    if (!this.remedies || !this.view) return;
    const head = el('div', 'ta-supply__line', buyText(line as BuyLine));
    const rows = remedyRows(this.view, line as BuyLine, snap).map((r) => {
      const d = makeDiv(`ta-supply__option ta-supply__option--${r.kind}`, `supply-option-${r.kind}`);
      d.append(el('span', 'ta-supply__k', r.title), el('span', 'ta-supply__v', r.detail));
      return d;
    });
    this.remedies.replaceChildren(el('div', 'ta-supply__title', 'Options for the selected need'), head, ...rows);
  }
}
