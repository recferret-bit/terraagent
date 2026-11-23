import { noteBootFailure, noteColonyEntered, noteDescentStarted } from '../../../design/analytics/play';
import './bootOnline.css';
import { formatQueueStatusMessage, type QueuedHomeStatus } from './joinQueueFlow';
import {
  buildDescentOverlayDom,
  renderDescentOverlayUpdate,
  type DescentOverlayRefs,
} from './parts/descentOverlayDom';

export type BootPhase = 'splash' | 'descent' | 'colony';

export interface DescentTelemetryUpdate {
  progress: number;
  q: number;
  r: number;
  landed?: boolean;
  planetType?: string | null;
}

function buildSplashDom() {
  const splashEl = document.createElement('div');
  splashEl.className = 'ta-orbital-splash plate';
  splashEl.setAttribute('data-testid', 'orbital-splash');
  splashEl.dataset.testid = 'orbital-splash';
  splashEl.dataset.active = 'true';
  splashEl.hidden = false;

  const eyebrow = document.createElement('div');
  eyebrow.className = 'ta-orbital-splash__eyebrow';
  eyebrow.textContent = 'ORBITAL TELEMETRY LINK';

  const title = document.createElement('h1');
  title.className = 'ta-orbital-splash__title';
  title.setAttribute('data-testid', 'orbital-splash-title');
  title.dataset.testid = 'orbital-splash-title';
  title.textContent = 'TERRAAGENT';

  const splashStatusEl = document.createElement('div');
  splashStatusEl.className = 'ta-orbital-splash__status';
  splashStatusEl.setAttribute('data-testid', 'orbital-splash-status');
  splashStatusEl.dataset.testid = 'orbital-splash-status';
  splashStatusEl.textContent = 'Contacting orbit…';

  const queueEl = document.createElement('div');
  queueEl.className = 'ta-orbital-splash__queue plate-sm';
  queueEl.setAttribute('data-testid', 'queue-status');
  queueEl.dataset.testid = 'queue-status';
  queueEl.dataset.active = 'false';
  queueEl.hidden = true;

  const queueTextEl = document.createElement('div');
  queueTextEl.className = 'ta-orbital-splash__queue-text';
  queueTextEl.setAttribute('data-testid', 'queue-status-text');
  queueTextEl.dataset.testid = 'queue-status-text';

  const queueCancelBtnEl = document.createElement('button');
  queueCancelBtnEl.type = 'button';
  queueCancelBtnEl.className = 'btn btn-ghost btn-sm ta-orbital-splash__cancel';
  queueCancelBtnEl.setAttribute('data-testid', 'queue-cancel-btn');
  queueCancelBtnEl.dataset.testid = 'queue-cancel-btn';
  queueCancelBtnEl.textContent = 'CANCEL QUEUE';

  queueEl.append(queueTextEl, queueCancelBtnEl);
  splashEl.append(eyebrow, title, splashStatusEl, queueEl);
  return { splashEl, splashStatusEl, queueEl, queueTextEl, queueCancelBtnEl };
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
  readonly queueEl: HTMLElement;
  readonly queueTextEl: HTMLElement;
  readonly queueCancelBtnEl: HTMLButtonElement;
  readonly descentEl: HTMLElement;
  readonly descentLabelEl: HTMLElement;
  readonly descentCoordsEl: HTMLElement;
  readonly descentAltEl: HTMLElement;
  readonly descentProgEl: HTMLElement;
  readonly descentBarFillEl: HTMLElement;
  readonly colonyEl: HTMLElement;
  readonly colonyBadgeEl: HTMLElement;
  /** `[data-testid="offline-badge"]`: the session runs on a browser-local fallback host, not the game server. */
  readonly offlineEl: HTMLElement;
  private readonly descentRefs: DescentOverlayRefs;
  private retryEl: HTMLButtonElement | null = null;
  private settleRetry: ((retry: boolean) => void) | null = null;

  private currentPhase: BootPhase = 'splash';
  private descentCount = 0;

  constructor(parent: HTMLElement) {
    const splash = buildSplashDom();
    this.splashEl = splash.splashEl;
    this.splashStatusEl = splash.splashStatusEl;
    this.queueEl = splash.queueEl;
    this.queueTextEl = splash.queueTextEl;
    this.queueCancelBtnEl = splash.queueCancelBtnEl;

    const descent = buildDescentOverlayDom();
    this.descentRefs = descent;
    this.descentEl = descent.descentEl;
    this.descentLabelEl = descent.descentLabelEl;
    this.descentCoordsEl = descent.descentCoordsEl;
    this.descentAltEl = descent.descentAltEl;
    this.descentProgEl = descent.descentProgEl;
    this.descentBarFillEl = descent.descentBarFillEl;

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

    this.offlineEl = document.createElement('div');
    this.offlineEl.className = 'ta-offline-badge plate-sm';
    this.offlineEl.setAttribute('data-testid', 'offline-badge');
    this.offlineEl.dataset.testid = 'offline-badge';
    this.offlineEl.textContent = 'OFFLINE · LOCAL';
    this.offlineEl.title = 'No game server: this colony runs in your browser and is lost on reload';
    this.offlineEl.hidden = true;

    parent.append(this.splashEl, this.descentEl, this.colonyEl, this.offlineEl);
  }

  /** Shows or hides the "OFFLINE · LOCAL" badge (a dev-build local fallback host is attached, FA-06). */
  setOffline(offline: boolean): void {
    this.offlineEl.hidden = !offline;
  }

  /**
   * Boot failed (HTTP error, or the server is unreachable where no local fallback is allowed): the splash shows the
   * message with a Retry button; resolves true when the player clicks Retry, false when disposed first.
   */
  showError(message: string): Promise<boolean> {
    noteBootFailure(message);
    this.showSplash(message);
    this.splashEl.dataset.error = 'true';
    this.settleRetry?.(false);
    this.retryEl?.remove();
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-sm ta-orbital-splash__retry';
    btn.setAttribute('data-testid', 'orbital-splash-retry');
    btn.dataset.testid = 'orbital-splash-retry';
    btn.textContent = 'Retry';
    this.retryEl = btn;
    this.splashEl.appendChild(btn);
    return new Promise((ok) => {
      this.settleRetry = (retry) => { this.settleRetry = null; ok(retry); };
      btn.onclick = () => {
        btn.remove();
        this.retryEl = null;
        this.splashEl.dataset.error = 'false';
        this.setSplashStatus('Contacting orbit…');
        this.settleRetry?.(true);
      };
    });
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

  showQueueStatus(status: QueuedHomeStatus, onCancel?: () => void): void {
    const label = formatQueueStatusMessage(status);
    this.showSplash(label);
    this.queueEl.hidden = false;
    this.queueEl.dataset.active = 'true';
    this.queueEl.dataset.ticketId = status.ticketId;
    this.queueEl.dataset.ticketState = status.ticketState;
    this.queueEl.dataset.planetId = status.planetId;
    this.queueEl.dataset.planetType = status.planetType;
    this.queueEl.dataset.sectorMode = status.sectorIntent.kind;
    this.queueEl.dataset.sectorId = status.sectorIntent.kind === 'chosen' ? status.sectorIntent.sectorId : 'auto';
    this.queueEl.dataset.position = String(status.position);
    this.queueEl.dataset.etaS = status.etaS !== null ? String(status.etaS) : '';
    this.queueTextEl.textContent = label;
    this.queueCancelBtnEl.disabled = false;
    this.queueCancelBtnEl.onclick = () => {
      this.queueCancelBtnEl.disabled = true;
      onCancel?.();
    };
  }

  hideQueueStatus(): void {
    this.queueEl.hidden = true;
    this.queueEl.dataset.active = 'false';
    this.queueCancelBtnEl.disabled = false;
    this.queueCancelBtnEl.onclick = null;
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
      noteDescentStarted();
    }
    this.currentPhase = 'descent';
    this.hideQueueStatus();
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
    renderDescentOverlayUpdate(this.descentRefs, update);
  }

  showColony(planetId?: string): void {
    if (planetId) {
      this.colonyEl.setAttribute('data-planet-id', planetId);
      this.colonyEl.dataset.planetId = planetId;
    }
    noteColonyEntered();
    this.currentPhase = 'colony';
    this.hideQueueStatus();
    this.splashEl.hidden = true;
    this.splashEl.dataset.active = 'false';
    this.descentEl.hidden = true;
    this.descentEl.dataset.active = 'false';
    this.colonyEl.hidden = false;
    this.colonyEl.dataset.active = 'true';
  }

  dispose(): void {
    this.settleRetry?.(false);
    this.hideQueueStatus();
    this.splashEl.remove();
    this.descentEl.remove();
    this.colonyEl.remove();
    this.offlineEl.remove();
  }
}
