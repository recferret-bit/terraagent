import type { OrbitalProjectedFrame, ProjectedAnchor2D } from '@terra/render/orbit/types';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface ArLeaderCardRefs {
  readonly scanCard: HTMLElement;
  readonly presenceCard: HTMLElement;
  readonly launchCard: HTMLElement;
}

export interface ArLeaderContext {
  readonly targetLabel: string;
  readonly showPresenceNodes: boolean;
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

function diamondPoints(cx: number, cy: number, r: number): string {
  return `${cx.toFixed(1)},${(cy - r).toFixed(1)} ${(cx + r).toFixed(1)},${cy.toFixed(1)} ${cx.toFixed(1)},${(cy + r).toFixed(1)} ${(cx - r).toFixed(1)},${cy.toFixed(1)}`;
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

function appendConnector(
  svg: SVGSVGElement,
  from: Pt,
  elbow: Pt,
  to: Pt,
  cls: string,
  reticle: 'hex' | 'diamond',
  labelText?: string,
  tagOffsetY = -10,
): void {
  const points = `${from.x.toFixed(1)},${from.y.toFixed(1)} ${elbow.x.toFixed(1)},${elbow.y.toFixed(1)} ${to.x.toFixed(1)},${to.y.toFixed(1)}`;
  svg.append(
    el('polyline', { class: `ar-line-glow ${cls}`, points }),
    el('polyline', { class: `ar-line ${cls}`, points }),
    el('polyline', { class: `ar-line-pulse ${cls}`, points }),
    el('rect', {
      class: `ar-pad ${cls}`,
      x: (from.x - 3).toFixed(1),
      y: (from.y - 3).toFixed(1),
      width: '6',
      height: '6',
    }),
    el('circle', { class: `ar-node ${cls}`, cx: elbow.x.toFixed(1), cy: elbow.y.toFixed(1), r: '2.2' }),
  );
  const poly =
    reticle === 'diamond'
      ? diamondPoints(to.x, to.y, 11)
      : hexPoints(to.x, to.y, 10);
  svg.append(
    el('polygon', { class: `ar-reticle ${cls}`, points: poly }),
    el('circle', { class: `ar-reticle-core ${cls}`, cx: to.x.toFixed(1), cy: to.y.toFixed(1), r: '3' }),
  );
  if (labelText) {
    const placeLeft = to.x > svg.viewBox.baseVal.width * 0.72;
    const t = el('text', {
      class: `ar-reticle-tag ${cls}`,
      x: (placeLeft ? to.x - 14 : to.x + 14).toFixed(1),
      y: (to.y + tagOffsetY).toFixed(1),
      'text-anchor': placeLeft ? 'end' : 'start',
    });
    t.textContent = labelText;
    svg.append(t);
  }
}

/**
 * Draws SVG leader lines & 3D surface reticles connecting the 3 floating Ship AR cards
 * to their live projected coordinates on the rotating 3D planet globe.
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
    const occupiedAnchors =
      frame?.anchors.filter((a) => a.visible && (a.role === 'player' || a.role === 'bot')) ?? [];
    const presAnchor = occupiedAnchors[0]
      ? { nx: occupiedAnchors[0].nx, ny: occupiedAnchors[0].ny, id: occupiedAnchors[0].id }
      : findAnchor(frame, (a) => a.role === 'presenceLimb', 0.63, 0.33);
    const targetAnchor = findAnchor(frame, (a) => a.role === 'target', 0.58, 0.56);

    const scanFrom: Pt = { x: rScan.right + 2, y: rScan.top + rScan.height * 0.36 };
    const scanTo: Pt = { x: scanAnchor.nx * w, y: scanAnchor.ny * h };
    const scanElbow: Pt = { x: scanFrom.x + Math.max(24, (scanTo.x - scanFrom.x) * 0.48), y: scanFrom.y };

    const presFrom: Pt = { x: rPres.left - 2, y: rPres.top + rPres.height * 0.38 };
    const presTo: Pt = { x: presAnchor.nx * w, y: presAnchor.ny * h };
    const presElbow: Pt = { x: presFrom.x - Math.max(24, (presFrom.x - presTo.x) * 0.45), y: presFrom.y };

    const launchFrom: Pt = { x: rLaunch.left - 2, y: rLaunch.top + Math.min(82, rLaunch.height * 0.28) };
    const launchTo: Pt = { x: targetAnchor.nx * w, y: targetAnchor.ny * h };
    const launchElbow: Pt = { x: launchFrom.x - Math.max(26, (launchFrom.x - launchTo.x) * 0.46), y: launchFrom.y };

    const q = (v: number) => Math.round(v * 2);
    const key = [
      w, h,
      q(scanFrom.x), q(scanFrom.y), q(scanTo.x), q(scanTo.y),
      q(presFrom.x), q(presFrom.y), q(presTo.x), q(presTo.y),
      q(launchFrom.x), q(launchFrom.y), q(launchTo.x), q(launchTo.y),
      occupiedAnchors.length,
      ctx.targetLabel,
    ].join(':');
    if (key === this.lastKey) return;
    this.lastKey = key;

    this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    this.svg.replaceChildren();

    appendConnector(this.svg, scanFrom, scanElbow, scanTo, 'is-scan', 'hex', 'ORBIT SCAN', -10);
    appendConnector(
      this.svg,
      presFrom,
      presElbow,
      presTo,
      'is-presence',
      'hex',
      ctx.showPresenceNodes ? 'ACTIVE BASE' : undefined,
      -12,
    );
    for (let i = 1; i < Math.min(occupiedAnchors.length, 4); i++) {
      const extra = occupiedAnchors[i]!;
      const ex = extra.nx * w;
      const ey = extra.ny * h;
      const cls = extra.role === 'bot' ? 'is-bot-branch' : 'is-presence';
      const pts = `${presElbow.x.toFixed(1)},${presElbow.y.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}`;
      this.svg.append(
        el('polyline', { class: `ar-line-branch ${cls}`, points: pts }),
        el('circle', { class: `ar-node ${cls}`, cx: ex.toFixed(1), cy: ey.toFixed(1), r: '3' }),
      );
    }
    appendConnector(this.svg, launchFrom, launchElbow, launchTo, 'is-target', 'diamond', ctx.targetLabel, 18);
  }

  dispose(): void {
    this.svg.remove();
  }
}
