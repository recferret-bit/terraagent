import type { PriceBoardRow } from '@terra/contracts';
import { resourceDisplayName } from '@terra/contracts';
import { badgeOf, baseOf, changeText, CLASS_LABELS, priceText, quoteOf, sparkPoints, type BoardState, type SparkPoint } from './boardModel';
import type { BoardController } from './BoardController';

const SVG_NS = 'http://www.w3.org/2000/svg';
const W = 96;
const H = 28;

/** Inline SVG sparkline: one circle per point and a polyline; the last point is highlighted. Colours are design tokens (CSS). */
export function sparkline(points: readonly SparkPoint[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'ta-board-spark');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${points.length} trade${points.length === 1 ? '' : 's'}`);
  svg.dataset.points = String(points.length);
  if (points.length === 0) return svg;
  const prices = points.map((p) => p.price);
  const lo = Math.min(...prices);
  const span = Math.max(...prices) - lo || 1;
  const xy = points.map((p, i): [number, number] => [points.length === 1 ? W / 2 : 3 + (i * (W - 6)) / (points.length - 1), H - 3 - ((p.price - lo) / span) * (H - 6)]);
  if (points.length > 1) {
    const line = document.createElementNS(SVG_NS, 'polyline');
    line.setAttribute('class', 'ta-board-spark-line');
    line.setAttribute('points', xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '));
    svg.append(line);
  }
  xy.forEach(([x, y], i) => {
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('class', i === xy.length - 1 ? 'ta-board-spark-dot ta-board-spark-last' : 'ta-board-spark-dot');
    c.setAttribute('cx', x.toFixed(1));
    c.setAttribute('cy', y.toFixed(1));
    c.setAttribute('r', '2');
    svg.append(c);
  });
  return svg;
}

const cell = (cls: string, text: string): HTMLElement => {
  const d = document.createElement('div');
  d.className = cls;
  d.textContent = text;
  return d;
};

/** The price board: one row per pair (last price, 24 h change, volume, sparkline, classification). textContent only. */
export class BoardPanel {
  private readonly body: HTMLElement;
  private readonly notice: HTMLElement;
  private readonly off: () => void;

  constructor(private readonly root: HTMLElement, private readonly controller: BoardController) {
    root.className = 'plate-sm ta-board';
    root.dataset.testid = 'price-board';
    root.hidden = true;
    const head = document.createElement('div');
    head.className = 'ta-board-head';
    head.append(cell('label c-blue', 'PRICE BOARD'));
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'ta-toast-close';
    close.setAttribute('aria-label', 'Close price board');
    close.textContent = '×';
    close.onclick = () => this.setOpen(false);
    head.append(close);
    this.notice = cell('ta-board-notice', '');
    this.body = document.createElement('div');
    this.body.className = 'ta-board-rows';
    root.append(head, this.notice, this.body);
    this.off = controller.onChange((s, err) => this.render(s, err));
    this.render(controller.current, null);
  }

  get isOpen(): boolean { return !this.root.hidden; }

  setOpen(open: boolean): void {
    this.root.hidden = !open;
    if (open) void this.controller.refresh();
  }

  render(state: BoardState, error: string | null): void {
    this.notice.textContent = error ?? (state.rows.length === 0 ? 'No priced pairs yet. A first trade starts the board.' : '');
    this.body.replaceChildren(...state.rows.map((r) => this.row(r, state)));
  }

  private row(r: PriceBoardRow, state: BoardState): HTMLElement {
    const quote = quoteOf(r.pair);
    const el = document.createElement('div');
    el.className = `ta-board-row ta-board-row--${r.classification}`;
    el.dataset.testid = 'board-row';
    el.dataset.pair = r.pair;
    const price = cell('ta-board-price', `${priceText(r.last, quote)} ${quote}`);
    price.dataset.testid = 'board-last';
    const change = cell('ta-board-change', changeText(r.change24hBp));
    const tag = cell('label ta-board-class', CLASS_LABELS[r.classification]);
    tag.dataset.testid = 'board-class';
    el.append(
      cell('ta-board-pair', `${resourceDisplayName(baseOf(r.pair))} / ${quote}`),
      price,
      change,
      cell('ta-board-vol', `vol ${r.volume24h}`),
      sparkline(sparkPoints(r, state.trades)),
      tag,
      cell('label ta-board-mock', badgeOf(r.pair)),
    );
    if (r.classification === 'insufficient_data' || r.reason) el.append(cell('ta-board-reason', r.reason ?? 'Not enough eligible history for a reference price.'));
    return el;
  }

  dispose(): void {
    this.off();
    this.root.replaceChildren();
  }
}
