import {
  type DiplomacyColonyView,
  type DiplomacyPanelOptions,
  type TruceDurationHours,
  applyDiplomacySimEvent,
  extractDiplomacyColonyView,
  formatTickRemaining,
} from './types';
import {
  buildTruceBadgeElement,
  renderIncomingOfferBanner,
  renderProposeTruceSection,
} from './parts/diplomacyDom';
import './diplomacy.css';

export interface DiplomacyPanelInstance {
  readonly root: HTMLElement;
  update(snapshotOrView: unknown): void;
  ingestSimEvents(events: readonly { kind: string; data?: Record<string, unknown> }[]): void;
  dispose(): void;
}

export class DiplomacyPanel implements DiplomacyPanelInstance {
  readonly root: HTMLElement;
  private readonly oathbreakerEl: HTMLElement;
  private readonly bannerEl: HTMLElement;
  private readonly trucesEl: HTMLElement;
  private readonly proposeEl: HTMLElement;

  private currentView: DiplomacyColonyView;
  private selectedHours: TruceDurationHours = 6;
  private selectedTargetColony: number = 1;
  private readonly opts: DiplomacyPanelOptions;

  constructor(host: HTMLElement, options: DiplomacyPanelOptions = {}) {
    this.opts = options;
    this.currentView = extractDiplomacyColonyView(null, options.ownColonyIndex ?? 0);

    this.root = document.createElement('section');
    this.root.className = 'ta-diplomacy-panel plate-sm';
    this.root.dataset.testid = 'diplomacy-panel';

    const header = document.createElement('div');
    header.className = 'ta-diplomacy__header';
    const title = document.createElement('h3');
    title.className = 'ta-diplomacy__title';
    title.textContent = 'DIPLOMACY';
    header.appendChild(title);

    this.oathbreakerEl = document.createElement('div');
    this.oathbreakerEl.className = 'ta-diplomacy-oathbreaker';
    this.oathbreakerEl.dataset.testid = 'diplomacy-oathbreaker';
    this.oathbreakerEl.hidden = true;

    this.bannerEl = document.createElement('div');
    this.bannerEl.className = 'ta-diplomacy-offer-banner plate-sm';
    this.bannerEl.dataset.testid = 'diplomacy-offer-banner';
    this.bannerEl.hidden = true;

    this.trucesEl = document.createElement('div');
    this.trucesEl.className = 'ta-diplomacy-truces';
    this.trucesEl.dataset.testid = 'diplomacy-truces';

    this.proposeEl = document.createElement('div');
    this.proposeEl.className = 'ta-diplomacy-propose';
    this.proposeEl.dataset.testid = 'diplomacy-propose-section';

    this.root.append(header, this.oathbreakerEl, this.bannerEl, this.trucesEl, this.proposeEl);
    host.appendChild(this.root);

    this.render();
  }

  private resolveOwnIndex(): number {
    return this.opts.getOwnColonyIndex ? this.opts.getOwnColonyIndex() : (this.opts.ownColonyIndex ?? 0);
  }

  update(snapshotOrView: unknown): void {
    if (snapshotOrView && typeof snapshotOrView === 'object' && 'incomingOffers' in snapshotOrView) {
      this.currentView = snapshotOrView as DiplomacyColonyView;
    } else {
      this.currentView = extractDiplomacyColonyView(
        snapshotOrView,
        this.resolveOwnIndex(),
        this.currentView.currentTick,
      );
    }
    this.render();
  }

  ingestSimEvents(events: readonly { kind: string; data?: Record<string, unknown> }[]): void {
    const ownIdx = this.resolveOwnIndex();
    let view = { ...this.currentView, colonyIndex: ownIdx };
    for (const ev of events) {
      view = applyDiplomacySimEvent(view, ev, ownIdx);
    }
    this.currentView = view;
    this.render();
  }

  dispose(): void {
    this.root.remove();
  }

  private render(): void {
    const oathUntil = this.currentView.oathbreakerUntil;
    const isOathbreaker = typeof oathUntil === 'number' && oathUntil > this.currentView.currentTick;
    this.oathbreakerEl.hidden = !isOathbreaker;
    this.oathbreakerEl.textContent =
      isOathbreaker && oathUntil !== null
        ? `⚠ OATHBREAKER (${formatTickRemaining(oathUntil, this.currentView.currentTick)})`
        : '';

    renderIncomingOfferBanner(
      this.bannerEl,
      this.currentView.incomingOffers[0],
      this.currentView.currentTick,
      this.opts.actions,
    );

    this.trucesEl.replaceChildren();
    const activeTruces = this.currentView.truces.filter(
      (t) => t.status !== 'ended' && t.expiresAtTick > this.currentView.currentTick,
    );
    for (const truce of activeTruces) {
      this.trucesEl.appendChild(
        buildTruceBadgeElement(truce, this.currentView.currentTick, this.opts.actions),
      );
    }

    this.selectedTargetColony = renderProposeTruceSection(
      this.proposeEl,
      this.currentView,
      this.selectedTargetColony,
      this.selectedHours,
      (target) => {
        this.selectedTargetColony = target;
      },
      (hours) => {
        this.selectedHours = hours;
        this.render();
      },
      () => {
        this.opts.actions?.onProposeTruce?.(this.selectedTargetColony, this.selectedHours);
      },
    );
  }
}

export function createDiplomacyPanel(
  host: HTMLElement,
  options?: DiplomacyPanelOptions,
): DiplomacyPanelInstance {
  return new DiplomacyPanel(host, options);
}
