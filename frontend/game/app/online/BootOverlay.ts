import './bootOnline.css';

export type BootPhase = 'splash' | 'descent' | 'colony';

export interface DescentTelemetryUpdate {
  progress: number;
  q: number;
  r: number;
  landed?: boolean;
}

/**
 * Vanilla-DOM Faction Plate overlays for the W01 `/play.html` boot flow (CLIENT §3.2, D-36):
 * 1. `[data-testid="orbital-splash"]` ("Contacting orbit…")
 * 2. `[data-testid="descent-phase"]` (drop pod descent telemetry while pod is descending)
 * 3. `[data-testid="colony-view"]` (interactive colony view once HQ lands)
 */
export class BootOverlay {
  readonly splashEl: HTMLElement;
  readonly splashStatusEl: HTMLElement;
  readonly descentEl: HTMLElement;
  readonly descentLabelEl: HTMLElement;
  readonly descentCoordsEl: HTMLElement;
  readonly descentAltEl: HTMLElement;
  readonly descentProgEl: HTMLElement;
  readonly descentBarFillEl: HTMLElement;
  readonly colonyEl: HTMLElement;
  readonly colonyBadgeEl: HTMLElement;

  private currentPhase: BootPhase = 'splash';
  private descentCount = 0;

  constructor(parent: HTMLElement) {
    this.splashEl = document.createElement('div');
    this.splashEl.className = 'ta-orbital-splash plate';
    this.splashEl.setAttribute('data-testid', 'orbital-splash');
    this.splashEl.dataset.testid = 'orbital-splash';
    this.splashEl.dataset.active = 'true';
    this.splashEl.hidden = false;

    const eyebrow = document.createElement('div');
    eyebrow.className = 'ta-orbital-splash__eyebrow';
    eyebrow.textContent = 'ORBITAL TELEMETRY LINK';

    const title = document.createElement('h1');
    title.className = 'ta-orbital-splash__title';
    title.setAttribute('data-testid', 'orbital-splash-title');
    title.dataset.testid = 'orbital-splash-title';
    title.textContent = 'TERRAAGENT';

    this.splashStatusEl = document.createElement('div');
    this.splashStatusEl.className = 'ta-orbital-splash__status';
    this.splashStatusEl.setAttribute('data-testid', 'orbital-splash-status');
    this.splashStatusEl.dataset.testid = 'orbital-splash-status';
    this.splashStatusEl.textContent = 'Contacting orbit…';

    this.splashEl.appendChild(eyebrow);
    this.splashEl.appendChild(title);
    this.splashEl.appendChild(this.splashStatusEl);

    this.descentEl = document.createElement('div');
    this.descentEl.className = 'ta-descent-phase plate-sm';
    this.descentEl.setAttribute('data-testid', 'descent-phase');
    this.descentEl.dataset.testid = 'descent-phase';
    this.descentEl.dataset.active = 'false';
    this.descentEl.hidden = true;

    const header = document.createElement('div');
    header.className = 'ta-descent-phase__header';
    this.descentLabelEl = document.createElement('span');
    this.descentLabelEl.setAttribute('data-testid', 'descent-phase-label');
    this.descentLabelEl.dataset.testid = 'descent-phase-label';
    this.descentLabelEl.textContent = 'ATMOSPHERIC ENTRY';
    this.descentCoordsEl = document.createElement('span');
    this.descentCoordsEl.setAttribute('data-testid', 'descent-coords');
    this.descentCoordsEl.dataset.testid = 'descent-coords';
    this.descentCoordsEl.textContent = '(0, 0)';
    header.appendChild(this.descentLabelEl);
    header.appendChild(this.descentCoordsEl);

    const metrics = document.createElement('div');
    metrics.className = 'ta-descent-phase__metrics';
    this.descentAltEl = document.createElement('span');
    this.descentAltEl.setAttribute('data-testid', 'descent-altitude');
    this.descentAltEl.dataset.testid = 'descent-altitude';
    this.descentAltEl.textContent = '120.0 km';
    this.descentProgEl = document.createElement('span');
    this.descentProgEl.setAttribute('data-testid', 'descent-progress');
    this.descentProgEl.dataset.testid = 'descent-progress';
    this.descentProgEl.textContent = '0%';
    metrics.appendChild(this.descentAltEl);
    metrics.appendChild(this.descentProgEl);

    const bar = document.createElement('div');
    bar.className = 'ta-descent-phase__bar';
    this.descentBarFillEl = document.createElement('div');
    this.descentBarFillEl.className = 'ta-descent-phase__bar-fill';
    this.descentBarFillEl.setAttribute('data-testid', 'descent-progress-bar');
    this.descentBarFillEl.dataset.testid = 'descent-progress-bar';
    bar.appendChild(this.descentBarFillEl);

    this.descentEl.appendChild(header);
    this.descentEl.appendChild(metrics);
    this.descentEl.appendChild(bar);

    this.colonyEl = document.createElement('div');
    this.colonyEl.className = 'ta-colony-view';
    this.colonyEl.setAttribute('data-testid', 'colony-view');
    this.colonyEl.dataset.testid = 'colony-view';
    this.colonyEl.dataset.active = 'false';
    this.colonyEl.hidden = true;

    this.colonyBadgeEl = document.createElement('div');
    this.colonyBadgeEl.className = 'ta-colony-view__badge plate-sm';
    this.colonyBadgeEl.setAttribute('data-testid', 'colony-view-badge');
    this.colonyBadgeEl.dataset.testid = 'colony-view-badge';
    this.colonyBadgeEl.textContent = 'COLONY VIEW · pl_dev';
    this.colonyEl.appendChild(this.colonyBadgeEl);

    parent.appendChild(this.splashEl);
    parent.appendChild(this.descentEl);
    parent.appendChild(this.colonyEl);
  }

