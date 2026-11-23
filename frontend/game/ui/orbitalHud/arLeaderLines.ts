import type { OrbitalProjectedFrame, ProjectedAnchor2D } from '@terra/render/orbit/types';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface ArLeaderCardRefs {
  readonly scanCard: HTMLElement;
  readonly presenceCard: HTMLElement;
  readonly launchCard: HTMLElement;
}

export interface ArLeaderContext {
  readonly selectedSectorLabel: string;
  readonly homeBaseLabel?: string;
}

interface Pt {
  readonly x: number;
  readonly y: number;
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function hexPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    pts.push(`${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`);
  }
  return pts.join(' ');
}

function findAnchor(
  frame: OrbitalProjectedFrame | null,
  predicate: (a: ProjectedAnchor2D) => boolean,
  fallbackNx: number,
  fallbackNy: number,
): { readonly nx: number; readonly ny: number; readonly id: string } {
  const found = frame?.anchors.find((a) => a.visible && predicate(a));
  if (found) return { nx: found.nx, ny: found.ny, id: found.id };
  const gNx = frame?.globeNx ?? 0.62;
  const gNy = frame?.globeNy ?? 0.5;
  return { nx: gNx + (fallbackNx - 0.62), ny: gNy + (fallbackNy - 0.5), id: 'orbit' };
}

function appendHexConnector(
  svg: SVGSVGElement,
  from: Pt,
  elbow: Pt,
  to: Pt,
  cls: string,
  labelText?: string,
  options: { tagOffsetY?: number; withHexReticle?: boolean } = {},
): void {
  const { tagOffsetY = -12, withHexReticle = false } = options;
  const points = `${from.x.toFixed(1)},${from.y.toFixed(1)} ${elbow.x.toFixed(1)},${elbow.y.toFixed(1)} ${to.x.toFixed(1)},${to.y.toFixed(1)}`;
  svg.append(
    el('polyline', { class: `ar-line-glow ${cls}`, points }),
    el('polyline', { class: `ar-line ${cls}`, points }),
    el('polyline', { class: `ar-line-pulse ${cls}`, points }),
    el('polygon', { class: `ar-pad ${cls}`, points: hexPoints(from.x, from.y, 4.2) }),
    el('circle', { class: `ar-node ${cls}`, cx: elbow.x.toFixed(1), cy: elbow.y.toFixed(1), r: '2.2' }),
  );
  if (withHexReticle) {
    svg.append(el('polygon', { class: `ar-reticle ${cls}`, points: hexPoints(to.x, to.y, 10) }));
  }
  svg.append(
    el('circle', {
      class: `ar-reticle-core ${cls}`,
      cx: to.x.toFixed(1),
      cy: to.y.toFixed(1),
      r: withHexReticle ? '3' : '2.6',
    }),
  );
  if (labelText) {
    const isRightRail = cls === 'is-presence' || cls === 'is-target';
    const t = el('text', {
      class: `ar-reticle-tag ${cls}`,
      x: (isRightRail ? from.x - 10 : to.x + 14).toFixed(1),
      y: (isRightRail ? from.y - 7 : to.y + tagOffsetY).toFixed(1),
      'text-anchor': isRightRail ? 'end' : 'start',
    });
    t.textContent = labelText;
    svg.append(t);
  }
}

function appendSectorHexBadges(svg: SVGSVGElement, anchors: readonly ProjectedAnchor2D[], w: number, h: number): void {
  for (const a of anchors) {
    if (!a.visible || !a.id.startsWith('sec_') || a.centerNx === undefined || a.centerNy === undefined) continue;
    const cx = a.centerNx * w;
    const cy = a.centerNy * h;
    const players = a.players ?? 0;
    const bots = a.bots ?? 0;
    const occupied = players + bots > 0;
    const stateCls = [
      a.isHomeBase ? 'is-home' : '',
      a.role === 'target' ? 'is-target' : '',
      !a.isHomeBase && a.role !== 'target' ? (occupied ? 'is-occupied' : 'is-open') : '',
    ]
      .filter(Boolean)
      .join(' ');

    const idNode = el('text', {
      class: `ar-hex-id ${stateCls}`,
      x: cx.toFixed(1),
      y: (cy - 2).toFixed(1),
      'text-anchor': 'middle',
    });
    idNode.textContent = a.id.replace('sec_', '');

    const occNode = el('text', {
      class: `ar-hex-occ ${stateCls}`,
      x: cx.toFixed(1),
      y: (cy + 9).toFixed(1),
      'text-anchor': 'middle',
    });
    occNode.textContent = occupied ? `${players}P·${bots}B` : 'OPEN';
    svg.append(idNode, occNode);
  }
}

