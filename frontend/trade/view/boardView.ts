import { formatAtomic, formatUnitPrice, parsePairId, type MarketTokenKey, type PriceBoardRow } from '@terra/contracts';
import { buildChart } from '../model/chart';
import type { TradeState } from '../model/state';
import { changeLabel, fmtUnit } from '../model/units';
import { badge, gate, h, note, svgEl, fill } from './dom';

const CLASS_BADGE: Record<string, string> = { organic: 'ok', mixed: 'warn', fixture: 'fixture', insufficient_data: 'dim' };

function stat(label: string, value: string, sub?: string): HTMLElement {
  return h('div', { class: 'tr-stat' }, h('span', { class: 'label' }, label), h('strong', { class: 'num' }, value), sub ? h('span', { class: 'tr-hint' }, sub) : null);
}

/** Inline-SVG candlestick chart with a volume band; `quote` only labels the axis (candle prices are quote atomic per unit). */
export function candleChart(row: PriceBoardRow, quote: MarketTokenKey): SVGElement | HTMLElement {
  const g = buildChart(row.candles1h);
  if (!g) return note('No candles yet: this pair has no 1 h trades.');
  const kids: SVGElement[] = [];
  for (const c of g.candles) {
    const col = c.up ? 'var(--ta-terra)' : 'var(--ta-fault)';
    kids.push(svgEl('line', { x1: c.x, x2: c.x, y1: c.yHigh, y2: c.yLow, stroke: col, 'stroke-width': 1.5 }));
    kids.push(svgEl('rect', { x: c.x - c.w / 2, y: Math.min(c.yOpen, c.yClose), width: c.w, height: Math.max(1.5, Math.abs(c.yClose - c.yOpen)), fill: col }));
    kids.push(svgEl('rect', { x: c.x - c.w / 2, y: g.height - c.volH, width: c.w, height: c.volH, fill: 'var(--ta-blue)', opacity: 0.55 }));
  }
  const lo = formatUnitPrice(String(Math.round(g.lo)), 1, quote);
  const hi = formatUnitPrice(String(Math.round(g.hi)), 1, quote);
  const svg = svgEl('svg', { viewBox: `0 0 ${g.width} ${g.height}`, class: 'tr-chart', role: 'img', preserveAspectRatio: 'none', 'aria-label': `1 hour candles, ${g.candles.length} bars, low ${lo} high ${hi} ${quote} per unit, volume in blue` }, ...kids);
  return h('figure', { class: 'tr-fig' }, svg, h('figcaption', { class: 'tr-hint' }, `1 h candles, low ${lo} / high ${hi} ${quote} per unit; blue = volume`));
}

export function renderBoard(body: HTMLElement, s: TradeState): void {
  if (!gate(body, s.panels.board, null)) return;
  const row = s.board.find((r) => r.pair === s.pair);
  const parsed = parsePairId(s.pair);
  if (!row || !parsed) { body.replaceChildren(note('This pair is not on the price board yet (no trades).')); return; }
  const q = parsed.quote;
  const vwapText = row.vwap ? `${fmtUnit(row.vwap, q)} ${q}` : 'n/a';
  const vwapSub = row.vwap ? undefined : `insufficient_data${row.reason ? `: ${row.reason}` : ''}`;
  const change = row.change24hBp;
  const stats = h('div', { class: 'tr-stats' },
    stat('LAST', row.last ? `${fmtUnit(row.last, q)} ${q}` : 'no trades'),
    stat('24H CHANGE', changeLabel(change), change === null ? 'needs a trade 24 h ago' : undefined),
    stat('VWAP', vwapText, vwapSub),
    stat('24H VOLUME', `${row.volume24h} ${parsed.base}`),
    stat('COUNTERPARTIES', row.counterparties === undefined ? 'n/a' : String(row.counterparties), row.concentrationBp === undefined ? undefined : `top share ${(row.concentrationBp / 100).toFixed(1)} %`),
    stat('ELIGIBLE VOLUME', row.eligibleVolume === undefined ? 'n/a' : String(row.eligibleVolume)));
  fill(body,
    h('div', { class: 'tr-badges' }, badge(row.classification.replace('_', ' ').toUpperCase(), CLASS_BADGE[row.classification] ?? 'dim'),
      h('span', { class: 'tr-hint' }, 'Bot share: not reported by the board (only organic / mixed / fixture classification).')),
    stats, candleChart(row, q),
    row.last ? h('p', { class: 'tr-hint' }, `Prices are mock ${q} per unit; the smallest unit is ${formatAtomic(q, '1')}.`) : null);
}