  get phase(): BootPhase {
    return this.currentPhase;
  }

  get descentShownCount(): number {
    return this.descentCount;
  }

  setSplashStatus(text: string): void {
    this.splashStatusEl.textContent = text;
  }

  setColonyMeta(planetId: string, colonyId: string, colonyIndex: number): void {
    this.colonyEl.setAttribute('data-planet-id', planetId);
    this.colonyEl.dataset.planetId = planetId;
    this.colonyEl.setAttribute('data-colony-id', colonyId);
    this.colonyEl.dataset.colonyId = colonyId;
    this.colonyEl.setAttribute('data-colony-index', String(colonyIndex));
    this.colonyEl.dataset.colonyIndex = String(colonyIndex);
    this.colonyBadgeEl.textContent = `COLONY VIEW · ${planetId} · ${colonyId}`;
  }

  showSplash(statusText?: string): void {
    if (statusText) this.setSplashStatus(statusText);
    this.currentPhase = 'splash';
    this.splashEl.hidden = false;
    this.splashEl.dataset.active = 'true';
    this.descentEl.hidden = true;
    this.descentEl.dataset.active = 'false';
    this.colonyEl.hidden = true;
    this.colonyEl.dataset.active = 'false';
  }

  showDescent(update: DescentTelemetryUpdate): void {
    if (this.currentPhase !== 'descent') {
      this.descentCount++;
    }
    this.currentPhase = 'descent';
    this.splashEl.hidden = true;
    this.splashEl.dataset.active = 'false';
    const hideBox = Boolean(update.landed);
    this.descentEl.hidden = hideBox;
    this.descentEl.dataset.active = hideBox ? 'false' : 'true';
    this.colonyEl.hidden = true;
    this.colonyEl.dataset.active = 'false';
    this.updateDescent(update);
  }

  updateDescent(update: DescentTelemetryUpdate): void {
    const p = Math.min(1, Math.max(0, update.progress));
    const pct = Math.round(p * 100);
    const altKm = ((1 - p) * 120).toFixed(1);
    const label = p < 0.35 ? 'ATMOSPHERIC ENTRY' : p < 0.8 ? 'RETRO-BURN' : 'TOUCHDOWN';
    this.descentLabelEl.textContent = label;
    this.descentCoordsEl.textContent = `(${update.q}, ${update.r})`;
    this.descentAltEl.textContent = `${altKm} km`;
    this.descentProgEl.textContent = `${pct}%`;
    this.descentBarFillEl.style.width = `${pct}%`;
    this.descentEl.dataset.progress = p.toFixed(2);
    this.descentEl.dataset.q = String(update.q);
    this.descentEl.dataset.r = String(update.r);
  }

  showColony(planetId?: string): void {
    if (planetId) {
      this.colonyEl.setAttribute('data-planet-id', planetId);
      this.colonyEl.dataset.planetId = planetId;
    }
    this.currentPhase = 'colony';
    this.splashEl.hidden = true;
    this.splashEl.dataset.active = 'false';
    this.descentEl.hidden = true;
    this.descentEl.dataset.active = 'false';
    this.colonyEl.hidden = false;
    this.colonyEl.dataset.active = 'true';
  }

  dispose(): void {
    this.splashEl.remove();
    this.descentEl.remove();
    this.colonyEl.remove();
  }
}