/**
 * Draws strictly hexagonal SVG reticles, in-hex sector occupancy tags, and leader lines connecting the
 * 3 floating Ship AR cards to their live synchronized positions on the rotating 3D globe.
 */
export class ArLeaderLines {
  readonly svg: SVGSVGElement;
  private lastKey = '';

  constructor(parent: HTMLElement) {
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('class', 'ar-leader-svg');
    this.svg.setAttribute('aria-hidden', 'true');
    parent.appendChild(this.svg);
  }

  clear(): void {
    if (this.lastKey === 'empty') return;
    this.lastKey = 'empty';
    this.svg.replaceChildren();
  }

  render(cards: ArLeaderCardRefs, frame: OrbitalProjectedFrame | null, ctx: ArLeaderContext): void {
    const w = this.svg.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 0);
    const h = this.svg.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 0);
    if (w < 900 || h < 480) {
      this.clear();
      return;
    }

    const rScan = cards.scanCard.getBoundingClientRect();
    const rPres = cards.presenceCard.getBoundingClientRect();
    const rLaunch = cards.launchCard.getBoundingClientRect();
    if (rScan.width <= 0 || rPres.width <= 0 || rLaunch.width <= 0) {
      this.clear();
      return;
    }

    const scanAnchor = findAnchor(frame, (a) => a.role === 'scanLimb', 0.48, 0.35);
    // Blue Card inspects the currently selected/hovered sector; Orange Card links to the player's base sector.
    const selectedAnchor = findAnchor(frame, (a) => a.role === 'target', 0.58, 0.50);
    const homeAnchor =
      frame?.anchors.find((a) => a.visible && a.isHomeBase) ??
      selectedAnchor;
    const sharedHex = homeAnchor.id === selectedAnchor.id && selectedAnchor.id.startsWith('sec_');
    const selectedEdgeY = selectedAnchor.id.startsWith('sec_') ? -17 : 0;
    const homeEdgeY = homeAnchor.id.startsWith('sec_') ? -17 : 0;

    const scanFrom: Pt = { x: rScan.right + 2, y: rScan.top + rScan.height * 0.36 };
    const scanTo: Pt = { x: scanAnchor.nx * w, y: scanAnchor.ny * h };
    const scanElbow: Pt = { x: scanFrom.x + Math.max(24, (scanTo.x - scanFrom.x) * 0.48), y: scanFrom.y };

    const presFrom: Pt = { x: rPres.left - 2, y: rPres.top + rPres.height * 0.38 };
    const presTo: Pt = { x: selectedAnchor.nx * w - (sharedHex ? 6 : 0), y: selectedAnchor.ny * h + selectedEdgeY };
    const presElbow: Pt = { x: presFrom.x - Math.max(24, (presFrom.x - presTo.x) * 0.45), y: presFrom.y };

    const launchFrom: Pt = { x: rLaunch.left - 2, y: rLaunch.top + Math.min(82, rLaunch.height * 0.28) };
    const launchTo: Pt = { x: homeAnchor.nx * w + (sharedHex ? 6 : 0), y: homeAnchor.ny * h + homeEdgeY };
    const launchElbow: Pt = { x: launchFrom.x - Math.max(26, (launchFrom.x - launchTo.x) * 0.46), y: launchFrom.y };

    const q = (v: number) => Math.round(v * 2);
    const visibleSectors = frame?.anchors.filter((a) => a.visible && a.id.startsWith('sec_')) ?? [];
    const secSig = visibleSectors.map((a) => `${a.id}:${a.players ?? 0}:${a.bots ?? 0}:${a.isHomeBase ? 1 : 0}`).join(',');
    const key = [
      w, h,
      q(scanFrom.x), q(scanFrom.y), q(scanTo.x), q(scanTo.y),
      q(presFrom.x), q(presFrom.y), q(presTo.x), q(presTo.y),
      q(launchFrom.x), q(launchFrom.y), q(launchTo.x), q(launchTo.y),
      selectedAnchor.id, homeAnchor.id, ctx.selectedSectorLabel, ctx.homeBaseLabel ?? '', secSig,
    ].join(':');
    if (key === this.lastKey) return;
    this.lastKey = key;

    this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    this.svg.replaceChildren();

    appendSectorHexBadges(this.svg, visibleSectors, w, h);
    appendHexConnector(this.svg, scanFrom, scanElbow, scanTo, 'is-scan', 'ORBIT SCAN', {
      tagOffsetY: -11,
      withHexReticle: true,
    });
    appendHexConnector(this.svg, presFrom, presElbow, presTo, 'is-presence', ctx.selectedSectorLabel);
    appendHexConnector(this.svg, launchFrom, launchElbow, launchTo, 'is-target', ctx.homeBaseLabel);
  }

  dispose(): void {
    this.svg.remove();
  }
}
