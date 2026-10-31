export type HudIconKind = 'metals' | 'minerals' | 'bio' | 'supply' | 'cell' | 'clock';

const SVG_NS = 'http://www.w3.org/2000/svg';

function appendIconShapes(svg: SVGElement, kind: HudIconKind): void {
  const add = (tag: string, attrs: Record<string, string>) => {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.appendChild(el);
  };
  if (kind === 'metals') {
    add('polygon', {
      points: '2.5,11.5 5,4.5 12.5,4.5 14,11.5',
      fill: 'currentColor',
      'fill-opacity': '0.28',
      stroke: 'currentColor',
      'stroke-width': '1.5',
      'stroke-linejoin': 'round',
    });
    add('path', { d: 'M5 4.5L8 8.8M14 11.5L8 8.8L2.5 11.5', stroke: 'currentColor', 'stroke-width': '1.2' });
  } else if (kind === 'minerals') {
    add('polygon', {
      points: '8,1.5 13,6.5 10.5,14.5 5.5,14.5 3,6.5',
      fill: 'currentColor',
      'fill-opacity': '0.28',
      stroke: 'currentColor',
      'stroke-width': '1.5',
      'stroke-linejoin': 'round',
    });
    add('path', { d: 'M8 1.5V14.5M3 6.5L8 8.5L13 6.5', stroke: 'currentColor', 'stroke-width': '1.2' });
  } else if (kind === 'bio') {
    add('path', {
      d: 'M13.5 2.5C8 2.5 3.5 6 3.5 11.5C3.5 13 4.5 14 6 14C11.5 14 13.5 9 13.5 2.5Z',
      fill: 'currentColor',
      'fill-opacity': '0.28',
      stroke: 'currentColor',
      'stroke-width': '1.5',
      'stroke-linejoin': 'round',
    });
    add('path', { d: 'M3.5 13.5C6.5 10.5 9.5 7.5 12 4.5', stroke: 'currentColor', 'stroke-width': '1.3', 'stroke-linecap': 'round' });
  } else if (kind === 'supply') {
    add('polygon', {
      points: '8,2 13.5,5.2 13.5,10.8 8,14 2.5,10.8 2.5,5.2',
      fill: 'currentColor',
      'fill-opacity': '0.22',
      stroke: 'currentColor',
      'stroke-width': '1.5',
      'stroke-linejoin': 'round',
    });
    add('circle', { cx: '8', cy: '8', r: '2', fill: 'currentColor' });
  } else if (kind === 'cell') {
    add('polygon', {
      points: '9.2,1.5 3.5,9 8,9 6.8,14.5 12.5,7 8,7',
      fill: 'currentColor',
      stroke: 'currentColor',
      'stroke-width': '1.1',
      'stroke-linejoin': 'round',
    });
  } else {
    add('circle', { cx: '8', cy: '8', r: '6', stroke: 'currentColor', 'stroke-width': '1.5' });
    add('path', { d: 'M8 4.5V8L10.5 9.8', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round' });
  }
}

export function createHudIcon(kind: HudIconKind): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = `ta-hud-min__icon ta-hud-min__icon--${kind}`;
  wrap.setAttribute('aria-hidden', 'true');
  if (typeof document !== 'undefined' && typeof document.createElementNS === 'function') {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '13');
    svg.setAttribute('height', '13');
    svg.setAttribute('fill', 'none');
    appendIconShapes(svg, kind);
    wrap.appendChild(svg as unknown as HTMLElement);
  }
  return wrap;
}
