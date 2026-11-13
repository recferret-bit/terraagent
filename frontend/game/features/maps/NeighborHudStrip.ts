import type { FeatureContext } from '../../core/registry/types';
import { ownColonyIndex as resolveOwnColonyIndex } from '../shared/colony';
import {
  extractNeighborColonyMarkers,
  formatCountdownSeconds,
  type NeighborColonyMarker,
} from './neighborMarkers';
import './neighbor-markers.css';

export interface NeighborHudStripOptions {
  container: HTMLElement;
  ctx: FeatureContext;
}

function createNeighborItem(
  marker: NeighborColonyMarker,
  ctx: FeatureContext,
  className: string,
): HTMLElement {
  const item = document.createElement('div');
  item.className = className;
  item.dataset.testid = `neighbor-marker-${marker.colonyId}`;
  item.dataset.colonyIndex = String(marker.colonyIndex);
  item.setAttribute('data-colony-index', String(marker.colonyIndex));

  const ring = document.createElement('span');
  ring.className = 'ta-neighbor-ring';
  ring.dataset.testid = 'neighbor-ring';
  ring.style.borderColor = marker.colorToken;
  item.appendChild(ring);

  const name = document.createElement('span');
  name.className = 'ta-neighbor-name';
  name.dataset.testid = 'neighbor-name';
  name.textContent = marker.name;
  item.appendChild(name);

  const shieldBadge = document.createElement('span');
  shieldBadge.className = 'ta-neighbor-shield-badge';
  shieldBadge.dataset.testid = 'neighbor-shield-badge';
  if (marker.shieldActive) {
    shieldBadge.hidden = false;
    shieldBadge.style.display = '';
    shieldBadge.dataset.active = 'true';
    shieldBadge.textContent = `🛡 ${formatCountdownSeconds(marker.shieldRemainingSeconds)}`;
  } else {
    shieldBadge.hidden = true;
    shieldBadge.style.display = 'none';
    shieldBadge.dataset.active = 'false';
  }
  item.appendChild(shieldBadge);

  const truceBadge = document.createElement('span');
  truceBadge.className = 'ta-neighbor-truce-badge';
  truceBadge.dataset.testid = 'neighbor-truce-badge';
  if (marker.truceActive) {
    truceBadge.hidden = false;
    truceBadge.style.display = '';
    truceBadge.dataset.active = 'true';
    truceBadge.textContent = `🕊 ${formatCountdownSeconds(marker.truceRemainingSeconds)}`;
  } else {
    truceBadge.hidden = true;
    truceBadge.style.display = 'none';
    truceBadge.dataset.active = 'false';
  }
  item.appendChild(truceBadge);

  item.addEventListener('click', (e) => {
    e.stopPropagation();
    if (ctx.services.maps?.panToTile) {
      ctx.services.maps.panToTile(marker.q, marker.r);
    } else if (ctx.services.focusTile) {
      ctx.services.focusTile(marker.q, marker.r);
    }
  });

  return item;
}

export class NeighborHudStrip {
  readonly hudStripEl: HTMLElement;
  readonly minimapOverlayEl: HTMLElement;
  private readonly container: HTMLElement;
  private readonly ctx: FeatureContext;

  constructor(opts: NeighborHudStripOptions) {
    this.container = opts.container;
    this.ctx = opts.ctx;

    this.hudStripEl = document.createElement('div');
    this.hudStripEl.className = 'ta-neighbor-hud-strip';
    this.hudStripEl.dataset.testid = 'neighbor-hud-strip';
    this.hudStripEl.setAttribute('aria-label', 'Discovered neighbors');

    this.minimapOverlayEl = document.createElement('div');
    this.minimapOverlayEl.className = 'ta-minimap-neighbor-markers';
    this.minimapOverlayEl.dataset.testid = 'minimap-neighbor-markers';
    this.minimapOverlayEl.setAttribute('aria-label', 'Minimap neighbor markers');

    this.container.appendChild(this.hudStripEl);
    this.container.appendChild(this.minimapOverlayEl);
  }

  update(rawView: unknown): void {
    const ownColonyIndex = resolveOwnColonyIndex(this.ctx.services);
    const markers = extractNeighborColonyMarkers(rawView, ownColonyIndex);

    while (this.hudStripEl.firstChild) {
      this.hudStripEl.removeChild(this.hudStripEl.firstChild);
    }
    while (this.minimapOverlayEl.firstChild) {
      this.minimapOverlayEl.removeChild(this.minimapOverlayEl.firstChild);
    }

    for (const marker of markers) {
      const stripItem = createNeighborItem(marker, this.ctx, 'ta-neighbor-hud-item plate-sm');
      this.hudStripEl.appendChild(stripItem);

      const minimapItem = createNeighborItem(marker, this.ctx, 'ta-minimap-neighbor-marker');
      this.minimapOverlayEl.appendChild(minimapItem);
    }
  }

  dispose(): void {
    this.hudStripEl.remove();
    this.minimapOverlayEl.remove();
  }
}

export function mountNeighborHudStrip(opts: NeighborHudStripOptions): NeighborHudStrip {
  return new NeighborHudStrip(opts);
}
