import { PERFORMANCE_WINDOWS, type PerformanceWindow, type StakingPerformanceResponse } from '@terra/contracts';
import { el } from '../../../../dom';
import { buildBlockHeaderWithTip } from '../../../../parts/helpTip';
import { formatNear } from '../../stakingMath';
import { buildChartPaths, type ChartGeometry } from '../dashboardMath';

const GEO: ChartGeometry = { width: 640, height: 220, padX: 14, padY: 18 };
const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(tag: string, attrs: Record<string, string>, text?: string): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Pure-SVG hybrid chart: solid line = realized, dashed = projected. Accessible `<title>` / `<desc>`. */
export function renderChartSvg(series: StakingPerformanceResponse['series']): SVGElement {
  const paths = buildChartPaths(series.points, GEO);
  const root = svg('svg', { viewBox: `0 0 ${GEO.width} ${GEO.height}`, class: 'ta-stk-chart-svg', role: 'img', 'aria-labelledby': 'staking-chart-title staking-chart-desc', 'data-testid': 'staking-chart-svg', 'data-window': series.window, 'data-empty': paths.empty ? '1' : '0' });
  const last = series.points[series.points.length - 1];
  root.append(
    svg('title', { id: 'staking-chart-title' }, `Staking value over ${series.window}`),
    svg('desc', { id: 'staking-chart-desc' }, paths.empty
      ? 'No history yet.'
      : `Cumulative earned value in NEAR: solid line is realized, dashed line is projected. Latest ${formatNear(last?.valueNear ?? 0)}.`),
  );
  for (const f of [0.25, 0.5, 0.75]) {
    const y = GEO.padY + (GEO.height - GEO.padY * 2) * f;
    root.append(svg('line', { x1: String(GEO.padX), x2: String(GEO.width - GEO.padX), y1: String(y), y2: String(y), class: 'ta-stk-chart-grid' }));
  }
  if (paths.empty) {
    root.append(svg('text', { x: String(GEO.width / 2), y: String(GEO.height / 2), class: 'ta-stk-chart-empty', 'text-anchor': 'middle' }, 'No history yet'));
    return root;
  }
  if (paths.realizedD) root.append(svg('path', { d: paths.realizedD, class: 'ta-stk-chart-realized', 'data-testid': 'staking-chart-realized', fill: 'none' }));
  if (paths.projectedD) root.append(svg('path', { d: paths.projectedD, class: 'ta-stk-chart-projected', 'data-testid': 'staking-chart-projected', fill: 'none', 'stroke-dasharray': '6 5' }));
  if (paths.nowMarker) root.append(svg('rect', { x: String(paths.nowMarker.x - 4), y: String(paths.nowMarker.y - 4), width: '8', height: '8', class: 'ta-stk-chart-now' }));
  return root;
}

export interface ChartPart {
  readonly el: HTMLElement;
  update(series: StakingPerformanceResponse['series']): void;
}

/** Chart block with the `30d / 90d / 1y` toggle; `onWindow` refetches the performance with `window=`. */
export function renderChart(initial: StakingPerformanceResponse['series'], onWindow: (w: PerformanceWindow) => void): ChartPart {
  const host = el('div', { className: 'ta-stk-chart-host' });
  const buttons = new Map<PerformanceWindow, HTMLButtonElement>();
  const toggle = el('div', { className: 'ta-stk-toggle', role: 'group', aria: { label: 'Chart window' } });
  for (const w of PERFORMANCE_WINDOWS) {
    const b = el('button', { className: 'btn btn-ghost btn-sm', type: 'button', dataset: { testid: `staking-chart-window-${w}` }, onClick: () => onWindow(w) }, w.toUpperCase());
    buttons.set(w, b);
    toggle.append(b);
  }
  const update = (series: StakingPerformanceResponse['series']): void => {
    host.replaceChildren(renderChartSvg(series));
    for (const [w, b] of buttons) {
      const active = w === series.window;
      b.setAttribute('aria-pressed', String(active));
      b.classList.toggle('btn-primary', active);
      b.classList.toggle('btn-ghost', !active);
    }
  };
  update(initial);
  const header = buildBlockHeaderWithTip(
    {
      id: 'staking-chart',
      title: 'EARNINGS CHART',
      description:
        'Visualizes cumulative NEAR value earned over 30d, 90d, or 1y. Solid orange traces realized compounds, market-fee savings, royalties, and patron share; dashed blue projects forward at your current rate.',
    },
    el('h3', { className: 'label ta-stk-h' }, 'EARNINGS · REALIZED vs PROJECTED'),
    toggle,
  );
  const root = el(
    'div',
    { className: 'ta-stk-block plate-sm ta-stk-pad', dataset: { testid: 'staking-chart' } },
    header.head,
    header.panel,
    host,
    el('span', { className: 'ta-stk-sub' }, 'Solid = realized · dashed = projected · self-fills excluded'),
  );
  return { el: root, update };
}
