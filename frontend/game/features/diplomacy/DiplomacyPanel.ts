import {
  type DiplomacyColonyView,
  type DiplomacyPanelOptions,
  type TruceDurationHours,
  applyDiplomacySimEvent,
  extractDiplomacyColonyView,
  formatTickRemaining,
} from './types';
import {
  TRUCE_BOND_PRESETS,
  buildTruceBadgeElement,
  renderIncomingOfferBanner,
  renderProposeTruceSection,
  type TruceBondPresetKey,
} from './parts/diplomacyDom';
import {
  WAR_BOND_PRESETS,
  buildWarBadgeElement,
  renderWarDeclareSection,
  type WarBondPresetKey,
} from './parts/warDom';
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
  private readonly warsEl: HTMLElement;
  private readonly proposeEl: HTMLElement;
  private readonly warDeclareEl: HTMLElement;

  private currentView: DiplomacyColonyView;
  private selectedHours: TruceDurationHours = 6;
  private selectedTargetColony: number = 1;
  private selectedBondPreset: TruceBondPresetKey = 'free';
  private selectedWarPreset: WarBondPresetKey = '5_near';
  private lastBannerSig: string | null = null;
  private lastTrucesSig: string | null = null;
  private lastWarsSig: string | null = null;
  private lastProposeSig: string | null = null;
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
    title.textContent = 'DIPLOMACY & ESCROW';
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

    this.warsEl = document.createElement('div');
    this.warsEl.className = 'ta-diplomacy-truces';
    this.warsEl.dataset.testid = 'diplomacy-wars';

    this.proposeEl = document.createElement('div');
    this.proposeEl.className = 'ta-diplomacy-propose';
    this.proposeEl.dataset.testid = 'diplomacy-propose-section';

    this.warDeclareEl = document.createElement('div');
    this.warDeclareEl.className = 'ta-diplomacy-propose';
    this.warDeclareEl.dataset.testid = 'diplomacy-war-section';
    this.warDeclareEl.hidden = options.warsEnabled === false;

    this.root.append(header, this.oathbreakerEl, this.bannerEl, this.trucesEl, this.warsEl, this.proposeEl, this.warDeclareEl);
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
    const tick = this.currentView.currentTick;
    const oathUntil = this.currentView.oathbreakerUntil;
    const isOathbreaker = typeof oathUntil === 'number' && oathUntil > tick;
    this.oathbreakerEl.hidden = !isOathbreaker;
    this.oathbreakerEl.textContent =
      isOathbreaker && oathUntil !== null ? `⚠ OATHBREAKER (${formatTickRemaining(oathUntil, tick)})` : '';

    this.renderBanner(tick);
    this.renderTruces(tick);
    this.renderWars(tick);
    this.renderActions(isOathbreaker);
  }

  private renderBanner(tick: number): void {
    const offer = this.currentView.incomingOffers[0];
    const hasOffer = Boolean(offer && offer.expiresAtTick > tick);
    const bannerSig =
      hasOffer && offer
        ? `${offer.offerId}:${offer.fromColony}:${offer.hours}:${offer.bondAmount ?? 0}:${offer.bondToken ?? ''}`
        : '';
    if (this.lastBannerSig !== bannerSig) {
      this.lastBannerSig = bannerSig;
      renderIncomingOfferBanner(this.bannerEl, offer, tick, this.opts.actions);
    } else if (hasOffer && offer) {
      const timerEl = this.bannerEl.querySelector<HTMLElement>('[data-testid="offer-countdown"]');
      if (timerEl) timerEl.textContent = formatTickRemaining(offer.expiresAtTick, tick);
    }
  }

  private renderTruces(tick: number): void {
    const activeTruces = this.currentView.truces.filter((t) => t.status !== 'ended' && t.expiresAtTick > tick);
    const trucesSig = activeTruces
      .map((t) => `${t.truceId}:${t.status}:${t.partnerColony}:${t.bondAmount ?? 0}`)
      .join('|');
    if (this.lastTrucesSig !== trucesSig) {
      this.lastTrucesSig = trucesSig;
      this.trucesEl.replaceChildren();
      for (const truce of activeTruces) {
        this.trucesEl.appendChild(buildTruceBadgeElement(truce, tick, this.opts.actions));
      }
      return;
    }
    for (const truce of activeTruces) {
      const badge = this.trucesEl.querySelector<HTMLElement>(`[data-truce-id="${truce.truceId}"]`);
      const timerEl = badge?.querySelector<HTMLElement>('[data-testid="truce-timer"]');
      if (timerEl) {
        timerEl.textContent =
          truce.status === 'notice' && typeof truce.noticeEndsAtTick === 'number'
            ? `Notice: ${formatTickRemaining(truce.noticeEndsAtTick, tick)}`
            : formatTickRemaining(truce.expiresAtTick, tick);
      }
    }
  }

  private renderWars(tick: number): void {
    const activeWars = (this.currentView.wars ?? []).filter((w) => w.status === 'active' && w.expiresAtTick > tick);
    const warsSig = activeWars
      .map((w) => `${w.warId}:${w.role}:${w.structuresDestroyed}:${Math.floor(w.resourcesSiphoned)}`)
      .join('|');
    if (this.lastWarsSig !== warsSig) {
      this.lastWarsSig = warsSig;
      this.warsEl.replaceChildren();
      for (const war of activeWars) {
        this.warsEl.appendChild(buildWarBadgeElement(war, tick, this.opts.actions));
      }
      return;
    }
    for (const war of activeWars) {
      const badge = this.warsEl.querySelector<HTMLElement>(`[data-war-id="${war.warId}"]`);
      const timerEl = badge?.querySelector<HTMLElement>('[data-testid="war-timer"]');
      if (timerEl) timerEl.textContent = `6h Bond: ${formatTickRemaining(war.expiresAtTick, tick)}`;
    }
  }

  private renderActions(isOathbreaker: boolean): void {
    const activeWarCount = (this.currentView.wars ?? []).length;
    const proposeSig = [
      this.currentView.colonyIndex,
      this.currentView.contacts.join(','),
      this.selectedTargetColony,
      this.selectedHours,
      this.selectedBondPreset,
      this.selectedWarPreset,
      isOathbreaker,
      this.currentView.truces.length,
      activeWarCount,
    ].join('#');
    if (this.lastProposeSig === proposeSig) return;
    this.lastProposeSig = proposeSig;

    this.selectedTargetColony = renderProposeTruceSection(
      this.proposeEl,
      this.currentView,
      this.selectedTargetColony,
      this.selectedHours,
      this.selectedBondPreset,
      (target) => {
        this.selectedTargetColony = target;
        this.lastProposeSig = null;
        this.render();
      },
      (hours) => {
        this.selectedHours = hours;
        this.lastProposeSig = null;
        this.render();
      },
      (preset) => {
        this.selectedBondPreset = preset;
        this.lastProposeSig = null;
        this.render();
      },
      () => {
        const bondSpec = TRUCE_BOND_PRESETS[this.selectedBondPreset].spec;
        if (bondSpec) {
          this.opts.actions?.onProposeTruce?.(this.selectedTargetColony, this.selectedHours, bondSpec);
        } else {
          this.opts.actions?.onProposeTruce?.(this.selectedTargetColony, this.selectedHours);
        }
      },
    );

    if (this.opts.warsEnabled !== false) {
      renderWarDeclareSection(
        this.warDeclareEl,
        this.currentView,
        this.selectedTargetColony,
        this.selectedWarPreset,
        (preset) => {
          this.selectedWarPreset = preset;
          this.lastProposeSig = null;
          this.render();
        },
        () => {
          const spec = WAR_BOND_PRESETS[this.selectedWarPreset].spec;
          this.opts.actions?.onDeclareWar?.(this.selectedTargetColony, spec);
        },
      );
    }
  }
}

export function createDiplomacyPanel(
  host: HTMLElement,
  options?: DiplomacyPanelOptions,
): DiplomacyPanelInstance {
  return new DiplomacyPanel(host, options);
}
